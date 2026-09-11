/**
 * Countries outside the EU VAT zone (and outside the UK) that still carry a non-zero rate.
 *
 *   node scripts/nonvat-country-rates.cjs
 *
 * Matters because of how the rate is resolved: when no channel threshold applies, the sale falls
 * back to the DESTINATION country's own rate. For Israel that is 0 and the answer is right by
 * accident. For Norway or Switzerland — which run their own VAT at 25% and 8.1% — the fallback would
 * charge their domestic rate on a sale we export to them, which is not a rate we levy at all.
 *
 * So the rule "outside the EU VAT zone means 0%" cannot be left to the country table; it has to be
 * stated. This says how many rows would otherwise get it wrong. Writes nothing.
 */
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../apps/api/dist/src/app.module');
const { PrismaService } = require('../apps/api/dist/src/prisma/prisma.service');

(async () => {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const prisma = app.get(PrismaService);

  const countries = await prisma.country.findMany({
    where: { deletedAt: null },
    select: { isoCode: true, name: true, vatRate: true, euVatZone: true },
    orderBy: { name: 'asc' },
  });

  const outside = countries.filter((c) => !c.euVatZone && (c.isoCode ?? '').toUpperCase() !== 'GB');
  const rated = outside.filter((c) => Number(c.vatRate) > 0);

  console.log(`  countries on file                                 ${countries.length}`);
  console.log(`  outside the EU VAT zone and not the UK            ${outside.length}`);
  console.log(`  of those, carrying a non-zero rate                ${rated.length}\n`);

  if (rated.length) {
    console.log('  these would take their own domestic rate on a fallback:');
    for (const c of rated.slice(0, 30)) {
      console.log(`    ${(c.isoCode ?? '').padEnd(4)} ${c.name.padEnd(30)} ${Number(c.vatRate)}%`);
    }
  } else {
    console.log('  none — the fallback happens to give 0 everywhere, but only by coincidence.');
  }

  await app.close();
})().catch(async (e) => { console.error(e?.message ?? e); process.exit(1); });
