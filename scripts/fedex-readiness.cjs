/**
 * What stands between us and booking a FedEx shipment from the platform?
 *
 *   REPORT=fedex-readiness bash scripts/prod-scan.sh
 *
 * Booking is the point of no return in this integration: a label exists, a tracking number exists
 * and a charge exists, and FedEx will not tell us afterwards what we shipped. So the state of it is
 * worth reading before anything is built on top, rather than discovered by making one.
 *
 * Read-only: it counts and prints, and calls nothing at FedEx.
 */
const { PrismaClient } = require('@prisma/client');

const pad = (s, n) => String(s ?? '').padEnd(n).slice(0, n);

(async () => {
  const p = new PrismaClient();

  // ── accounts ─────────────────────────────────────────────────────────────────────────────────
  const accounts = await p.carrierAccount.findMany({
    where: { deletedAt: null },
    select: {
      id: true, carrier: true, environment: true, isActive: true, createdAt: true,
      company: { select: { officialName: true } },
      accountNumber: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`  carrier accounts                     ${accounts.length}`);
  for (const a of accounts) {
    // The account number is a credential of sorts; only its shape is useful here.
    const masked = a.accountNumber ? `${String(a.accountNumber).slice(0, 3)}…(${String(a.accountNumber).length} digits)` : '(none)';
    console.log(`    ${pad(a.carrier, 8)} ${pad(a.environment, 11)} ${a.isActive ? 'active  ' : 'inactive'} ${pad(a.company?.officialName, 26)} ${masked}`);
  }
  console.log('');

  // ── bookings so far ──────────────────────────────────────────────────────────────────────────
  const bookings = await p.carrierBooking.findMany({
    where: { deletedAt: null },
    select: {
      id: true, environment: true, status: true, serviceType: true, serviceName: true,
      masterTrackingNumber: true, labelUrl: true, labelFormat: true, createdAt: true, cancelledAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  const total = await p.carrierBooking.count({ where: { deletedAt: null } });

  console.log(`  bookings ever made                   ${total}`);
  const withTracking = bookings.filter((b) => b.masterTrackingNumber).length;
  const withLabel = bookings.filter((b) => b.labelUrl).length;
  console.log(`    of the last ${String(bookings.length).padStart(2)}, with a tracking number  ${withTracking}`);
  console.log(`    of the last ${String(bookings.length).padStart(2)}, with a stored label     ${withLabel}   <- nothing writes this column yet`);
  for (const b of bookings.slice(0, 8)) {
    console.log(
      `    ${b.createdAt.toISOString().slice(0, 16)} ${pad(b.environment, 11)} ${pad(b.status, 10)} `
      + `${pad(b.serviceName ?? b.serviceType, 26)} ${b.masterTrackingNumber ?? '(no tracking number read)'}`,
    );
  }
  console.log('');

  // ── what a booking would be made FOR ─────────────────────────────────────────────────────────
  // Two flows want this: our own orders waiting to be fulfilled, and shipments a logistics customer
  // has filed. Only the first can be booked today — the booking row requires a sales transaction.
  const customerPending = await p.customerShipment.count({
    where: { deletedAt: null, status: { in: ['SUBMITTED', 'NEEDS_INFO'] } },
  });
  const customerFulfilledByHand = await p.customerShipment.count({
    where: { deletedAt: null, status: 'FULFILLED', trackingNumber: { not: null } },
  });
  console.log(`  customer shipments waiting on us     ${customerPending}`);
  console.log(`  customer shipments already fulfilled ${customerFulfilledByHand}   (tracking numbers typed in by hand)`);

  // ── the services a booking would choose from ─────────────────────────────────────────────────
  const services = await p.shippingService.findMany({
    where: { deletedAt: null },
    select: { name: true, alias: true, trackingUrlTemplate: true },
    orderBy: { name: 'asc' },
  });
  console.log(`  shipping services configured         ${services.length}`);
  for (const s of services) {
    console.log(`    ${pad(s.name, 26)} ${pad(s.alias ?? '—', 12)} ${s.trackingUrlTemplate ? 'has a tracking link' : 'NO tracking link'}`);
  }

  await p.$disconnect();
})();
