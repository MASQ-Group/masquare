-- CreateTable
CREATE TABLE "channel_logo" (
    "id" UUID NOT NULL,
    "channel_type" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "channel_logo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "channel_logo_channel_type_key" ON "channel_logo"("channel_type");
