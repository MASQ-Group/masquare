-- The manufacturer's own product page for this product.
--
-- The authoritative source the content rules are built around, and the report that prompted this
-- found we hold no way to reach it: of 3,337 products none carry a datasheet, and of 236 brands none
-- carry a website. So the address is recorded per product, once, by whoever nominates it — and a
-- gather reads that page rather than guessing which page is right.
--
-- Nullable, with no default. A product without one is the normal case today, and an empty string
-- would be a URL that fails to fetch rather than an absent one.
ALTER TABLE "product" ADD COLUMN "manufacturer_url" TEXT;
