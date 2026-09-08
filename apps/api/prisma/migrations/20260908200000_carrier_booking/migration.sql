-- What a carrier told us at the moment of booking, and will never tell us again.
--
-- Handoff §2.2: FedEx has no shipment-history API, tracking data is discarded 90 days after
-- delivery and carries no charge information. This table is the system of record.
CREATE TABLE "carrier_booking" (
  "id"                     UUID PRIMARY KEY,
  "carrier_account_id"     UUID NOT NULL,
  "transaction_id"         UUID NOT NULL,
  "shipment_id"            UUID,
  -- Copied from the account rather than read through it: an account can be moved between
  -- environments, and a sandbox booking that later reads as production is a fictitious shipment
  -- sitting among real ones.
  "environment"            TEXT NOT NULL,
  "service_type"           TEXT NOT NULL,
  "service_name"           TEXT,
  "master_tracking_number" TEXT,
  -- What FedEx said it would cost. The invoice arrives weeks later; the difference between the two
  -- is the thing worth alerting on, and it is invisible without this.
  "quoted_amount"          DECIMAL(14,2),
  "quoted_currency"        TEXT,
  "quoted_amount_eur"      DECIMAL(14,2),
  "duties_paid_by"         TEXT NOT NULL,
  -- The join key for the invoice feed (§8). What was SENT, not what we meant to send.
  "customer_reference"     TEXT NOT NULL,
  "label_url"              TEXT,
  "label_format"           TEXT,
  "status"                 TEXT NOT NULL DEFAULT 'created',
  "cancelled_at"           TIMESTAMP(3),
  -- The whole reply. The only copy that will ever exist.
  "response_json"          JSONB,
  "created_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"             TIMESTAMP(3) NOT NULL,
  "created_by"             UUID,
  "deleted_at"             TIMESTAMP(3),
  -- RESTRICT, not CASCADE: deleting a carrier account must not erase the record of what was shipped
  -- on it, which is the one thing FedEx cannot give back.
  CONSTRAINT "carrier_booking_carrier_account_id_fkey"
    FOREIGN KEY ("carrier_account_id") REFERENCES "carrier_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "carrier_booking_transaction_id_fkey"
    FOREIGN KEY ("transaction_id") REFERENCES "sales_transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "carrier_booking_shipment_id_fkey"
    FOREIGN KEY ("shipment_id") REFERENCES "shipment"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "carrier_booking_transaction_id_idx" ON "carrier_booking"("transaction_id");
CREATE INDEX "carrier_booking_carrier_account_id_idx" ON "carrier_booking"("carrier_account_id");
-- Tracking numbers are how a person finds a shipment when a customer asks about one.
CREATE INDEX "carrier_booking_master_tracking_number_idx" ON "carrier_booking"("master_tracking_number");
