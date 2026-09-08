-- Carrier accounts, kept apart from marketplace integrations.
--
-- A courier has an account number that gets billed, a sandbox that answers differently from
-- production, and an address shipments leave from. It has no sales channel, no marketplace and no
-- listings, so it does not belong in channel_integration.
CREATE TABLE "carrier_account" (
  "id"                 UUID PRIMARY KEY,
  "company_id"         UUID NOT NULL,
  "carrier"            TEXT NOT NULL,
  "name"               TEXT NOT NULL,
  "account_number"     TEXT NOT NULL,
  "environment"        TEXT NOT NULL DEFAULT 'sandbox',
  "origin_line1"       TEXT,
  "origin_line2"       TEXT,
  "origin_city"        TEXT,
  "origin_region"      TEXT,
  "origin_postal_code" TEXT,
  "origin_country_iso" TEXT,
  "origin_phone"       TEXT,
  -- Off until somebody has watched it answer. Nothing ships on an untested account.
  "is_active"          BOOLEAN NOT NULL DEFAULT false,
  "last_tested_at"     TIMESTAMP(3),
  "last_test_ok"       BOOLEAN,
  "last_test_note"     TEXT,
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"         TIMESTAMP(3) NOT NULL,
  "created_by"         UUID,
  "updated_by"         UUID,
  "deleted_at"         TIMESTAMP(3),
  CONSTRAINT "carrier_account_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- The same account number in sandbox and in production is normal. Twice in one environment is not.
CREATE UNIQUE INDEX "carrier_account_carrier_accountNumber_environment_key"
  ON "carrier_account"("carrier", "account_number", "environment");
CREATE INDEX "carrier_account_company_id_idx" ON "carrier_account"("company_id");

-- Credentials, encrypted by the same service that holds the marketplace keys. Its own table so
-- reading an account never selects a secret by accident.
CREATE TABLE "carrier_account_secret" (
  "id"          UUID PRIMARY KEY,
  "account_id"  UUID NOT NULL,
  "field_key"   TEXT NOT NULL,
  "ciphertext"  TEXT NOT NULL,
  "iv"          TEXT NOT NULL,
  "auth_tag"    TEXT NOT NULL,
  "key_version" INTEGER NOT NULL,
  "last4"       TEXT NOT NULL,
  "updated_at"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "carrier_account_secret_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "carrier_account"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "carrier_account_secret_account_id_field_key_key"
  ON "carrier_account_secret"("account_id", "field_key");
