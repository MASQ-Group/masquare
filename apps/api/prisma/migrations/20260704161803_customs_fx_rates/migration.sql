-- CreateTable
CREATE TABLE "customs_exchange_rate" (
    "id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "currency_code" TEXT NOT NULL,
    "currency_name" TEXT,
    "rate" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customs_exchange_rate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customs_fx_sync" (
    "id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "source_url" TEXT,
    "source_modified" TIMESTAMP(3),
    "months_imported" INTEGER NOT NULL DEFAULT 0,
    "rates_imported" INTEGER NOT NULL DEFAULT 0,
    "trigger" TEXT NOT NULL DEFAULT 'manual',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customs_fx_sync_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customs_exchange_rate_year_month_idx" ON "customs_exchange_rate"("year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "customs_exchange_rate_year_month_currency_code_key" ON "customs_exchange_rate"("year", "month", "currency_code");
