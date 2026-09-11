/** The destination rates the VAT fallback depends on, against the rates Amazon actually applied. */
const { PrismaClient } = require('@prisma/client');
const AMAZON_APPLIED = { IE: 23, MT: 18, FR: 20, DE: 19, ES: 21, IT: 22, NL: 21, BE: 21, SE: 25, PL: 23, AT: 20, LU: 17, GB: 20 };
(async () => {
  const p = new PrismaClient();
  const rows = await p.country.findMany({
    where: { deletedAt: null, isoCode: { in: Object.keys(AMAZON_APPLIED) } },
    select: { isoCode: true, name: true, vatRate: true, euVatZone: true },
    orderBy: { isoCode: 'asc' },
  });
  const have = new Map(rows.map((r) => [r.isoCode, r]));
  let wrong = 0;
  console.log('  iso  amazon   ours   euVatZone');
  for (const [iso, amz] of Object.entries(AMAZON_APPLIED).sort()) {
    const r = have.get(iso);
    const ours = r ? Number(r.vatRate) : null;
    const bad = ours == null || Math.abs(ours - amz) > 0.01;
    if (bad) wrong += 1;
    console.log(`  ${iso}   ${String(amz).padStart(5)}%  ${String(ours ?? 'MISSING').padStart(5)}%  ${r?.euVatZone ?? '—'}   ${bad ? '  <-- differs' : ''}`);
  }
  console.log(`\n  rates that would produce a wrong fallback: ${wrong}`);
  await p.$disconnect();
})().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
