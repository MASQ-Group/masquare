import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationsService } from '../../integrations/integrations.service';
import { ActivityService } from '../../activity/activity.service';
import { ProductFactsService } from '../../gather/product-facts.service';
import { diffRecords } from '../../activity/diff';
import { PRODUCT_FIELD_LABELS } from '../../activity/product-fields';
import { canGather, foldFindings } from '../../gather/gather-rules';
import { screenResearch, type ResearchedFinding, type ResearchedSource } from '../../gather/screen-research';
import { checkBuyerText } from '../../gather/buyer-text';
import {
  applyUserEdits, classifyAspect, eligibleValues, isPayloadEligible, normaliseAspects, toJson, verifyAspect,
  type AspectRecord,
} from '../../gather/provenance';
import { htmlToPlainText, proseToHtml } from '../ebay/description-template';
import { normaliseExtras } from '../ebay/description-extras';
import {
  normaliseSafety, onbuyProductData, onbuySafetyBody, parseOnbuyFields, resolveOnbuyFields, ONBUY_TITLE_MAX,
  type OnbuyField, type OnbuySafety,
} from './onbuy-fields';
import { ONBUY_MAX_SUMMARY_POINTS } from './onbuy-product';

/** How long a category's field list is trusted before OnBuy is asked again. */
const FIELD_CACHE_MS = 30 * 60 * 1000;

/**
 * OnBuy content: the words and product data sent when the platform CREATES a product on OnBuy.
 *
 * The same process as eBay content, on OnBuy's terms. A person picks the OnBuy category (it decides
 * which features and technical details exist); Claude researches through the maSquare connector and
 * writes the title, description and summary points; every researched value passes the same identity
 * screen and folding rules as eBay's, and only payload-eligible values are ever sent.
 *
 * Evidence is reused, not repeated: the pages already accepted for this product's eBay specifics are
 * handed to the researcher, and the specifics verified there become OnBuy's product-data table.
 */
