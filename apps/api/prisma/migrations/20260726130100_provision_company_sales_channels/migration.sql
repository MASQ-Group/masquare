-- Provision per-company sales channels. The oldest company (masquare) owns every
-- pre-existing channel (set by the backfill in 20260726080629). Every OTHER company
-- gets its own copy of the Amazon channels + Local Sales, and its sales transactions /
-- FBA shipments are repointed off the oldest company's channel onto its own clone.
--
-- Idempotent + set-based: a company that already has any channel is skipped; a second
-- run finds nothing left pointing at the oldest company's channels.

-- 1) Clone the oldest company's Amazon + Local Sales channels to every other company
--    that has none yet.
INSERT INTO "sales_channel" (
  "id", "company_id", "name", "description", "kind", "show_transaction_total",
  "chip_bg_color", "chip_text_color", "native_country_id", "native_currency",
  "general_sales_fee_pct", "fee_charged_in_native_currency", "fee_currency",
  "vat_threshold_enabled", "vat_threshold_amount", "vat_threshold_currency",
  "vat_below_threshold_pct", "vat_above_threshold_pct", "email", "website", "contact_name",
  "created_at", "updated_at"
)
SELECT
  gen_random_uuid(), c."id", s."name", s."description", s."kind", s."show_transaction_total",
  s."chip_bg_color", s."chip_text_color", s."native_country_id", s."native_currency",
  s."general_sales_fee_pct", s."fee_charged_in_native_currency", s."fee_currency",
  s."vat_threshold_enabled", s."vat_threshold_amount", s."vat_threshold_currency",
  s."vat_below_threshold_pct", s."vat_above_threshold_pct", s."email", s."website", s."contact_name",
  now(), now()
FROM "company" c
CROSS JOIN "sales_channel" s
WHERE c."id" <> (SELECT "id" FROM "company" ORDER BY "created_at" ASC LIMIT 1)
  AND s."company_id" = (SELECT "id" FROM "company" ORDER BY "created_at" ASC LIMIT 1)
  AND s."deleted_at" IS NULL
  AND (s."kind" = 'local' OR s."name" ILIKE 'amazon%')
  AND NOT EXISTS (
    SELECT 1 FROM "sales_channel" x WHERE x."company_id" = c."id" AND x."deleted_at" IS NULL
  );

-- 2) Repoint each non-oldest company's records onto its own same-named clone.
UPDATE "sales_transaction" t
SET "sales_channel_id" = clone."id"
FROM "sales_channel" src, "sales_channel" clone
WHERE t."sales_channel_id" = src."id"
  AND src."company_id" = (SELECT "id" FROM "company" ORDER BY "created_at" ASC LIMIT 1)
  AND t."company_id" <> (SELECT "id" FROM "company" ORDER BY "created_at" ASC LIMIT 1)
  AND clone."company_id" = t."company_id"
  AND clone."deleted_at" IS NULL
  AND clone."name" = src."name";

UPDATE "fba_shipment" f
SET "sales_channel_id" = clone."id"
FROM "sales_channel" src, "sales_channel" clone
WHERE f."sales_channel_id" = src."id"
  AND src."company_id" = (SELECT "id" FROM "company" ORDER BY "created_at" ASC LIMIT 1)
  AND f."company_id" <> (SELECT "id" FROM "company" ORDER BY "created_at" ASC LIMIT 1)
  AND clone."company_id" = f."company_id"
  AND clone."deleted_at" IS NULL
  AND clone."name" = src."name";
