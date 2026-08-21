-- One application of a vendor price file, with the previous value of every field it touched.
-- A bulk cost change is invisible in a P&L until someone notices the margin, so every run is
-- reversible by design.
CREATE TABLE "vendor_import_run" (
  "id"              UUID PRIMARY KEY,
  "vendor_id"       UUID NOT NULL REFERENCES "vendor"("id") ON DELETE CASCADE,
  "profile_id"      UUID,
  "file_name"       TEXT NOT NULL,
  "sheet_name"      TEXT,
  "currency"        TEXT NOT NULL DEFAULT 'EUR',
  "rows_total"      INTEGER NOT NULL DEFAULT 0,
  "rows_matched"    INTEGER NOT NULL DEFAULT 0,
  "changed"         INTEGER NOT NULL DEFAULT 0,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT now(),
  "created_by"      UUID,
  "rolled_back_at"  TIMESTAMP(3),
  "rolled_back_by"  UUID
);
CREATE INDEX "vendor_import_run_vendor_id_idx" ON "vendor_import_run"("vendor_id");

CREATE TABLE "vendor_import_change" (
  "id"          UUID PRIMARY KEY,
  "run_id"      UUID NOT NULL REFERENCES "vendor_import_run"("id") ON DELETE CASCADE,
  "product_id"  UUID NOT NULL REFERENCES "product"("id") ON DELETE CASCADE,
  "field"       TEXT NOT NULL,
  "old_value"   TEXT,
  "new_value"   TEXT,
  "reverted_at" TIMESTAMP(3)
);
CREATE INDEX "vendor_import_change_run_id_idx" ON "vendor_import_change"("run_id");
CREATE INDEX "vendor_import_change_product_id_idx" ON "vendor_import_change"("product_id");
