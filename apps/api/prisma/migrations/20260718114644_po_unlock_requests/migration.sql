-- CreateTable
CREATE TABLE "purchase_order_unlock_request" (
    "id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "requested_by" UUID,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "decided_by" UUID,
    "decision_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),

    CONSTRAINT "purchase_order_unlock_request_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "purchase_order_unlock_request_purchase_order_id_idx" ON "purchase_order_unlock_request"("purchase_order_id");

-- CreateIndex
CREATE INDEX "purchase_order_unlock_request_status_idx" ON "purchase_order_unlock_request"("status");

-- AddForeignKey
ALTER TABLE "purchase_order_unlock_request" ADD CONSTRAINT "purchase_order_unlock_request_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
