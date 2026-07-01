-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'disabled');

-- CreateTable
CREATE TABLE "company" (
    "id" UUID NOT NULL,
    "official_name" TEXT NOT NULL,
    "registration_number" TEXT,
    "address_line1" TEXT,
    "address_line2" TEXT,
    "address_city" TEXT,
    "address_region" TEXT,
    "address_postal_code" TEXT,
    "address_country" TEXT,
    "email" TEXT,
    "website" TEXT,
    "phone_landline" TEXT,
    "phone_mobile" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_vat_registration" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "country" TEXT NOT NULL,
    "vat_number" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "company_vat_registration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_contact_person" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "surname" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "role" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "company_contact_person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "module" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT,
    "is_core" BOOLEAN NOT NULL DEFAULT false,
    "shareable" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "module_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_module" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "module_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "company_module_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "module_sharing" (
    "id" UUID NOT NULL,
    "module_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "module_sharing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user" (
    "id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "is_admin" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_company_access" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_company_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_module_access" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "module_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_module_access_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "module_key_key" ON "module"("key");

-- CreateIndex
CREATE UNIQUE INDEX "company_module_company_id_module_id_key" ON "company_module"("company_id", "module_id");

-- CreateIndex
CREATE UNIQUE INDEX "module_sharing_module_id_company_id_key" ON "module_sharing"("module_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_company_access_user_id_company_id_key" ON "user_company_access"("user_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_module_access_user_id_module_id_key" ON "user_module_access"("user_id", "module_id");

-- AddForeignKey
ALTER TABLE "company_vat_registration" ADD CONSTRAINT "company_vat_registration_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_contact_person" ADD CONSTRAINT "company_contact_person_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_module" ADD CONSTRAINT "company_module_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_module" ADD CONSTRAINT "company_module_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "module"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "module_sharing" ADD CONSTRAINT "module_sharing_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "module"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "module_sharing" ADD CONSTRAINT "module_sharing_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_company_access" ADD CONSTRAINT "user_company_access_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_company_access" ADD CONSTRAINT "user_company_access_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_module_access" ADD CONSTRAINT "user_module_access_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_module_access" ADD CONSTRAINT "user_module_access_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "module"("id") ON DELETE CASCADE ON UPDATE CASCADE;
