/**
 * Did WE take eBay listings to zero, and if so on whose instruction?
 *
 *   REPORT=ebay-zero-pushes bash scripts/prod-scan.sh
 *
 * Listings going out of stock has two very different explanations — the stock really ran out, or
 * the platform pushed a zero it should not have — and they are told apart by the audit rows, not by
 * memory. Every push is recorded in `channel_push` with the value asked for AND the value that was
 * there before, so a zero written over a real quantity is visible as such.
 *
 * For every zero found, this also prints what moved that product's availability at the time, from
 * the availability ledger, so "a sale took it to zero" and "something set it to zero" are separate
 * answers rather than one guess.
 *
 * Reads only.
 */
const { PrismaClient } = require('@prisma/client');

const DAYS = Number(process.env.DAYS || 21);

(async () => {
  const p = new PrismaClient();
  const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);

  const ebay = await p.channelIntegration.findMany({
    where: { channelType: 'ebay', deletedAt: null },
    select: { id: true, name: true },
  });
  const ebayIds = ebay.map((e) => e.id);
  console.log(`eBay integrations: ${ebay.map((e) => e.name).join(', ') || 'none'}`);
  console.log(`Window: last ${DAYS} days (since ${since.toISOString().slice(0, 10)})\n`);

  const pushes = await p.channelPush.findMany({
    where: { integrationId: { in: ebayIds }, field: 'quantity', createdAt: { gte: since } },
    orderBy: { createdAt: 'asc' },
    select: {
      productId: true, channelSku: true, marketplace: true, requestedValue: true, previousValue: true,
      ok: true, dryRun: true, message: true, createdAt: true, createdById: true,
    },
  });

  const live = pushes.filter((x) => !x.dryRun);
  const zeros = live.filter((x) => x.requestedValue === 0);
  const zeroOverReal = zeros.filter((x) => (x.previousValue ?? 0) > 0);
  console.log('PUSHES TO EBAY (quantity)');
  console.log(`  recorded        ${pushes.length}   (${pushes.length - live.length} dry runs)`);
  console.log(`  asked for zero  ${zeros.length}   (${zeros.filter((x) => x.ok).length} accepted by eBay)`);
  console.log(`  zero OVER a quantity that was not zero   ${zeroOverReal.length}   <- the ones that took a listing down\n`);

  const byDay = new Map();
  for (const z of zeros) {
    const d = z.createdAt.toISOString().slice(0, 10);
    byDay.set(d, (byDay.get(d) ?? 0) + 1);
  }
  if (byDay.size) {
    // Split, because the two mean opposite things: a zero over a zero changes nothing a buyer sees,
    // a zero over a real quantity is a listing taken down.
    const overReal = new Map();
    for (const z of zeroOverReal) {
      const d = z.createdAt.toISOString().slice(0, 10);
      overReal.set(d, (overReal.get(d) ?? 0) + 1);
    }
    console.log('  zeros per day (of which over a real quantity)');
    for (const [d, n] of [...byDay].sort()) console.log(`    ${d}  ${String(n).padStart(4)}   ${overReal.get(d) ?? 0}`);
    console.log('');
  }

  const productIds = [...new Set(zeroOverReal.map((z) => z.productId).filter(Boolean))];
  const products = productIds.length
    ? await p.product.findMany({ where: { id: { in: productIds } }, select: { id: true, mainSku: true, title: true } })
    : [];
  const availability = productIds.length
    ? await p.productAvailability.findMany({ where: { productId: { in: productIds } }, select: { productId: true, quantity: true, lastSource: true, updatedAt: true } })
    : [];
  const ledger = productIds.length
    ? await p.availabilityLedger.findMany({
        where: { productId: { in: productIds }, createdAt: { gte: since } },
        orderBy: { createdAt: 'asc' },
        select: { productId: true, delta: true, newQuantity: true, reason: true, note: true, createdAt: true },
      })
    : [];
  const users = await p.user.findMany({ select: { id: true, email: true } });
  const who = (id) => (id ? users.find((u) => u.id === id)?.email ?? id.slice(0, 8) : 'system');
  const sku = (id) => products.find((x) => x.id === id)?.mainSku ?? '(unmatched)';

  /**
   * WHY each zero was sent, which is the whole question. A push only ever repeats what availability
   * says, so the interesting split is what availability was doing at the time:
   *   sold out   — it counted down to zero. The listing was right to close.
   *   already 0  — a sale arrived for a product availability already held at zero, so the sale
   *                floored at zero (delta 0) and the push then zeroed a listing that still showed
   *                stock. That is stock we were selling without it being recorded here.
   *   unexplained — nothing moved at all, which would mean the zero came from somewhere else.
   */
  const reasons = { 'sold out': 0, 'already 0': 0, unexplained: 0 };
  for (const z of zeroOverReal) {
    const before = ledger
      .filter((l) => l.productId === z.productId && l.createdAt <= z.createdAt)
      .slice(-1)[0];
    if (!before) reasons.unexplained += 1;
    else if (before.delta < 0 && before.newQuantity === 0) reasons['sold out'] += 1;
    else if (before.newQuantity === 0) reasons['already 0'] += 1;
    else reasons.unexplained += 1;
  }
  console.log('WHY THOSE ZEROS WERE SENT');
  for (const [k, v] of Object.entries(reasons)) console.log(`  ${k.padEnd(12)} ${v}`);
  console.log(`  distinct products ${new Set(zeroOverReal.map((z) => z.productId)).size}
`);

  console.log('PRODUCTS BEHIND THOSE ZEROS');
  const perProduct = new Map();
  for (const z of zeroOverReal) {
    const e = perProduct.get(z.productId) ?? { n: 0, last: z.createdAt, highest: 0 };
    e.n += 1;
    if (z.createdAt > e.last) e.last = z.createdAt;
    e.highest = Math.max(e.highest, z.previousValue ?? 0);
    perProduct.set(z.productId, e);
  }
  for (const [id, e] of [...perProduct].sort((a, b) => b[1].last - a[1].last)) {
    const a2 = availability.find((x) => x.productId === id);
    console.log(`  ${sku(id).padEnd(34)} ${String(e.n).padStart(3)} zeros   eBay held up to ${e.highest}   availability now ${a2 ? a2.quantity : 'no row'}   last ${e.last.toISOString().slice(0, 16)}`);
  }
  console.log('');

  console.log(`ZERO WRITTEN OVER A REAL QUANTITY — ${zeroOverReal.length} listing(s), most recent first`);
  for (const z of [...zeroOverReal].reverse().slice(0, 30)) {
    console.log(`\n  ${z.createdAt.toISOString()}  ${sku(z.productId)}  ${z.channelSku}${z.marketplace ? ' [' + z.marketplace + ']' : ''}`);
    console.log(`    ${z.previousValue} -> 0   ${z.ok ? 'accepted' : 'REFUSED'}   asked by ${who(z.createdById)}${z.message ? '   ' + z.message.slice(0, 120) : ''}`);
    const moves = ledger.filter((l) => l.productId === z.productId
      && Math.abs(l.createdAt - z.createdAt) < 6 * 60 * 60 * 1000);
    if (moves.length === 0) {
      console.log('    availability ledger: NOTHING moved within 6 hours <- the zero did not come from a stock movement');
    } else {
      for (const m of moves) {
        console.log(`    availability ${m.createdAt.toISOString()}  ${m.delta >= 0 ? '+' : ''}${m.delta} -> ${m.newQuantity}  ${m.reason}${m.note ? '  ' + m.note.slice(0, 60) : ''}`);
      }
    }
    const a = availability.find((x) => x.productId === z.productId);
    console.log(`    availability now: ${a ? `${a.quantity} (${a.lastSource ?? 'unknown'}, ${a.updatedAt.toISOString()})` : 'no row'}`);
  }
  if (zeroOverReal.length > 30) console.log(`\n  … and ${zeroOverReal.length - 30} older`);

  /** What eBay itself last told us each listing holds, for products we believe have stock. */
  const listings = await p.channelListing.findMany({
    where: { integrationId: { in: ebayIds } },
    select: { channelSku: true, marketplace: true, productId: true, listedQuantity: true, listingStatus: true, lastPulledAt: true },
  });
  const withStock = await p.productAvailability.findMany({ where: { quantity: { gt: 0 } }, select: { productId: true, quantity: true } });
  const stockBy = new Map(withStock.map((x) => [x.productId, x.quantity]));
  const mismatched = listings.filter((l) => l.productId && stockBy.has(l.productId) && (l.listedQuantity ?? 0) === 0);
  console.log(`\nLISTINGS SHOWING ZERO WHILE WE HOLD STOCK: ${mismatched.length}`);
  for (const m of mismatched.slice(0, 25)) {
    console.log(`  ${m.channelSku}${m.marketplace ? ' [' + m.marketplace + ']' : ''}  we hold ${stockBy.get(m.productId)}  status ${m.listingStatus ?? '—'}  pulled ${m.lastPulledAt ? m.lastPulledAt.toISOString().slice(0, 16) : 'never'}`);
  }
  if (mismatched.length > 25) console.log(`  … and ${mismatched.length - 25} more`);

  await p.$disconnect();
})();
