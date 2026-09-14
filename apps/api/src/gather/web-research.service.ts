import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import type { SourceFinding } from './gather-rules';
import { classifySourceUrl } from './source-kind';

/**
 * Searching the web for what a product actually is, via Claude.
 *
 * This exists because the authoritative source was unreachable in practice. Of 3,337 products none
 * carried a datasheet and none of 236 brands carried a website, so "read the manufacturer's page"
 * meant "somebody pastes a URL for every product". Claude can find those pages.
 *
 * What it is NOT allowed to do is the whole design. Claude is a WITNESS here, never the judge:
 *
 *   - It reports what a page states, copied exactly, with the address of the page that stated it.
 *   - It never converts, calculates, rounds, infers or merges.
 *   - It never decides which answer is right. Every finding goes back through the same rules as
 *     Amazon's and a nominated page's — identity checked, manufacturer authoritative, two
 *     independent sources otherwise, anything less held back for a person.
 *
 * The temptation is to let a capable model simply fill the form in. It would, fluently, including
 * for fields it never actually found — which is the same failure as the Panasonic that came back
 * branded Marley, only harder to spot because the wrong answer reads beautifully. So the model is
 * given a narrow job and the evidence it produces is checked by code that cannot be persuaded.
 */
@Injectable()
export class WebResearchService {
  private readonly logger = new Logger(WebResearchService.name);
  private readonly client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

  /** Reading is the expensive part, so the search count is capped rather than left to judgement. */
  private static readonly MAX_SEARCHES = 4;
  private static readonly MAX_TURNS = 6;
  /**
   * `||`, not `??`. An unset override is written `GATHER_MODEL=""` in the env file, and an empty
   * string is not nullish — it would be sent to the API as the model name and rejected with a 400.
   */
  private static readonly MODEL = process.env.GATHER_MODEL?.trim() || 'claude-sonnet-5';

  get available(): boolean {
    return this.client !== null;
  }

