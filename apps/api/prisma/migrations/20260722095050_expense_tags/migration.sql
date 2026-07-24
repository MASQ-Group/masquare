-- AlterTable
ALTER TABLE "expense" ADD COLUMN     "tag_id" UUID;

-- CreateTable
CREATE TABLE "expense_tag" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "group" TEXT,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "expense_tag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "expense_tag_id_idx" ON "expense"("tag_id");

-- AddForeignKey
ALTER TABLE "expense" ADD CONSTRAINT "expense_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "expense_tag"("id") ON DELETE SET NULL ON UPDATE CASCADE;
