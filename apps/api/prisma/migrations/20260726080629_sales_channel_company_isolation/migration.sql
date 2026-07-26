-- AlterTable
ALTER TABLE "sales_channel" ADD COLUMN     "company_id" UUID;

-- CreateIndex
CREATE INDEX "sales_channel_company_id_idx" ON "sales_channel"("company_id");

-- AddForeignKey
ALTER TABLE "sales_channel" ADD CONSTRAINT "sales_channel_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: every existing sales channel belongs to the oldest company (masquare).
-- Portable across environments (no hard-coded ids). Multi-company provisioning
-- (cloning Amazon + Local Sales to other companies and repointing their sales
-- transactions) is handled separately by scripts/provision-company-sales-channels.mjs.
UPDATE "sales_channel"
SET "company_id" = (SELECT "id" FROM "company" ORDER BY "created_at" ASC LIMIT 1)
WHERE "company_id" IS NULL;
