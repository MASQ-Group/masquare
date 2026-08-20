-- Whether the MAP / suggested retail price a vendor quotes already contains VAT.
-- Default false: price lists most often quote the dealer price net and the retail price gross,
-- so the safer default is "excludes", which a user must opt out of deliberately.
ALTER TABLE "vendor"
  ADD COLUMN "map_includes_vat" BOOLEAN NOT NULL DEFAULT false;
