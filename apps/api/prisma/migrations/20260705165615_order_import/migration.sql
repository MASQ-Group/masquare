-- AlterTable
ALTER TABLE "channel_integration" ADD COLUMN     "auto_sync_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "backfill_days" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "last_sync_message" TEXT,
ADD COLUMN     "last_sync_run_at" TIMESTAMP(3),
ADD COLUMN     "last_sync_status" TEXT,
ADD COLUMN     "last_synced_at" TIMESTAMP(3),
ADD COLUMN     "target_company_id" UUID,
ADD COLUMN     "target_sales_channel_id" UUID;

-- AlterTable
ALTER TABLE "sales_transaction" ADD COLUMN     "integration_id" UUID,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'manual';
