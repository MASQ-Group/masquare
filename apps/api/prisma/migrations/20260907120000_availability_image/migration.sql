-- The catalogue image for a matched candidate.
--
-- An ASIN and a title are thin evidence for a decision that attaches our offer to somebody else's
-- listing. The sweep already receives the image URL from Amazon and was discarding it.
--
-- Additive and nullable: rows checked before this stay valid and simply have no image until their
-- next check.
ALTER TABLE "product_channel_availability" ADD COLUMN "image_url" TEXT;
