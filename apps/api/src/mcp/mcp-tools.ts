import { HttpException, Logger } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { PrismaService } from '../prisma/prisma.service';
import type { CompanyScopeService } from '../common/company-scope';
import type { AuthUser } from '../common/current-user.decorator';
import type { EbayListingService } from '../listing/ebay/ebay-listing.service';

/**
 * The maSquare connector: what Claude can see and do when a person points it at this platform.
 *
 * This replaces paying per call for Claude to research products. Instead a person opens Claude on
 * their own plan, Claude does the web research with the search built into that plan, and it hands
 * the evidence to maSquare through these tools. Nothing here calls out to Anthropic.
 *
 * The division of labour is the whole design, and it is enforced by what the tools ALLOW rather
 * than by asking nicely in the instructions:
 *
 *   Claude is a WITNESS. It may read products, and submit what pages said with the pages that said
 *   it. That is all.
 *
 *   maSquare is the JUDGE. A submission is screened (was the page declared, is it about this
 *   product) and folded through the same provenance rules as every other source — manufacturer
 *   authoritative, two independent sources otherwise, anything weaker held back for a person.
 *
 * There is deliberately no tool to confirm a held-back value, to overwrite what a person entered,
 * or to publish a listing. If a future need seems to require one, that is a decision for a person to
 * make about the business rules — not a tool to add here.
 */

export interface McpDeps {
  listing: EbayListingService;
  scope: CompanyScopeService;
  prisma: PrismaService;
}

const logger = new Logger('McpTools');

/**
 * Sent to Claude once, when it connects. Written as the rules of the job, because they are.
 *
 * The screening in `screen-research` enforces the ones code can check (declared pages, page
 * identity, source kind). The rest — copy exactly, never infer — cannot be checked by code, which is
 * why they are stated plainly and why anything weaker than the manufacturer is held back anyway.
 */
export const INSTRUCTIONS = [
  'maSquare is a back-office platform for a retailer. This connector lets you research product',
  'specifications (eBay item specifics) on the web and hand the evidence to maSquare, which decides',
  'what is used. You gather evidence; you do not decide what is true.',
  '',
  'WORKFLOW, per product:',
  '1. get_product_for_gather — who the product is, and the exact field names its eBay category uses.',
  '   If it is not ready, tell the user the reason it gives and move on. Never work around a refusal',
  '   (for example, never guess a missing barcode or part number).',
  '2. Search the web. Prefer the manufacturer\'s own site. Make sure each page is THIS model — the part',
  '   number must match, not just the product family.',
  '3. submit_gather_findings — once per product, with every page you used and every value found.',
  '4. submit_product_content — the buyer-facing words, as PLAIN PROSE: two or three short paragraphs',
  '   and a few feature lines. Never HTML. maSquare renders the eBay description itself from one house',
  '   template and builds the specification table from values that passed its checks, so the design is',
  '   identical on every listing and is not yours to choose.',
  '5. Tell the user briefly what was usable, what was held back for them to check, and what is still',
  '   missing. Held-back values are confirmed by a person inside maSquare, not by you.',
  '',
  'RULES FOR WHAT YOU REPORT:',
  '- Copy each value EXACTLY as printed, with its units. Never convert units, calculate, round,',
  '  translate or tidy.',
  '- Report only what a page states outright. Never infer from the product name, a photo, a similar',
  '  model, or your own knowledge. A missing field is fine; an invented one is a serious error.',
  '- Every value must cite the exact URL of the page that stated it, and every such page must be listed',
  '  in sources with the brand and part number THAT PAGE shows. maSquare rejects pages about a different',
  '  product and every value on them.',
  '- If two pages disagree, report both values. Do not choose between them.',
  '- Use the field names exactly as get_product_for_gather gives them.',
  '- Skip Brand, MPN and Model — maSquare takes those from the product itself.',
  '- Skip fields already answered by a person or by the manufacturer (see "current" in the brief).',
  '',
  'WHAT YOU CANNOT DO: confirm held-back values, overwrite anything a person entered, or publish',
  'listings. Those are done by a person in maSquare.',
].join('\n');

