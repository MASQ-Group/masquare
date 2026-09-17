-- A company we provide logistics services to: the tenant of the customer portal.
CREATE TABLE "customer" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "legal_name" TEXT,
  "vat_number" TEXT,
  "eori" TEXT,
  "email" TEXT,
  "phone" TEXT,
  "website" TEXT,
  "address_line1" TEXT,
  "address_line2" TEXT,
  "address_city" TEXT,
  "address_region" TEXT,
  "address_postal_code" TEXT,
  "address_country_iso" TEXT,
  "reference_prefix" TEXT NOT NULL,
  "reference_seq" INTEGER NOT NULL DEFAULT 0,
  "company_id" UUID,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "created_by" UUID,
  "updated_by" UUID,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "customer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "customer_reference_prefix_key" ON "customer"("reference_prefix");
CREATE INDEX "customer_name_idx" ON "customer"("name");

ALTER TABLE "customer" ADD CONSTRAINT "customer_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "customer_contact_person" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "customer_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "surname" TEXT,
  "email" TEXT,
  "phone" TEXT,
  "role" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "customer_contact_person_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "customer_contact_person_customer_id_idx" ON "customer_contact_person"("customer_id");

ALTER TABLE "customer_contact_person" ADD CONSTRAINT "customer_contact_person_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
