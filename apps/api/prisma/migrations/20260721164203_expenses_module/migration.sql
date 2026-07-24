-- CreateTable
CREATE TABLE "expense_category" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "parent_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "expense_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_definition" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category_id" UUID,
    "default_occurrence" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "expense_definition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense" (
    "id" UUID NOT NULL,
    "definition_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "occurrence" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "start_month" TEXT NOT NULL,
    "end_month" TEXT,
    "once_off_date" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_amount" (
    "id" UUID NOT NULL,
    "expense_id" UUID NOT NULL,
    "effective_month" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "amount_eur" DECIMAL(14,2) NOT NULL,
    "fx_rate" DECIMAL(18,8),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expense_amount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_month_override" (
    "id" UUID NOT NULL,
    "expense_id" UUID NOT NULL,
    "month" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "amount_eur" DECIMAL(14,2) NOT NULL,
    "fx_rate" DECIMAL(18,8),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expense_month_override_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "expense_category_parent_id_idx" ON "expense_category"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "expense_definition_code_key" ON "expense_definition"("code");

-- CreateIndex
CREATE INDEX "expense_definition_category_id_idx" ON "expense_definition"("category_id");

-- CreateIndex
CREATE INDEX "expense_definition_id_idx" ON "expense"("definition_id");

-- CreateIndex
CREATE INDEX "expense_company_id_idx" ON "expense"("company_id");

-- CreateIndex
CREATE INDEX "expense_amount_expense_id_idx" ON "expense_amount"("expense_id");

-- CreateIndex
CREATE UNIQUE INDEX "expense_month_override_expense_id_month_key" ON "expense_month_override"("expense_id", "month");

-- AddForeignKey
ALTER TABLE "expense_category" ADD CONSTRAINT "expense_category_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "expense_category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_definition" ADD CONSTRAINT "expense_definition_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "expense_category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense" ADD CONSTRAINT "expense_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "expense_definition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense" ADD CONSTRAINT "expense_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_amount" ADD CONSTRAINT "expense_amount_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_month_override" ADD CONSTRAINT "expense_month_override_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;
