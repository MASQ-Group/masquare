-- Backfill company_id on channel listings that were pulled before the sync learned to
-- stamp it (they landed NULL and were hidden by the company-scoped dashboard).
-- Idempotent: only touches NULL rows; attributes each to its integration's company.
UPDATE "channel_listing" cl
SET "company_id" = ci."target_company_id"
FROM "channel_integration" ci
WHERE cl."integration_id" = ci."id"
  AND cl."company_id" IS NULL
  AND ci."target_company_id" IS NOT NULL;
