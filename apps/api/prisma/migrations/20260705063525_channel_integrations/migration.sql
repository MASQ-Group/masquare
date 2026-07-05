-- CreateTable
CREATE TABLE "channel_integration" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "channel_type" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'active',
    "last_tested_at" TIMESTAMP(3),
    "last_test_status" TEXT,
    "last_test_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "channel_integration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_secret" (
    "id" UUID NOT NULL,
    "integration_id" UUID NOT NULL,
    "field_key" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "auth_tag" TEXT NOT NULL,
    "key_version" INTEGER NOT NULL,
    "last4" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_secret_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_audit" (
    "id" UUID NOT NULL,
    "integration_id" UUID,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "detail" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_audit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "integration_secret_integration_id_field_key_key" ON "integration_secret"("integration_id", "field_key");

-- AddForeignKey
ALTER TABLE "integration_secret" ADD CONSTRAINT "integration_secret_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "channel_integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_audit" ADD CONSTRAINT "integration_audit_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "channel_integration"("id") ON DELETE SET NULL ON UPDATE CASCADE;
