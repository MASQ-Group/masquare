-- Company isolation: backfill company_id on owned tables for rows that predate isolation.
--
-- All pre-isolation operational data belongs to the ORIGINAL (oldest) company. The second
-- company only ever added sales transactions, and those already carry their own company_id
-- from ingestion, so the `WHERE company_id IS NULL` guard leaves them untouched.
--
-- Idempotent: on any environment already backfilled (e.g. local dev) every UPDATE matches
-- zero rows and is a no-op. Runs in the migration's transaction, so it is atomic with the
-- schema change that added these nullable columns.

UPDATE "warehouse"
   SET "company_id" = (SELECT "id" FROM "company" WHERE "deleted_at" IS NULL ORDER BY "created_at" ASC LIMIT 1)
 WHERE "company_id" IS NULL;

UPDATE "fba_shipment"
   SET "company_id" = (SELECT "id" FROM "company" WHERE "deleted_at" IS NULL ORDER BY "created_at" ASC LIMIT 1)
 WHERE "company_id" IS NULL;

UPDATE "channel_listing"
   SET "company_id" = (SELECT "id" FROM "company" WHERE "deleted_at" IS NULL ORDER BY "created_at" ASC LIMIT 1)
 WHERE "company_id" IS NULL;

UPDATE "goods_receipt"
   SET "company_id" = (SELECT "id" FROM "company" WHERE "deleted_at" IS NULL ORDER BY "created_at" ASC LIMIT 1)
 WHERE "company_id" IS NULL;

UPDATE "vendor_return"
   SET "company_id" = (SELECT "id" FROM "company" WHERE "deleted_at" IS NULL ORDER BY "created_at" ASC LIMIT 1)
 WHERE "company_id" IS NULL;

-- Legacy sales transactions with no company (predate company tagging) belong to the original company.
UPDATE "sales_transaction"
   SET "company_id" = (SELECT "id" FROM "company" WHERE "deleted_at" IS NULL ORDER BY "created_at" ASC LIMIT 1)
 WHERE "company_id" IS NULL;
