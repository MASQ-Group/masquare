-- CreateTable
CREATE TABLE "country" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "iso_code" TEXT NOT NULL,
    "continent" TEXT NOT NULL,
    "eu_vat_zone" BOOLEAN NOT NULL DEFAULT false,
    "vat_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "default_shipping_service_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "country_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping_service" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "alias" TEXT,
    "calc_method" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "shipping_service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping_zone" (
    "id" UUID NOT NULL,
    "shipping_service_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "shipping_zone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping_zone_country" (
    "id" UUID NOT NULL,
    "zone_id" UUID NOT NULL,
    "country_id" UUID NOT NULL,

    CONSTRAINT "shipping_zone_country_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping_rate" (
    "id" UUID NOT NULL,
    "zone_id" UUID NOT NULL,
    "from_weight_kg" DECIMAL(10,3) NOT NULL,
    "to_weight_kg" DECIMAL(10,3) NOT NULL,
    "charge_eur" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "shipping_rate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "country_shipping_zone" (
    "id" UUID NOT NULL,
    "country_id" UUID NOT NULL,
    "shipping_service_id" UUID NOT NULL,
    "zone_id" UUID NOT NULL,

    CONSTRAINT "country_shipping_zone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_channel" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "native_country_id" UUID,
    "native_currency" TEXT,
    "email" TEXT,
    "website" TEXT,
    "contact_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "sales_channel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "country_iso_code_key" ON "country"("iso_code");

-- CreateIndex
CREATE UNIQUE INDEX "shipping_zone_country_zone_id_country_id_key" ON "shipping_zone_country"("zone_id", "country_id");

-- CreateIndex
CREATE UNIQUE INDEX "country_shipping_zone_country_id_shipping_service_id_key" ON "country_shipping_zone"("country_id", "shipping_service_id");

-- AddForeignKey
ALTER TABLE "country" ADD CONSTRAINT "country_default_shipping_service_id_fkey" FOREIGN KEY ("default_shipping_service_id") REFERENCES "shipping_service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_zone" ADD CONSTRAINT "shipping_zone_shipping_service_id_fkey" FOREIGN KEY ("shipping_service_id") REFERENCES "shipping_service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_zone_country" ADD CONSTRAINT "shipping_zone_country_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "shipping_zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_zone_country" ADD CONSTRAINT "shipping_zone_country_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "country"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_rate" ADD CONSTRAINT "shipping_rate_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "shipping_zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "country_shipping_zone" ADD CONSTRAINT "country_shipping_zone_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "country"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "country_shipping_zone" ADD CONSTRAINT "country_shipping_zone_shipping_service_id_fkey" FOREIGN KEY ("shipping_service_id") REFERENCES "shipping_service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "country_shipping_zone" ADD CONSTRAINT "country_shipping_zone_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "shipping_zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_channel" ADD CONSTRAINT "sales_channel_native_country_id_fkey" FOREIGN KEY ("native_country_id") REFERENCES "country"("id") ON DELETE SET NULL ON UPDATE CASCADE;
