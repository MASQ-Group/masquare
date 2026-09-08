/**
 * Call FedEx through the platform's own services, from the command line.
 *
 *   node --env-file=.env scripts/fedex-probe.cjs rate
 *   node --env-file=.env scripts/fedex-probe.cjs book
 *   node --env-file=.env scripts/fedex-probe.cjs track [trackingNumber ...]
 *   node --env-file=.env scripts/fedex-probe.cjs sweep [limit] [force]
 *
 * Why this exists: FedEx's sandbox goes down without warning, and its refusals for an outage, a
 * wrong account and an unrecognised lane read almost identically. Being able to fire one call and
 * see the raw reply — without a browser, a login or a screen — turned a morning of theories into a
 * two-minute check. It was the difference between guessing that sandbox was flaky and proving that
 * Ship was 503 while Rate was 200 on the same account, seconds apart.
 *
 * Runs against whatever DATABASE_URL points at, using the sandbox carrier account stored there.
 * `book` uses testBook, which refuses production outright and writes no record.
 */
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../apps/api/dist/src/app.module');
const { CarriersService } = require('../apps/api/dist/src/carriers/carriers.service');
const { PrismaService } = require('../apps/api/dist/src/prisma/prisma.service');

/** Base64 labels run to hundreds of kilobytes and drown the shape we are trying to read. */
const trimBase64 = (s) => s.replace(/"[A-Za-z0-9+/=]{200,}"/g, '"<base64 omitted>"');

(async () => {
  const mode = process.argv[2] ?? 'rate';
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const svc = app.get(CarriersService);
  const prisma = app.get(PrismaService);
  // Tracking is a free read with no side effect, so it runs against PRODUCTION — where the real
  // numbers are. Sandbox would answer about parcels that do not exist.
  const environment = mode === 'track' || mode === 'sweep' ? 'production' : 'sandbox';
  const [account] = await prisma.carrierAccount.findMany({
    where: { environment, deletedAt: null },
    select: { id: true, name: true, accountNumber: true, originPostalCode: true, originCountryIso: true },
  });
  if (!account) {
    console.error(`No ${environment} carrier account in this database. Add one in Setup → Carrier accounts.`);
    process.exit(1);
  }
  console.log(`account: ${account.name} (${account.accountNumber}) from ${account.originPostalCode} ${account.originCountryIso}`);

  // FedEx's sandbox only knows the lanes in its own sample data — a Cyprus origin is refused there
  // whatever the account — so these default to the US→CA lane their samples use throughout.
  const recipient = { postalCode: 'M4B1B4', countryIso: 'CA' };

  if (mode === 'rate') {
    const r = await svc.rateQuote(account.id, {
      recipient,
      parcels: [{ weightKg: 2, lengthCm: 30, widthCm: 20, heightCm: 15 }],
      customsValue: { amount: 100, currency: 'EUR' },
    });
    console.log(`HTTP ${r.status} ok=${r.ok}`);
    if (r.message) console.log(r.message);
    if (r.ok) {
      for (const o of r.quote?.options ?? []) {
        console.log(`  ${o.serviceType.padEnd(40)} ${String(o.netCharge).padStart(9)} ${o.currency}` +
          `${o.listCharge && o.listCharge !== o.netCharge ? `  (list ${o.listCharge})` : ''}` +
          `${o.deliveryAt ? `  ${o.deliveryAt}` : ''}`);
      }
    } else {
      console.log(trimBase64(JSON.stringify(r.response, null, 1)).slice(0, 4000));
    }
  } else if (mode === 'book') {
    const shipDate = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const r = await svc.testBook(account.id, {
      recipient: {
        personName: 'Test Recipient', streetLines: ['100 Queen Street West'], city: 'Toronto',
        stateOrProvinceCode: 'ON', postalCode: recipient.postalCode, countryIso: recipient.countryIso,
        phone: '4165551234',
      },
      serviceType: 'INTERNATIONAL_PRIORITY',
      shipDate,
      parcels: [{ weightKg: 2, lengthCm: 30, widthCm: 20, heightCm: 15 }],
      dutiesPaidBy: 'recipient',
      labelImageType: 'PDF',
    });
    console.log(`HTTP ${r.status} ok=${r.ok}`);
    if (r.message) console.log(r.message);
    console.log(trimBase64(JSON.stringify(r.response, null, 1)).slice(0, 8000));
  } else if (mode === 'track') {
    let numbers = process.argv.slice(3).filter(Boolean);
    if (!numbers.length) {
      // The most recently despatched FedEx parcels, which are the ones FedEx still has history for.
      const rows = await prisma.shipment.findMany({
        where: { deletedAt: null, trackingNumber: { not: null }, shippingService: { name: 'FedEx' } },
        orderBy: { shipmentDate: 'desc' },
        take: 3,
        select: { trackingNumber: true, shipmentDate: true },
      });
      numbers = rows.map((r) => r.trackingNumber);
      for (const r of rows) console.log(`  using ${r.trackingNumber} shipped ${r.shipmentDate.toISOString().slice(0, 10)}`);
    }
    const r = await svc.trackRaw(account.id, numbers);
    console.log(`HTTP ${r.status} ok=${r.ok}`);
    if (r.message) console.log(r.message);
    console.log(trimBase64(JSON.stringify(r.response, null, 1)).slice(0, 20000));
  } else if (mode === 'sweep') {
    // The scheduled tracking sweep, run by hand. Same method, same rules, no cron to wait for.
    // `force` re-asks about parcels already answered for — how a new column gets backfilled from
    // FedEx rather than left null on everything shipped before it existed.
    const shipmentIds = process.argv[4] === 'force'
      ? (await prisma.shipment.findMany({
          where: { deletedAt: null, trackingNumber: { not: null }, shippingService: { name: 'FedEx' } },
          orderBy: { shipmentDate: 'desc' }, take: Number(process.argv[3]) || 300, select: { id: true },
        })).map((r) => r.id)
      : null;
    const r = await svc.refreshTracking({ limit: Number(process.argv[3]) || 300, shipmentIds, force: !!shipmentIds });
    console.log(JSON.stringify(r, null, 1));
  } else {
    console.error(`Unknown mode "${mode}". Use "rate", "book", "track" or "sweep".`);
    process.exit(1);
  }

  await app.close();
})().catch((e) => {
  console.error('FAILED:', e?.message ?? e);
  process.exit(1);
});
