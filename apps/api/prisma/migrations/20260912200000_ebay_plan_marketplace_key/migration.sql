-- Move eBay plans onto the key everything else uses.
--
-- `listing.service.upsertPlan` files a plan under the INTEGRATION's own marketplace — "GB" for eBay
-- — while the Content tab's category picker wrote an empty string. Same product, same integration,
-- two rows: a category chosen on Content was invisible to the Channels tab, which read it as never
-- having been set.
--
-- The code now derives the key in one place. This moves the rows already written under the wrong
-- one, and only where the right one is free — a product that has a plan under BOTH keys keeps the
-- correctly-keyed row, because that is the one every other screen has been reading and writing.
UPDATE "product_channel_plan" AS pcp
SET "marketplace" = ci."marketplace"
FROM "channel_integration" AS ci
WHERE pcp."integration_id" = ci."id"
  AND pcp."marketplace" = ''
  AND COALESCE(ci."marketplace", '') <> ''
  AND NOT EXISTS (
    SELECT 1 FROM "product_channel_plan" AS other
    WHERE other."product_id" = pcp."product_id"
      AND other."integration_id" = pcp."integration_id"
      AND other."marketplace" = ci."marketplace"
  );
