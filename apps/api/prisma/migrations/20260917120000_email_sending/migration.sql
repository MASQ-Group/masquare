-- How the platform sends email (Google Workspace, service account), and what it has sent.
CREATE TABLE "email_settings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "sender_address" TEXT,
  "sender_name" TEXT NOT NULL DEFAULT 'maSquare',
  "reply_to" TEXT,
  "client_email" TEXT,
  "key_id" TEXT,
  "private_key_ciphertext" TEXT,
  "private_key_iv" TEXT,
  "private_key_auth_tag" TEXT,
  "private_key_version" INTEGER,
  "key_loaded_at" TIMESTAMP(3),
  "last_test_status" TEXT,
  "last_test_message" TEXT,
  "last_tested_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "updated_by" UUID,
  CONSTRAINT "email_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "email_message" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "to_address" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "body_text" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'notification',
  "status" TEXT NOT NULL DEFAULT 'queued',
  "error" TEXT,
  "provider_message_id" TEXT,
  "sent_at" TIMESTAMP(3),
  "related_type" TEXT,
  "related_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID,
  CONSTRAINT "email_message_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "email_message_created_at_idx" ON "email_message"("created_at");
CREATE INDEX "email_message_related_type_related_id_idx" ON "email_message"("related_type", "related_id");
CREATE INDEX "email_message_status_idx" ON "email_message"("status");
