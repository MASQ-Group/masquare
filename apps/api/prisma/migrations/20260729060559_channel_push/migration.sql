-- CreateTable
CREATE TABLE "channel_push" (
    "id" UUID NOT NULL,
    "company_id" UUID,
    "integration_id" UUID NOT NULL,
    "product_id" UUID,
    "channel_sku" TEXT NOT NULL,
    "marketplace" TEXT NOT NULL DEFAULT '',
    "field" TEXT NOT NULL,
    "requested_value" INTEGER,
    "previous_value" INTEGER,
    "ok" BOOLEAN NOT NULL,
    "message" TEXT,
    "dry_run" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "channel_push_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "channel_push_product_id_idx" ON "channel_push"("product_id");

-- CreateIndex
CREATE INDEX "channel_push_integration_id_idx" ON "channel_push"("integration_id");

-- CreateIndex
CREATE INDEX "channel_push_created_at_idx" ON "channel_push"("created_at");
