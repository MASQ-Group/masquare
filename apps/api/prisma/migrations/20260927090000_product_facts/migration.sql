-- One place for what is TRUE about a product, whatever a marketplace calls it.
--
-- The same fact is researched and stored once per channel today: eBay keeps it in the plan's
-- `aspects`, OnBuy in the plan's `specifics`, and neither can see the other's answer. Every channel
-- added since has made another copy. This column holds the facts under canonical names, with the
-- same evidence shape the per-channel columns already use, so a source found for one channel counts
-- for all of them -- including towards the two-sources rule that decides what may be published.
--
-- Nullable and unread by anything that exists: nothing changes for a product until research is run.
ALTER TABLE "product" ADD COLUMN "facts" JSONB;