@Injectable()
export class OnbuyContentService {
  private readonly logger = new Logger(OnbuyContentService.name);
  private readonly fieldCache = new Map<string, { at: number; fields: OnbuyField[] }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly activity: ActivityService,
    private readonly facts: ProductFactsService,
  ) {}

  /** The OnBuy connection: the one named, or the only one in the caller's companies. */
  async integrationFor(integrationId?: string, companyIds?: string[]) {
    const scope = companyIds ? { targetCompanyId: { in: companyIds } } : {};
    const rows = await this.prisma.channelIntegration.findMany({
      where: { deletedAt: null, channelType: 'onbuy', ...(integrationId ? { id: integrationId } : {}), ...scope },
      select: { id: true, name: true, marketplace: true, targetCompanyId: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!rows.length) throw new NotFoundException('No OnBuy connection is set up for this company.');
    if (!integrationId && rows.length > 1) throw new BadRequestException('More than one OnBuy connection — say which.');
    return rows[0];
  }

  private plan(productId: string, integration: { id: string; marketplace: string | null }) {
    return this.prisma.productChannelPlan.findFirst({
      where: { productId, integrationId: integration.id, marketplace: integration.marketplace ?? '', deletedAt: null },
      select: { id: true, categoryRef: true, categoryName: true, specifics: true, safetyContent: true },
    });
  }

  /** A category's features and technical details, cached for half an hour. */
  async categoryFields(integrationId: string, categoryId: string): Promise<OnbuyField[]> {
    const key = `${integrationId}:${categoryId}`;
    const hit = this.fieldCache.get(key);
    if (hit && Date.now() - hit.at < FIELD_CACHE_MS) return hit.fields;
    const [features, technical] = await Promise.all([
      this.integrations.onbuyCategoryFeatures(integrationId, categoryId),
      this.integrations.onbuyCategoryTechnicalDetails(integrationId, categoryId),
    ]);
    if (!features.ok) throw new BadRequestException(`OnBuy would not list this category's features (HTTP ${features.status}).`);
    // Technical details are optional everywhere; a category without them answers with an error on some sites.
    const fields = parseOnbuyFields(features.rows, technical.ok ? technical.rows : []);
    this.fieldCache.set(key, { at: Date.now(), fields });
    return fields;
  }

  /** The product's eBay evidence: pages already accepted there, and the specifics verified there. */
  private async ebayEvidence(productId: string) {
    const plans = await this.prisma.productChannelPlan.findMany({
      where: { productId, deletedAt: null, integration: { channelType: 'ebay', deletedAt: null } },
      select: { aspects: true, descriptionExtras: true },
    });
    const pages = new Map<string, { url: string; kind: string; label: string | null }>();
    const verified: Record<string, string> = {};
    let groups: Record<string, string> = {};
    for (const p of plans) {
      const records = normaliseAspects(p.aspects);
      Object.assign(verified, eligibleValues(records));
      for (const rec of Object.values(records)) {
        for (const o of rec.origins) {
          if (o.kind !== 'user' && o.url && !pages.has(o.url)) pages.set(o.url, { url: o.url, kind: o.kind, label: o.label ?? null });
        }
      }
      groups = { ...groups, ...normaliseExtras(p.descriptionExtras).groups };
    }
    return { pages: [...pages.values()].slice(0, 30), verified, groups };
  }

  private async product(productId: string) {
    const p = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: {
        id: true, mainSku: true, title: true, manufacturerSku: true, ean: true, upc: true, manufacturerUrls: true,
        onbuyTitle: true, onbuyDescriptionHtml: true, onbuySummaryPoints: true, onbuyAiModel: true,
        brand: { select: { name: true, website: true } },
        aliases: { where: { deletedAt: null }, select: { skuValue: true } },
      },
    });
    if (!p) throw new NotFoundException('Product not found');
    return p;
  }

  /** Each field with its stored answer and where that answer came from. */
  private describeFields(fields: OnbuyField[], records: Record<string, AspectRecord>) {
    return fields.map((f) => {
      const rec = records[f.name];
      return {
        ...f,
        current: rec
          ? {
            value: rec.value,
            basis: classifyAspect(rec),
            heldBack: !isPayloadEligible(rec),
            verifiedAt: rec.verifiedAt ?? null,
            origins: rec.origins.map((o) => ({ kind: o.kind, value: o.value, url: o.url ?? null, label: o.label ?? null, at: o.at ?? null })),
          }
          : null,
      };
    });
  }

  // ------------------------------------------------------------------ the OnBuy content tab

  /** Everything the OnBuy content tab shows. Read-only. */
  async view(productId: string, integrationId: string | undefined, companyIds: string[]) {
    const integration = await this.integrationFor(integrationId, companyIds);
    const [plan, evidence] = await Promise.all([this.plan(productId, integration), this.ebayEvidence(productId)]);
    const records = normaliseAspects(plan?.specifics);
    let fields: OnbuyField[] = [];
    let fieldsProblem: string | null = null;
    if (plan?.categoryRef) {
      try { fields = await this.categoryFields(integration.id, plan.categoryRef); }
      catch (e: any) { fieldsProblem = e?.message ?? 'OnBuy could not be asked about this category.'; }
    }
    const resolved = resolveOnbuyFields(fields, records);
    return {
      integrationId: integration.id,
      category: plan?.categoryRef ? { id: plan.categoryRef, name: plan.categoryName ?? null } : null,
      fields: this.describeFields(fields, records),
      fieldsProblem,
      missing: resolved.missing,
      rejected: resolved.rejected,
      safety: normaliseSafety(plan?.safetyContent),
      productData: onbuyProductData(evidence.verified, evidence.groups),
      reusablePages: evidence.pages.length,
    };
  }

  /** A person's edits to the answers and the safety text. An empty answer deletes it. */
  async save(
    productId: string,
    integrationId: string | undefined,
    body: { edits?: Record<string, string | null>; safety?: Partial<OnbuySafety> },
    userId: string | undefined,
    companyIds: string[],
  ) {
    const integration = await this.integrationFor(integrationId, companyIds);
    const plan = await this.plan(productId, integration);
    if (!plan) throw new BadRequestException('Choose an OnBuy category first.');
    const data: Record<string, unknown> = {};
    if (body.edits && Object.keys(body.edits).length) {
      const edits = Object.fromEntries(Object.entries(body.edits).map(([k, v]) => [k, (v ?? '').toString()]));
      data.specifics = toJson(applyUserEdits(normaliseAspects(plan.specifics), edits, new Date().toISOString()));
    }
    if (body.safety) data.safetyContent = { ...normaliseSafety({ ...normaliseSafety(plan.safetyContent), ...body.safety }) };
    if (!Object.keys(data).length) return this.view(productId, integration.id, companyIds);
    await this.prisma.productChannelPlan.update({ where: { id: plan.id }, data: { ...data, ...(userId ? { updatedById: userId } : {}) } });
    return this.view(productId, integration.id, companyIds);
  }

  /** A person has read where an answer came from and accepts it — the one way a held-back value is sent. */
  async confirm(productId: string, integrationId: string | undefined, name: string, userId: string | undefined, companyIds: string[]) {
    const integration = await this.integrationFor(integrationId, companyIds);
    const plan = await this.plan(productId, integration);
    const records = normaliseAspects(plan?.specifics);
    const rec = records[name];
    if (!plan || !rec) throw new NotFoundException(`Nothing is stored for "${name}".`);
    const next = { ...records, [name]: verifyAspect(rec, new Date().toISOString(), userId) };
    await this.prisma.productChannelPlan.update({ where: { id: plan.id }, data: { specifics: toJson(next), ...(userId ? { updatedById: userId } : {}) } });
    return this.view(productId, integration.id, companyIds);
  }

  // ------------------------------------------------------------------ the maSquare connector

  /** What a researcher needs before searching for one product's OnBuy data. Read-only. */
  async brief(productId: string, companyIds: string[]) {
    const integration = await this.integrationFor(undefined, companyIds);
    const [p, plan, evidence] = await Promise.all([this.product(productId), this.plan(productId, integration), this.ebayEvidence(productId)]);
    const verdict = canGather({ manufacturerSku: p.manufacturerSku, ean: p.ean, upc: p.upc, brand: p.brand?.name ?? null, title: p.title });
    let fields: OnbuyField[] = [];
    let fieldsProblem: string | null = null;
    if (plan?.categoryRef) {
      try { fields = await this.categoryFields(integration.id, plan.categoryRef); }
      catch (e: any) { fieldsProblem = e?.message ?? 'OnBuy could not be asked about this category.'; }
    }
    const refusal = !verdict.ok
      ? verdict.reason
      : !plan?.categoryRef
        ? 'No OnBuy category has been chosen for this product. A person picks it on the OnBuy content tab; it decides which fields exist.'
        : fieldsProblem;
    const records = normaliseAspects(plan?.specifics);
    const safety = normaliseSafety(plan?.safetyContent);

    return {
      channel: 'onbuy' as const,
      sku: p.mainSku,
      title: p.title,
      brand: p.brand?.name ?? null,
      manufacturerSku: p.manufacturerSku,
      ean: p.ean,
      upc: p.upc,
      ready: refusal === null,
      refusal,
      onbuyCategory: plan?.categoryRef ? { id: plan.categoryRef, name: plan.categoryName ?? null } : null,
      pagesNominatedByAPerson: p.manufacturerUrls,
      /**
       * Pages already screened and accepted for this product's eBay research. Read these first: they
       * are known to be this exact model, and a finding from them needs no new search.
       */
      pagesAlreadyAccepted: evidence.pages,
      /** Facts already verified for eBay. They become OnBuy's specification table as they are. */
      factsAlreadyVerified: evidence.verified,
      fields: fields.map((f) => {
        const rec = records[f.name];
        return {
          name: f.name,
          kind: f.kind,
          required: f.kind === 'feature' ? f.required : false,
          acceptedValues: f.kind === 'feature' ? f.options.map((o) => o.name).slice(0, 120) : null,
          acceptedValuesTotal: f.kind === 'feature' ? f.options.length : null,
          // Null means "not a measurement": this detail takes plain text, and inventing a unit for
          // it is what produced Colour "Black" being checked against a list of units that is empty.
          units: f.kind === 'technical' && f.units.length ? f.units : null,
          current: rec ? { value: rec.value, basis: classifyAspect(rec), heldBackForAPerson: !isPayloadEligible(rec) } : null,
        };
      }),
      content: {
        title: p.onbuyTitle,
        description: htmlToPlainText(p.onbuyDescriptionHtml) || null,
        summaryPoints: p.onbuySummaryPoints,
        safety,
      },
      limits: { title: ONBUY_TITLE_MAX, titleRecommended: 70, summaryPoints: ONBUY_MAX_SUMMARY_POINTS },
    };
  }

  /** The connector's research write, folded by the same rules as eBay's. */
  async submitResearch(
    productId: string,
    args: { companyIds: string[]; userId?: string; sources: ResearchedSource[]; findings: ResearchedFinding[] },
  ) {
    const integration = await this.integrationFor(undefined, args.companyIds);
    const [p, plan] = await Promise.all([this.product(productId), this.plan(productId, integration)]);
    const verdict = canGather({ manufacturerSku: p.manufacturerSku, ean: p.ean, upc: p.upc, brand: p.brand?.name ?? null, title: p.title });
    if (!verdict.ok) throw new BadRequestException(verdict.reason);
    if (!plan?.categoryRef) throw new BadRequestException('Choose an OnBuy category first — it decides which fields exist.');
    const fields = await this.categoryFields(integration.id, plan.categoryRef);
    const names = fields.map((f) => f.name);

    const screened = screenResearch(
      { brand: p.brand?.name ?? null, brandWebsite: p.brand?.website ?? null, mpn: p.manufacturerSku },
      args.sources,
      args.findings,
    );
    const at = new Date().toISOString();
    /**
     * The same findings, kept for every channel as well as for OnBuy.
     *
     * A colour found here used to be invisible to eBay and to Jinius, which sent Claude to find it
     * again - and a value each channel found once from a retailer stayed held back on both, because
     * neither could see that two sources now agreed.
     */
    await this.facts.remember(p.id, screened.accepted, at, args.userId);
    const existing = normaliseAspects(plan.specifics);
    const { records, ignored, touched } = foldFindings(existing, screened.accepted, names, at);
    if (touched.some((t) => t.changed)) {
      await this.prisma.productChannelPlan.update({
        where: { id: plan.id },
        data: { specifics: toJson(records), ...(args.userId ? { updatedById: args.userId } : {}) },
      });
    }
    const resolved = resolveOnbuyFields(fields, records);
    const usable = touched.filter((t) => isPayloadEligible(records[t.name]));
    this.logger.log(`OnBuy research for ${p.mainSku}: ${screened.accepted.length} findings accepted, ${usable.length} usable`);
    return {
      ok: true as const,
      channel: 'onbuy' as const,
      sku: p.mainSku,
      acceptedPages: screened.acceptedSources,
      rejectedPages: screened.rejectedSources,
      droppedFindings: screened.dropped,
      filled: usable.length,
      heldBack: touched.length - usable.length,
      touched,
      ignored,
      /** Required features still without a usable answer, and answers OnBuy cannot take. */
      stillMissing: resolved.missing,
      cannotSend: resolved.rejected,
    };
  }

  /** The connector's content write: title, description, summary points and safety text. */
  async submitContent(
    productId: string,
    args: {
      companyIds: string[]; userId?: string;
      title?: string | null; intro?: string | null; summaryPoints?: string[];
      safety?: Partial<OnbuySafety>; model?: string | null; replaceExisting?: boolean;
    },
  ) {
    const integration = await this.integrationFor(undefined, args.companyIds);
    const p = await this.product(productId);
    const title = args.title?.replace(/\s+/g, ' ').trim() || null;
    const intro = args.intro?.trim() || null;
    const points = (args.summaryPoints ?? []).map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const safety = normaliseSafety(args.safety ?? {});
    const anySafety = !!(safety.warnings || safety.usageInstructions || safety.ingredients);
    if (!title && !intro && !points.length && !anySafety) throw new BadRequestException('Nothing to write: send a title, a description, summary points or safety text.');

    const forbidden = [p.mainSku, ...p.aliases.map((a) => a.skuValue)];
    const problems = checkBuyerText({ title, intro, features: points }, forbidden, { marketplace: 'OnBuy', titleMax: ONBUY_TITLE_MAX, maxFeatures: ONBUY_MAX_SUMMARY_POINTS });
    for (const [where, text] of [['warnings', safety.warnings], ['usage instructions', safety.usageInstructions], ['ingredients', safety.ingredients]] as const) {
      if (text) problems.push(...checkBuyerText({ intro: text }, forbidden, { marketplace: 'OnBuy' }).map((x) => ({ ...x, where })));
    }
    if (problems.length) {
      throw new BadRequestException(`Not written — ${problems.map((x) => `${x.where} ${x.problem}`).join('; ')}.`);
    }

    const wrote: string[] = [];
    const skipped: string[] = [];
    const data: Record<string, unknown> = {};
    const keep = (has: boolean, name: string) => {
      if (has && !args.replaceExisting) { skipped.push(`${name} (already written — ask for it to be replaced)`); return false; }
      return true;
    };
    if (title && keep(!!p.onbuyTitle?.trim(), 'title')) { data.onbuyTitle = title; wrote.push('title'); }
    if (intro && keep(!!htmlToPlainText(p.onbuyDescriptionHtml).trim(), 'description')) { data.onbuyDescriptionHtml = proseToHtml(intro); wrote.push('description'); }
    if (points.length && keep(p.onbuySummaryPoints.length > 0, 'summary points')) { data.onbuySummaryPoints = points; wrote.push('summary points'); }
    if (Object.keys(data).length) {
      // OnBuy is told the content is AI-written; the model is what Claude reports itself as.
      data.onbuyAiModel = args.model?.trim().slice(0, 80) || 'Claude (Anthropic)';
      if (args.userId) data.updatedById = args.userId;
      const before = { onbuyTitle: p.onbuyTitle, onbuyDescriptionHtml: p.onbuyDescriptionHtml, onbuySummaryPoints: p.onbuySummaryPoints, onbuyAiModel: p.onbuyAiModel };
      await this.prisma.product.update({ where: { id: productId }, data });
      const { updatedById: _drop, ...after } = data;
      await this.activity.record({
        entityType: 'product', entityId: productId, entityLabel: p.mainSku, action: 'update', source: 'system',
        actorId: args.userId,
        summary: `OnBuy content written: ${wrote.join(', ')}`,
        changes: diffRecords(before, after, { labels: PRODUCT_FIELD_LABELS }),
      });
    }

    if (anySafety) {
      const plan = await this.plan(productId, integration);
      if (!plan) skipped.push('safety text (choose an OnBuy category first, so there is an OnBuy plan to keep it on)');
      else {
        const current = normaliseSafety(plan.safetyContent);
        const next = { ...current };
        for (const k of ['warnings', 'usageInstructions', 'ingredients'] as const) {
          if (!safety[k]) continue;
          if (current[k] && !args.replaceExisting) { skipped.push(`safety ${k} (already written — ask for it to be replaced)`); continue; }
          next[k] = safety[k];
          wrote.push(`safety ${k}`);
        }
        await this.prisma.productChannelPlan.update({ where: { id: plan.id }, data: { safetyContent: { ...next }, ...(args.userId ? { updatedById: args.userId } : {}) } });
      }
    }
    return { ok: true as const, channel: 'onbuy' as const, sku: p.mainSku, wrote, skipped };
  }

  // ------------------------------------------------------------------ creating the product

  /**
   * The OnBuy-content parts of a new product: its words, the category's features and technical
   * details, the spec table, safety text and documents, and the AI flag. With what still stops it.
   */
  async createParts(productId: string, integration: { id: string; marketplace: string | null }, categoryRef: string | null) {
    const [p, plan, evidence, docs] = await Promise.all([
      this.product(productId),
      this.plan(productId, integration),
      this.ebayEvidence(productId),
      this.prisma.productDocument.findMany({ where: { productId, deletedAt: null }, orderBy: { sortOrder: 'asc' }, select: { name: true, url: true } }),
    ]);
    const missing: string[] = [];
    let fields: OnbuyField[] = [];
    if (categoryRef) {
      try { fields = await this.categoryFields(integration.id, categoryRef); }
      catch (e: any) { missing.push(`OnBuy's field list for the category (${e?.message ?? 'not available'})`); }
    }
    const resolved = resolveOnbuyFields(fields, normaliseAspects(plan?.specifics));
    for (const name of resolved.missing) missing.push(`OnBuy field "${name}" — answer it on the OnBuy content tab`);
    const safety = onbuySafetyBody(normaliseSafety(plan?.safetyContent));
    return {
      name: p.onbuyTitle?.trim() || null,
      description: htmlToPlainText(p.onbuyDescriptionHtml).trim() ? p.onbuyDescriptionHtml!.trim() : null,
      summaryPoints: p.onbuySummaryPoints.map((s) => s.trim()).filter(Boolean),
      features: resolved.features,
      technical: resolved.technical,
      rejected: resolved.rejected,
      productData: onbuyProductData(evidence.verified, evidence.groups),
      safety,
      // Only PDFs: OnBuy's safety documents are attachments, and our documents are public by design.
      safetyDocuments: docs.filter((d) => /\.pdf(\?|$)/i.test(d.url)).slice(0, 10).map((d) => ({ label: d.name.slice(0, 100), url: d.url, language: 'en' })),
      aiModel: p.onbuyAiModel,
      missing,
    };
  }
}
