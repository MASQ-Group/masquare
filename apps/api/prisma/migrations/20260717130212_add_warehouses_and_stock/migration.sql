-- CreateTable
CREATE TABLE "warehouse" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'physical',
    "parent_warehouse_id" UUID,
    "include_in_inventory" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_level" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "quantity_on_hand" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_level_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movement" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "qty_delta" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "stock_movement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "warehouse_parent_warehouse_id_idx" ON "warehouse"("parent_warehouse_id");

-- CreateIndex
CREATE INDEX "stock_level_warehouse_id_idx" ON "stock_level"("warehouse_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_level_product_id_warehouse_id_key" ON "stock_level"("product_id", "warehouse_id");

-- CreateIndex
CREATE INDEX "stock_movement_product_id_idx" ON "stock_movement"("product_id");

-- CreateIndex
CREATE INDEX "stock_movement_warehouse_id_idx" ON "stock_movement"("warehouse_id");

-- CreateIndex
CREATE INDEX "stock_movement_created_at_idx" ON "stock_movement"("created_at");

-- AddForeignKey
ALTER TABLE "warehouse" ADD CONSTRAINT "warehouse_parent_warehouse_id_fkey" FOREIGN KEY ("parent_warehouse_id") REFERENCES "warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_level" ADD CONSTRAINT "stock_level_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_level" ADD CONSTRAINT "stock_level_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
