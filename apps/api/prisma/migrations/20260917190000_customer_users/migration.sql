-- Portal users: a person who belongs to a logistics customer rather than to us.
ALTER TABLE "user" ADD COLUMN "customer_id" UUID;
CREATE INDEX "user_customer_id_idx" ON "user"("customer_id");
ALTER TABLE "user" ADD CONSTRAINT "user_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- An invitation to set a password. Only the hash of the emailed token is kept.
CREATE TABLE "user_invite" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "used_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID,
  CONSTRAINT "user_invite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_invite_token_hash_key" ON "user_invite"("token_hash");
CREATE INDEX "user_invite_user_id_idx" ON "user_invite"("user_id");

ALTER TABLE "user_invite" ADD CONSTRAINT "user_invite_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
