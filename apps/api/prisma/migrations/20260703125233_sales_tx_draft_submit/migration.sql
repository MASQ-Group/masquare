-- AlterTable
ALTER TABLE "sales_transaction" ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'draft',
ADD COLUMN     "unlocked_for_edit" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "sales_transaction_unlock_request" (
    "id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "requested_by" UUID,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "decided_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),

    CONSTRAINT "sales_transaction_unlock_request_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "sales_transaction_unlock_request" ADD CONSTRAINT "sales_transaction_unlock_request_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "sales_transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
