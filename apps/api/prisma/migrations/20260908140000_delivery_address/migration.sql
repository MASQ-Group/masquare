-- Where the goods are going, so a carrier label can be produced.
--
-- New table rather than columns on sales_transaction: this is personal data with its own
-- provenance and its own retention question, and it is absent for the great majority of orders.
CREATE TABLE "sales_transaction_address" (
  "id"                UUID PRIMARY KEY,
  "transaction_id"    UUID NOT NULL,
  -- 'channel' or 'manual'. Amazon is always manual: buyer addresses are restricted data we are
  -- not approved to pull, so they are copied from Seller Central by hand.
  "source"            TEXT NOT NULL DEFAULT 'manual',
  "full_name"         TEXT,
  "company_name"      TEXT,
  "address_line1"     TEXT,
  "address_line2"     TEXT,
  "city"              TEXT,
  "state_or_region"   TEXT,
  "postal_code"       TEXT,
  "country_iso"       TEXT,
  "phone"             TEXT,
  "email"             TEXT,
  "eori"              TEXT,
  "vat_number"        TEXT,
  "is_business"       BOOLEAN,
  "channel_synced_at" TIMESTAMP(3),
  "edited_at"         TIMESTAMP(3),
  "edited_by"         UUID,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3) NOT NULL,
  "created_by"        UUID,
  "deleted_at"        TIMESTAMP(3),
  CONSTRAINT "sales_transaction_address_transaction_id_fkey"
    FOREIGN KEY ("transaction_id") REFERENCES "sales_transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- One delivery address per order. A second row would mean two answers to "where does this go".
CREATE UNIQUE INDEX "sales_transaction_address_transaction_id_key"
  ON "sales_transaction_address"("transaction_id");
