-- Something the platform needs to tell a person, waiting for them to look. One row per recipient.
CREATE TABLE "notification" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT,
  "link" TEXT,
  "related_type" TEXT,
  "related_id" UUID,
  "read_at" TIMESTAMP(3),
  "dedupe_key" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "notification_user_id_read_at_created_at_idx" ON "notification"("user_id", "read_at", "created_at");
CREATE INDEX "notification_user_id_dedupe_key_idx" ON "notification"("user_id", "dedupe_key");

ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
