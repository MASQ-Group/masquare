-- OnBuy content: its own buyer-facing words on the product, and researched category fields and
-- safety text on the OnBuy plan. All additive and nullable (the array defaults to empty).
ALTER TABLE "product" ADD COLUMN "onbuy_title" TEXT;
ALTER TABLE "product" ADD COLUMN "onbuy_description_html" TEXT;
ALTER TABLE "product" ADD COLUMN "onbuy_summary_points" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "product" ADD COLUMN "onbuy_ai_model" TEXT;

ALTER TABLE "product_channel_plan" ADD COLUMN "specifics" JSONB;
ALTER TABLE "product_channel_plan" ADD COLUMN "safety_content" JSONB;
