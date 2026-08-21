-- A saved column mapping for one vendor's price file, so the same layout is not re-mapped
-- every month. Re-resolved against each upload by header name, not by position.
CREATE TABLE "vendor_import_profile" (
  "id"          UUID PRIMARY KEY,
  "vendor_id"   UUID NOT NULL REFERENCES "vendor"("id") ON DELETE CASCADE,
  "name"        TEXT NOT NULL,
  "sheet_name"  TEXT,
  "mapping"     JSONB NOT NULL,
  "currency"    TEXT NOT NULL DEFAULT 'EUR',
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updated_at"  TIMESTAMP(3) NOT NULL DEFAULT now(),
  "created_by"  UUID,
  "deleted_at"  TIMESTAMP(3)
);

CREATE INDEX "vendor_import_profile_vendor_id_idx" ON "vendor_import_profile"("vendor_id");
