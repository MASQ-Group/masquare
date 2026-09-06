-- Channels a brand has told us not to sell them on.
--
-- Separate from Amazon's own gating: Amazon may allow the listing and the restriction still stands,
-- because it comes from a letter rather than from the marketplace. Keyed by channel type and
-- marketplace, not by integration — "not on Amazon US" applies to that marketplace whichever of our
-- companies holds the account. An empty marketplace means the whole channel type.
CREATE TABLE "brand_channel_restriction" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "channel_type" TEXT NOT NULL,
    "marketplace" TEXT NOT NULL DEFAULT '',
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "brand_channel_restriction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "brand_channel_restriction_brand_id_channel_type_marketplace_key"
    ON "brand_channel_restriction"("brand_id", "channel_type", "marketplace");
CREATE INDEX "brand_channel_restriction_channel_type_marketplace_idx"
    ON "brand_channel_restriction"("channel_type", "marketplace");

ALTER TABLE "brand_channel_restriction"
    ADD CONSTRAINT "brand_channel_restriction_brand_id_fkey"
    FOREIGN KEY ("brand_id") REFERENCES "brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