  async research(
    product: { brand: string | null; brandWebsite: string | null; mpn: string; gtin: string; gtinKind: string; title: string | null },
    aspectNames: readonly string[],
  ): Promise<{ ok: boolean; message?: string; findings: SourceFinding[]; searches: number; costHint: string }> {
    if (!this.client) {
      return { ok: false, message: 'no ANTHROPIC_API_KEY is configured on this server', findings: [], searches: 0, costHint: '' };
    }
    if (aspectNames.length === 0) {
      return { ok: true, findings: [], searches: 0, costHint: '' };
    }

    /**
     * The aspect names are handed over verbatim so findings come back under the names this category
     * actually uses. Left to invent its own labels, the model returns perfectly good facts under
     * headings nothing matches, and they are discarded downstream as unrecognised.
     */
    const system = [
      'You research consumer products and report ONLY what web pages explicitly state.',
      '',
      'Rules, in order of importance:',
      '1. Copy every value EXACTLY as printed on the page, including its units and spelling. Never',
      '   convert units, never calculate, never round, never tidy up, never translate.',
      '2. Report a field only if a page states it outright. If you cannot find it, omit it. Never',
      '   infer a value from a product name, a photo, a similar model, or your own knowledge.',
      '3. Every finding must carry the exact URL of the page that stated it. Never attribute a value',
      '   to a page that did not state it.',
      '4. If two pages state the same field differently, report BOTH as separate findings. Do not',
      '   choose between them and do not merge them — disagreement is information.',
      '5. Prefer the manufacturer\'s own website. Retailer and marketplace pages are acceptable but',
      '   are frequently wrong, so they matter most when they corroborate each other.',
      '6. Do not report Brand, MPN or Model. Those are already known.',
      '',
      'You are gathering evidence, not filling in a form. A missing field is fine. A field filled in',
      'with something you did not actually read on a page is a serious error.',
    ].join('\n');

    const identity = [
      product.brand ? `Brand: ${product.brand}` : null,
      `Manufacturer part number: ${product.mpn}`,
      `${product.gtinKind}: ${product.gtin}`,
      product.title ? `Our title for it: ${product.title}` : null,
    ].filter(Boolean).join('\n');

    const prompt = [
      'Find the specifications for this exact product. The part number and barcode identify it —',
      'make sure the page you read is this model and not a neighbouring one.',
      '',
      identity,
      '',
      'Report values for any of these fields you can find stated on a page:',
      aspectNames.map((n) => `- ${n}`).join('\n'),
      '',
      'When you have finished looking, call report_findings once with everything you found.',
      'Call it with an empty list if you found nothing.',
    ].join('\n');

    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: prompt }];
    let searches = 0;
    let inTokens = 0;
    let outTokens = 0;

    try {
      for (let turn = 0; turn < WebResearchService.MAX_TURNS; turn += 1) {
        const res = await this.client.messages.create({
          model: WebResearchService.MODEL,
          max_tokens: 8000,
          system,
          messages,
          tools: [
            /**
             * Dynamic filtering: Claude filters the search results in code before they reach its
             * context. On a job that reads several pages per product that is most of the token bill.
             */
            { type: 'web_search_20260209', name: 'web_search', max_uses: WebResearchService.MAX_SEARCHES },
            {
              name: 'report_findings',
              description: 'Report every field value you read on a page, with the page that stated it.',
              strict: true,
              input_schema: {
                type: 'object',
                additionalProperties: false,
                required: ['findings'],
                properties: {
                  findings: {
                    type: 'array',
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['field', 'value', 'sourceUrl'],
                      properties: {
                        field: { type: 'string', description: 'One of the field names you were given, copied exactly.' },
                        value: { type: 'string', description: 'The value exactly as printed on the page, with its units.' },
                        sourceUrl: { type: 'string', description: 'The URL of the page that stated this value.' },
                      },
                    },
                  },
                },
              },
            },
          ],
        });

        inTokens += res.usage.input_tokens ?? 0;
        outTokens += res.usage.output_tokens ?? 0;
        searches += res.usage.server_tool_use?.web_search_requests ?? 0;

        /** A long search turn can be paused; resuming means sending it back untouched. */
        if (res.stop_reason === 'pause_turn') {
          messages.push({ role: 'assistant', content: res.content });
          continue;
        }

        const report = res.content.find(
          (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'report_findings',
        );
        if (report) {
          const findings = this.toFindings(report.input, product);
          const costHint = `${searches} searches, ${Math.round((inTokens + outTokens) / 1000)}k tokens`;
          this.logger.log(`Web research for ${product.mpn}: ${findings.length} findings (${costHint})`);
          return { ok: true, findings, searches, costHint };
        }

        /** It answered in prose instead of calling the tool. Ask once, plainly, then give up. */
        if (res.stop_reason === 'end_turn' && turn < WebResearchService.MAX_TURNS - 1) {
          messages.push({ role: 'assistant', content: res.content });
          messages.push({ role: 'user', content: 'Call report_findings now with what you found, or with an empty list.' });
          continue;
        }

        return { ok: false, message: 'the search finished without reporting anything usable', findings: [], searches, costHint: '' };
      }

      return { ok: false, message: 'the search did not finish in time', findings: [], searches, costHint: '' };
    } catch (e) {
      // Typed first, so a spending or key problem reads as itself rather than as "search failed".
      if (e instanceof Anthropic.AuthenticationError) return this.failed('the Claude API key was rejected', searches);
      if (e instanceof Anthropic.RateLimitError) return this.failed('the Claude API is rate limiting us — try again shortly', searches);
      if (e instanceof Anthropic.APIError) return this.failed(`the Claude API returned ${e.status}`, searches);
      return this.failed('the search could not be run', searches);
    }
  }

  private failed(message: string, searches: number) {
    this.logger.warn(`Web research failed: ${message}`);
    return { ok: false, message, findings: [], searches, costHint: '' };
  }

  /**
   * Turn what the model reported into findings, dropping anything that cannot be checked.
   *
   * A finding with no usable URL is thrown away rather than kept, however plausible it looks: the
   * address is what makes it evidence rather than an assertion, and it is what a person clicks when
   * they want to see for themselves.
   */
  private toFindings(raw: unknown, product: { brand: string | null; brandWebsite: string | null }): SourceFinding[] {
    const rows = (raw as { findings?: unknown })?.findings;
    if (!Array.isArray(rows)) return [];

    const out: SourceFinding[] = [];
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      const field = typeof r.field === 'string' ? r.field.trim() : '';
      const value = typeof r.value === 'string' ? r.value.trim() : '';
      const url = typeof r.sourceUrl === 'string' ? r.sourceUrl.trim() : '';
      if (!field || !value || !url) continue;

      let host: string;
      try {
        host = new URL(url).hostname.replace(/^www\./, '');
      } catch {
        continue; // Not an address, so not evidence.
      }

      /**
       * Which kind of source this is decides whether the value can publish or must be confirmed —
       * and it is decided HERE, from the URL, not by asking the model what it thinks it read.
       */
      const kind = classifySourceUrl(url, { name: product.brand, website: product.brandWebsite });
      out.push({ field, value, kind, url, label: host });
    }
    return out;
  }
}