export function buildMasquareServer(deps: McpDeps, actor: AuthUser): McpServer {
  const server = new McpServer({ name: 'masquare', version: '1.0.0' }, { instructions: INSTRUCTIONS });

  addTool<ListArgs>(server,
    'list_products_for_gather',
    {
      title: 'List products to research',
      description:
        'Find products by SKU or by a search term, and see which are ready for research. A product is ready '
        + 'when it has a manufacturer part number, a barcode (EAN or UPC) and an eBay category. Anything not '
        + 'ready says why. Read-only.',
      inputSchema: {
        skus: z.array(z.string().max(100)).max(50).optional()
          .describe('Exact SKUs to look up. Leave out to search instead.'),
        search: z.string().max(100).optional()
          .describe('Matches SKU, title or manufacturer part number. Ignored when skus are given.'),
        onlyReady: z.boolean().optional().describe('Return only products ready for research.'),
        limit: z.number().int().min(1).max(50).optional().describe('At most this many products. Default 25.'),
        company: z.string().max(200).optional()
          .describe('Company name, only needed when the user has more than one company selling on eBay.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => run(async () => {
      const companyId = await resolveCompany(deps, actor, args.company);
      return deps.listing.researchCandidates({
        companyIds: [companyId],
        skus: args.skus,
        search: args.search,
        onlyReady: args.onlyReady ?? false,
        limit: args.limit ?? 25,
      });
    }),
  );

  addTool<BriefArgs>(server,
    'get_product_for_gather',
    {
      title: 'Get a product to research',
      description:
        'Everything needed before researching one product: its brand, manufacturer part number and barcode; '
        + 'its eBay category; every field that category uses, named exactly as it must be reported, with the '
        + 'values eBay accepts where it restricts them; and what is already answered. If the product is not '
        + 'ready, "refusal" says why. Read-only.',
      inputSchema: {
        sku: z.string().min(1).max(100).describe('The product SKU, exactly.'),
        company: z.string().max(200).optional()
          .describe('Company name, only needed when the user has more than one company selling on eBay.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ sku, company }) => run(async () => {
      const companyId = await resolveCompany(deps, actor, company);
      const productId = await requireProduct(deps, sku);
      return deps.listing.researchBrief(productId, [companyId]);
    }),
  );

  addTool<SubmitArgs>(server,
    'submit_gather_findings',
    {
      title: 'Submit researched values',
      description:
        'Hand maSquare the values you found for one product, with the pages they came from. maSquare checks '
        + 'every page is about this product, then applies its own rules: values from the manufacturer\'s site '
        + 'are used directly; anything else needs two independent sources to agree, or is held back for a '
        + 'person to confirm. It never overwrites what a person entered. The reply lists what was used, held '
        + 'back, rejected and still missing. Submitting the same evidence twice changes nothing.',
      inputSchema: {
        sku: z.string().min(1).max(100).describe('The product SKU, exactly.'),
        sources: z.array(z.object({
          url: z.string().max(2000).describe('The exact URL of a page you read.'),
          pageBrand: z.string().max(120).nullish()
            .describe('The brand THIS PAGE shows for the product it describes. Omit if the page shows none.'),
          pagePartNumber: z.string().max(120).nullish()
            .describe('The part or model number THIS PAGE shows. Omit if the page shows none.'),
        })).max(30).describe('Every page any value came from.'),
        findings: z.array(z.object({
          field: z.string().max(80).describe('A field name exactly as get_product_for_gather gave it.'),
          value: z.string().max(300).describe('The value exactly as printed on the page, with its units.'),
          sourceUrl: z.string().max(2000).describe('The page that stated this value. It must be listed in sources.'),
        })).max(300).describe('Every value found. Report conflicting values from different pages separately.'),
        company: z.string().max(200).optional()
          .describe('Company name, only needed when the user has more than one company selling on eBay.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ sku, sources, findings, company }) => run(async () => {
      const companyId = await resolveCompany(deps, actor, company);
      const productId = await requireProduct(deps, sku);
      return deps.listing.submitResearch(productId, {
        companyIds: [companyId],
        userId: actor.sub,
        sources: sources.map((s) => ({ url: s.url, pageBrand: s.pageBrand ?? null, pagePartNumber: s.pagePartNumber ?? null })),
        findings,
      });
    }),
  );

  addTool<ContentArgs>(server,
    'submit_product_content',
    {
      title: 'Write the product description',
      description:
        'Write the buyer-facing words for a product: an introduction and short feature lines, as PLAIN PROSE. '
        + 'Never send HTML — maSquare renders the eBay description itself from one house template, and adds the '
        + 'specification table from values that already passed its checks, so every listing looks the same. '
        + 'The text must not contain our internal SKU, an email address, a phone number or a web address; eBay '
        + 'forbids the last three and the reply will say which line is wrong. Existing words are never replaced '
        + 'unless replaceExisting is true.',
      inputSchema: {
        sku: z.string().min(1).max(100).describe('The product SKU, exactly.'),
        intro: z.string().max(3000).nullish()
          .describe('Two or three short paragraphs about what the product is and who it suits. Blank lines separate paragraphs.'),
        features: z.array(z.string().max(240)).max(12).optional()
          .describe('Short selling points, one per line. No sentences longer than a line.'),
        replaceExisting: z.boolean().optional()
          .describe('Only true when the user has asked for existing words to be rewritten.'),
        company: z.string().max(200).optional()
          .describe('Company name, only needed when the user has more than one company selling on eBay.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ sku, intro, features, replaceExisting, company }) => run(async () => {
      const companyId = await resolveCompany(deps, actor, company);
      const productId = await requireProduct(deps, sku);
      // Resolved for its side effect: it refuses a product this user's companies cannot reach.
      void companyId;
      return deps.listing.submitProductContent(productId, {
        companyIds: [companyId],
        userId: actor.sub,
        intro: intro ?? null,
        features,
        replaceExisting,
      });
    }),
  );

  /**
   * The same job as a ready-made prompt, so it can be started without retyping the rules. Claude Code
   * lists it as a slash command.
   */
  addPrompt<{ skus: string }>(server,
    'gather_ebay_specifics',
    {
      title: 'Research eBay item specifics',
      description: 'Research eBay item specifics on the web for one or more maSquare products.',
      argsSchema: {
        skus: z.string().describe('One or more SKUs, separated by commas or spaces.'),
      },
    },
    ({ skus }) => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: [
            `Research eBay item specifics for these maSquare products: ${skus}`,
            '',
            'For each product: call get_product_for_gather. If it is not ready, note why and move on.',
            'Otherwise search the web following the maSquare connector rules, then call',
            'submit_gather_findings once with every page and value.',
            '',
            'When all are done, give me a short table: SKU, usable, held back, pages rejected, still missing.',
          ].join('\n'),
        },
      }],
    }),
  );

  return server;
}

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

