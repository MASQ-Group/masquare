-- Profit tiers were global, so editing the bands in one company recoloured every figure in the
-- other. They belong to a company: what counts as a healthy margin differs between a company new
-- to a marketplace and one that has traded there for years.
ALTER TABLE "profit_tier" ADD COLUMN "company_id" UUID;
CREATE INDEX "profit_tier_company_id_idx" ON "profit_tier"("company_id");

-- Existing bands go to the trading company. The other company starts with none and defines its own,
-- which is the point of the change rather than a side effect of it.
--
-- Raises if it cannot find one: a tier left with no company is invisible to every company, and
-- losing a configured band set silently is worse than a failed deploy.
DO $$
DECLARE target UUID;
BEGIN
  SELECT id INTO target FROM "company" WHERE "amazon_scope" = 'full' ORDER BY "created_at" LIMIT 1;
  IF target IS NULL THEN
    RAISE EXCEPTION 'No full-scope company to own the existing profit tiers — refusing to orphan them.';
  END IF;
  UPDATE "profit_tier" SET "company_id" = target WHERE "company_id" IS NULL;
END $$;
