-- Extra off-invoice discounts applied at upload, keyed by our brand id, so a run can be
-- explained later without the original file.
ALTER TABLE "vendor_import_run" ADD COLUMN "brand_discounts" JSONB;