/**
 * `server.registerTool`, with the SDK's generics taken out of the type checker's way.
 *
 * Called directly, the SDK infers each callback's arguments through several layers of zod-compat
 * types, and for tools with nested schemas TypeScript gives up ("type instantiation is excessively
 * deep") — while also slowing the whole API's typecheck from seconds to minutes. This helper infers
 * the arguments with plain `z.infer` instead and hands the SDK exactly the same config and schema.
 *
 * Nothing changes at runtime: the SDK still validates every call against the zod shape before the
 * callback sees it, so the loosening is purely in what the compiler has to work out.
 */
function addTool<A>(
  server: McpServer,
  name: string,
  config: {
    title: string;
    description: string;
    inputSchema: z.ZodRawShape;
    annotations: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
  },
  cb: (args: A) => Promise<ToolResult>,
): void {
  const register = server.registerTool.bind(server) as unknown as (n: string, c: unknown, f: unknown) => void;
  register(name, config, cb);
}

/** `server.registerPrompt`, generics erased for the same reason as `addTool`. */
function addPrompt<A>(
  server: McpServer,
  name: string,
  config: { title: string; description: string; argsSchema: z.ZodRawShape },
  cb: (args: A) => { messages: Array<{ role: 'user'; content: { type: 'text'; text: string } }> },
): void {
  const register = server.registerPrompt.bind(server) as unknown as (n: string, c: unknown, f: unknown) => void;
  register(name, config, cb);
}

