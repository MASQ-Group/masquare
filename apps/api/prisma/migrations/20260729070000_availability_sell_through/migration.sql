-- Per-line tracking of how many units have been removed from channel Availability.
ALTER TABLE "sales_transaction_item"
  ADD COLUMN "availability_deducted_qty" INTEGER NOT NULL DEFAULT 0;

-- Opt-in switch: submitting a sale lowers Availability and schedules a channel push.
ALTER TABLE "platform_settings"
  ADD COLUMN "auto_adjust_availability_on_sale" BOOLEAN NOT NULL DEFAULT false;
