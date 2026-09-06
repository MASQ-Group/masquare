-- The seller SKU a listing will be created under, where it must differ from the product's mainSku.
--
-- Amazon treats a seller SKU as the listing's identity across the whole account: asked to create
-- IT33136 on Amazon AU while the same SKU is already live on AE, SA and SG, it refuses with error
-- 100398 and asks for a new one. Null means "use the product's mainSku", which is the normal case
-- and keeps a single identity across marketplaces.
ALTER TABLE "product_channel_plan" ADD COLUMN "channel_sku" TEXT;
