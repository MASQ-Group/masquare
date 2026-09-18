/**
 * Does the numbering actually behave, against a real database?
 *
 * Local only, and it cleans up after itself. The allocator is a single raw UPDATE whose whole point
 * is what Postgres does with it — the restart each January, two people filing at the same instant,
 * stepping over a reference already taken. None of that can be checked by reading the SQL, and none
 * of it is something to discover in production.
 *
 * Run: node apps/api/scripts/check-reference-allocation.cjs
 */
const { PrismaClient } = require('@prisma/client');
const { allocateReference } = require('../dist/src/customer-shipments/customer-shipments.service');

/**
 * Local databases only, and checked rather than trusted.
 *
 * This script creates and deletes rows. The report scripts beside it are read-only and safe to
 * point anywhere; this one is not, and the difference is invisible from the command line. Anyone
 * with production's DATABASE_URL exported — which is a normal thing to have while looking at
 * something else — is one command away from writing to it.
 */
const url = process.env.DATABASE_URL ?? '';
const host = (/^[a-z]+:\/\/[^@]*@([^:/?]+)/i.exec(url) ?? [])[1] ?? '';
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  console.error(`Refusing to run: DATABASE_URL points at "${host || 'nothing'}", and this script writes.`);
  console.error('It is for a local database only. Point DATABASE_URL at localhost and try again.');
  process.exit(1);
}

const prisma = new PrismaClient();
const PREFIX = 'ZQ'; // Nobody's real prefix.

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`);
};

async function main() {
  const year = new Date().getFullYear();
  const month = String(new Date().getMonth() + 1).padStart(2, '0');

  await prisma.customerShipment.deleteMany({ where: { reference: { startsWith: `${PREFIX}-` } } });
  await prisma.customer.deleteMany({ where: { referencePrefix: PREFIX } });
  const customer = await prisma.customer.create({
    data: { name: 'Allocation check', types: ['logistics'], referencePrefix: PREFIX },
  });

  // 1. The first three, in order.
  const first = [];
  for (let i = 0; i < 3; i += 1) first.push(await allocateReference(prisma, customer.id, PREFIX));
  check('counts up from one', first, [
    `${PREFIX}-${year}-${month}-0001`, `${PREFIX}-${year}-${month}-0002`, `${PREFIX}-${year}-${month}-0003`,
  ]);

  // 2. Pretend the counter belongs to an earlier year: the next one starts that year's count again.
  await prisma.customer.update({ where: { id: customer.id }, data: { referenceSeq: 57, referenceYear: year - 1 } });
  check('restarts when the year turns', await allocateReference(prisma, customer.id, PREFIX), `${PREFIX}-${year}-${month}-0001`);

  // 3. Reset, exactly as the button does it.
  await prisma.customer.update({ where: { id: customer.id }, data: { referenceSeq: 0, referenceYear: null } });
  check('starts at one again after a reset', await allocateReference(prisma, customer.id, PREFIX), `${PREFIX}-${year}-${month}-0001`);

  // 4. Reset with shipments still on file: it must step over the references they hold.
  await prisma.customerShipment.create({
    data: {
      customerId: customer.id, reference: `${PREFIX}-${year}-${month}-0001`, status: 'SUBMITTED',
      parcels: { create: [{ weightKg: 1 }] },
    },
  });
  await prisma.customer.update({ where: { id: customer.id }, data: { referenceSeq: 0, referenceYear: null } });
  check('steps over a reference already taken', await allocateReference(prisma, customer.id, PREFIX), `${PREFIX}-${year}-${month}-0002`);

  // 5. A soft-deleted shipment still holds its reference — the unique index counts it.
  const ghost = await prisma.customerShipment.create({
    data: {
      customerId: customer.id, reference: `${PREFIX}-${year}-${month}-0003`, status: 'SUBMITTED',
      deletedAt: new Date(), parcels: { create: [{ weightKg: 1 }] },
    },
  });
  await prisma.customer.update({ where: { id: customer.id }, data: { referenceSeq: 2, referenceYear: year } });
  check('does not reuse a deleted shipment’s reference', await allocateReference(prisma, customer.id, PREFIX), `${PREFIX}-${year}-${month}-0004`);

  // 6. Twenty at once. Every one different, which is the whole reason this is one statement.
  await prisma.customer.update({ where: { id: customer.id }, data: { referenceSeq: 1000, referenceYear: year } });
  const together = await Promise.all(Array.from({ length: 20 }, () => allocateReference(prisma, customer.id, PREFIX)));
  check('gives twenty simultaneous filings twenty numbers', new Set(together).size, 20);

  await prisma.customerShipment.deleteMany({ where: { customerId: customer.id } });
  await prisma.customer.delete({ where: { id: customer.id } });
  void ghost;

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().finally(() => prisma.$disconnect());
