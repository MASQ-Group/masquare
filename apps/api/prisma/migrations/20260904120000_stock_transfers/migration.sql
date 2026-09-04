-- Internal stock transfers, and serials on movements.
--
-- `stock_movement.reason` has listed 'transfer' since the table was created, but nothing ever wrote
-- one: moving stock between warehouses meant two unrelated adjustments, with no record that they
-- were the same act and nothing stopping one of them being forgotten. The header below pairs them.
--
-- It has no line table on purpose. The two movements per product ARE the lines, so a transfer can
-- never claim to have moved something the balances disagree with.

CREATE TABLE "stock_transfer" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "company_id" UUID,
    "from_warehouse_id" UUID NOT NULL,
    "to_warehouse_id" UUID NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "stock_transfer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stock_transfer_reference_key" ON "stock_transfer"("reference");
CREATE INDEX "stock_transfer_company_id_idx" ON "stock_transfer"("company_id");
CREATE INDEX "stock_transfer_created_at_idx" ON "stock_transfer"("created_at");
CREATE INDEX "stock_transfer_from_warehouse_id_idx" ON "stock_transfer"("from_warehouse_id");
CREATE INDEX "stock_transfer_to_warehouse_id_idx" ON "stock_transfer"("to_warehouse_id");

ALTER TABLE "stock_transfer" ADD CONSTRAINT "stock_transfer_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RESTRICT, not CASCADE: deleting a warehouse must not silently erase the record of stock that
-- passed through it. Warehouses holding history are deactivated rather than deleted anyway.
ALTER TABLE "stock_transfer" ADD CONSTRAINT "stock_transfer_from_warehouse_id_fkey"
    FOREIGN KEY ("from_warehouse_id") REFERENCES "warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_transfer" ADD CONSTRAINT "stock_transfer_to_warehouse_id_fkey"
    FOREIGN KEY ("to_warehouse_id") REFERENCES "warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Which individual units moved. SerialNumber records where a unit is NOW, so repointing it to a new
-- warehouse leaves no trace of where it came from; the movement is the only place the journey
-- survives. Empty for everything that is not serial-tracked, which is currently everything.
ALTER TABLE "stock_movement" ADD COLUMN "serials" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "stock_movement" ADD COLUMN "transfer_id" UUID;
CREATE INDEX "stock_movement_transfer_id_idx" ON "stock_movement"("transfer_id");

-- SET NULL rather than CASCADE: if a transfer header ever goes, the balances it produced are still
-- real and their movements must survive to explain them.
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_transfer_id_fkey"
    FOREIGN KEY ("transfer_id") REFERENCES "stock_transfer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
