/**
 * What migration 20260915140000_order_availability_decision will write, before it runs.
 *
 *   REPORT=decision-backfill-preview bash scripts/prod-scan.sh
 *
 * Runs the backfill's own SELECT (not the INSERT) against the live data, so a mistake in the key
 * expression surfaces as a query error or an implausible count here rather than as a migration that
 * stops the next deploy from booting. Reads only.
 */
const { PrismaClient } = require('@prisma/client');

(async () => {
  const p = new PrismaClient();
  const [row] = await p.$queryRawUnsafe(`
    SELECT count(*)::int AS pairs,
           count(DISTINCT k.order_key)::int AS orders,
           count(DISTINCT k.product_id)::int AS products,
           count(*) FILTER (WHERE k.order_key LIKE 'manual:%')::int AS manual_keys
    FROM (
      SELECT DISTINCT
        COALESCE(t."integration_id"::text, t."sales_channel_id"::text, 'manual')
          || ':' || COALESCE(NULLIF(lower(btrim(t."transaction_ref")), ''), t."id"::text) AS order_key,
        i."product_id" AS product_id
      FROM "sales_transaction_item" i
      JOIN "sales_transaction" t ON t."id" = i."transaction_id"
      WHERE i."product_id" IS NOT NULL
    ) k`);
  const [lines] = await p.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "sales_transaction_item" WHERE "product_id" IS NOT NULL`);
  const sample = await p.$queryRawUnsafe(`
    SELECT COALESCE(t."integration_id"::text, t."sales_channel_id"::text, 'manual')
             || ':' || COALESCE(NULLIF(lower(btrim(t."transaction_ref")), ''), t."id"::text) AS order_key
    FROM "sales_transaction" t ORDER BY t."date" DESC LIMIT 3`);
  const [ver] = await p.$queryRawUnsafe(`SHOW server_version`);
  console.log(`Postgres ${ver.server_version}`);
  console.log(`order lines with a product   ${lines.n}`);
  console.log(`decisions the backfill writes ${row.pairs}  (${row.orders} orders, ${row.products} products, ${row.manual_keys} keyed without an account)`);
  console.log('sample keys (newest orders):');
  for (const s of sample) console.log(`  ${s.order_key.replace(/^[0-9a-f-]{36}:/, '<account>:')}`);
  await p.$disconnect();
})();
