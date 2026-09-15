-- Per-product parts of the eBay description (series, at-a-glance, In the box, Care, FAQ, spec groups).
ALTER TABLE "product_channel_plan" ADD COLUMN "description_extras" JSONB;
