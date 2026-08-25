-- What a company's Amazon integrations may be used for. 'full' = everything; 'orders' = order
-- ingestion only, with the integrations unreachable from repricing, listing and the sweep.
ALTER TABLE "company" ADD COLUMN "amazon_scope" TEXT NOT NULL DEFAULT 'full';

ALTER TABLE "company"
  ADD CONSTRAINT "company_amazon_scope_check"
  CHECK ("amazon_scope" IN ('full', 'orders'));

-- N.K. Multitrade is connected purely to pull orders for analytics. Its Amazon seller account is a
-- separate legal entity with its own developer credentials, and work must never be performed
-- against the wrong one.
--
-- Matched on the official name rather than a hard-coded id: ids differ between environments, and an
-- id that silently matches nothing would leave the account unprotected while looking done. If the
-- name does not match here, this RAISES and the deploy fails — which is the safe direction to fail.
DO $$
DECLARE touched INT;
BEGIN
  UPDATE "company" SET "amazon_scope" = 'orders'
   WHERE "official_name" ILIKE '%MULTITRADE%';
  GET DIAGNOSTICS touched = ROW_COUNT;
  IF touched = 0 THEN
    RAISE EXCEPTION 'No company matching %%MULTITRADE%% — refusing to deploy an unprotected orders-only account. Check the official name and amend this migration.';
  END IF;
  RAISE NOTICE 'amazon_scope=orders applied to % company row(s)', touched;
END $$;
