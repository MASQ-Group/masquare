/**
 * What evidence is actually stored behind one product's eBay item specifics.
 *
 *   REPORT=ebay-aspect-origins bash scripts/prod-scan.sh
 *
 * Reads the raw stored JSON — not through the application's reader — which is the point. The reader
 * had a bug that discarded `web` sources, so what the screen showed could not be trusted to reflect
 * what was saved. This looks underneath it, to tell "the evidence is intact and only the reading was
 * wrong" apart from "the evidence was lost and written back without it". Reads only.
 */
const { PrismaClient } = require('@prisma/client');

const SKU = 'LAG-A158WEA-9EF';

(async () => {
  const p = new PrismaClient();
  const product = await p.product.findFirst({
    where: { mainSku: SKU, deletedAt: null },
    select: { id: true, mainSku: true, shortDescription: true, descriptionHtml: true, keyFeatures: true },
  });
  if (!product) { console.log(`No product ${SKU}`); await p.$disconnect(); return; }

  const plans = await p.productChannelPlan.findMany({
    where: { productId: product.id, deletedAt: null, integration: { channelType: 'ebay' } },
    select: { categoryName: true, aspects: true, updatedAt: true },
  });

  /**
   * Who changed the product's copy, and when. The research wrote a description and features at a
   * logged time and they were empty afterwards — so something saved over them, and the activity log
   * is the only record of what. Field NAMES and lengths only; the copy itself is not printed.
   */
  const acts = await p.activity.findMany({
    where: { entityType: 'product', entityId: product.id },
    select: { action: true, source: true, actorId: true, summary: true, changes: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
    take: 40,
  });
  const actorIds = [...new Set(acts.map((a) => a.actorId).filter(Boolean))];
  const users = actorIds.length
    ? await p.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, email: true } })
    : [];
  const who = (id) => (id ? users.find((u) => u.id === id)?.email ?? id.slice(0, 8) : 'system');
  /**
   * Changes are stored as a LIST of { field, label, from, to } — reading them as an object keyed by
   * field found nothing, so every copy write looked like an unrelated update. Every changed field is
   * named; copy fields also show lengths before and after, never the words.
   */
  const COPY = /shortDescription|descriptionHtml|keyFeatures|ebayTitle/i;
  const len = (v) => (v == null || v === '' ? 'empty' : `${String(v).replace(/<[^>]*>/g, '').trim().length} chars`);
  console.log('PRODUCT ACTIVITY (copy fields show length before -> after)');
  for (const a of acts) {
    const list = Array.isArray(a.changes) ? a.changes : [];
    const fields = list.map((c) => (COPY.test(c.field) ? `${c.field}[${len(c.from)} -> ${len(c.to)}]` : c.field));
    console.log(`  ${a.createdAt.toISOString()}  ${a.action.padEnd(7)} ${String(a.source).padEnd(6)} ${who(a.actorId).padEnd(26)} ${fields.join(', ')}`);
  }
  console.log('');

  const strip = (h) => (h || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  console.log(`${SKU}`);
  console.log(`  short description : ${strip(product.shortDescription).length} chars`);
  console.log(`  description       : ${strip(product.descriptionHtml).length} chars`);
  console.log(`  key features      : ${Array.isArray(product.keyFeatures) ? product.keyFeatures.length : 0}\n`);

  for (const plan of plans) {
    const aspects = plan.aspects && typeof plan.aspects === 'object' ? plan.aspects : {};
    const names = Object.keys(aspects);
    console.log(`Category ${plan.categoryName}  —  ${names.length} stored answers  (plan last saved ${plan.updatedAt.toISOString()})`);

    const tally = { withWeb: 0, withUser: 0, noOrigins: 0, bareString: 0 };
    for (const name of names) {
      const rec = aspects[name];
      if (typeof rec === 'string') { tally.bareString++; continue; }
      const origins = Array.isArray(rec?.origins) ? rec.origins : [];
      if (origins.length === 0) tally.noOrigins++;
      if (origins.some((o) => o.kind === 'web')) tally.withWeb++;
      if (origins.some((o) => o.kind === 'user')) tally.withUser++;
    }
    console.log(`  still carrying web sources : ${tally.withWeb}`);
    console.log(`  carrying a user origin     : ${tally.withUser}`);
    console.log(`  NO sources at all          : ${tally.noOrigins}   <- evidence lost if this is non-zero`);
    console.log(`  bare legacy strings        : ${tally.bareString}\n`);

    for (const name of names.slice(0, 8)) {
      const rec = aspects[name];
      if (typeof rec === 'string') { console.log(`  ${name.padEnd(22)} "${rec}" (bare string)`); continue; }
      const kinds = (rec.origins || []).map((o) => {
        let host = '';
        try { host = o.url ? new URL(o.url).hostname.replace(/^www\./, '') : ''; } catch { /* keep blank */ }
        return host ? `${o.kind}@${host}` : o.kind;
      });
      console.log(`  ${name.padEnd(22)} ${String(rec.value).slice(0, 26).padEnd(28)} ${kinds.join(', ') || '(no sources)'}`);
    }
  }
  await p.$disconnect();
})().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