/**
 * The argument shapes, written out rather than inferred from the schemas above them.
 *
 * The zod schemas remain the runtime truth — the SDK rejects a call that does not match one before
 * any code here runs. These exist only so the compiler can check the callbacks without walking the
 * SDK's generics. Keep each one in step with its schema; a mismatch shows up as a type error at the
 * call site, not as a wrong value reaching the database.
 */
interface CompanyArg { company?: string }
interface ListArgs extends CompanyArg { skus?: string[]; search?: string; onlyReady?: boolean; limit?: number }
interface BriefArgs extends CompanyArg { sku: string }
interface ContentArgs extends CompanyArg {
  sku: string;
  intro?: string | null;
  features?: string[];
  replaceExisting?: boolean;
}
interface SubmitArgs extends CompanyArg {
  sku: string;
  sources: Array<{ url: string; pageBrand?: string | null; pagePartNumber?: string | null }>;
  findings: Array<{ field: string; value: string; sourceUrl: string }>;
}

/**
 * Which company a call acts for.
 *
 * Decided from the ACTING USER's own grants, never from anything Claude sends: `company` only picks
 * among companies the user may already see. Both companies sell on eBay, and a plan written against
 * the wrong one is invisible to the other — so where it is ambiguous, the call fails and says which
 * names to choose from, rather than guessing.
 */
async function resolveCompany(deps: McpDeps, actor: AuthUser, requested?: string): Promise<string> {
  const allowed = await deps.scope.allowedIds(actor);
  if (allowed.length === 0) throw new UserFacing('The connector user has access to no companies.');

  const companies = await deps.prisma.company.findMany({
    where: { id: { in: allowed }, deletedAt: null },
    select: { id: true, officialName: true },
  });

  if (requested?.trim()) {
    const want = requested.trim().toLowerCase();
    const hits = companies.filter((c) => c.id === requested.trim() || c.officialName.toLowerCase() === want);
    if (hits.length === 1) return hits[0].id;
    throw new UserFacing(`No company called "${requested}". Choose one of: ${companies.map((c) => c.officialName).join(', ')}.`);
  }

  const withEbay = await deps.prisma.channelIntegration.findMany({
    where: { deletedAt: null, channelType: 'ebay', status: 'active', targetCompanyId: { in: allowed } },
    select: { targetCompanyId: true },
  });
  const ids = [...new Set(withEbay.map((r) => r.targetCompanyId).filter((x): x is string => !!x))];
  if (ids.length === 1) return ids[0];
  if (ids.length === 0) throw new UserFacing('None of your companies has an active eBay integration.');

  const names = companies.filter((c) => ids.includes(c.id)).map((c) => c.officialName);
  throw new UserFacing(`More than one of your companies sells on eBay (${names.join(', ')}). Ask the user which, then pass it as "company".`);
}

async function requireProduct(deps: McpDeps, sku: string): Promise<string> {
  const id = await deps.listing.productIdBySku(sku);
  if (!id) throw new UserFacing(`No product has the SKU "${sku}". SKUs are matched exactly.`);
  return id;
}

/** An error whose message is written for the person reading Claude's reply. */
class UserFacing extends Error {}

/**
 * Run a tool and shape its result for Claude.
 *
 * Refusals are returned as tool errors carrying their message — "choose a category first" is useful
 * to Claude and to the person. Anything unexpected is logged here in full and returned as a generic
 * failure, so a database error never carries internals into a chat transcript.
 */
async function run(fn: () => Promise<unknown>) {
  try {
    const out = await fn();
    return { content: [{ type: 'text' as const, text: JSON.stringify(out, null, 2) }] };
  } catch (e) {
    let message = 'maSquare could not complete that request. The details are in the server log.';
    if (e instanceof UserFacing) message = e.message;
    else if (e instanceof HttpException) {
      const body = e.getResponse();
      const text = typeof body === 'string' ? body : (body as { message?: string | string[] })?.message;
      message = Array.isArray(text) ? text.join('; ') : text ?? e.message;
    } else {
      logger.error(`Connector tool failed: ${(e as Error)?.message ?? e}`, (e as Error)?.stack);
    }
    return { isError: true, content: [{ type: 'text' as const, text: message }] };
  }
}
