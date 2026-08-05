-- CreateTable
CREATE TABLE "repricing_control" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "live_writes_enabled" BOOLEAN NOT NULL DEFAULT false,
    "kill_switch_engaged" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "repricing_control_pkey" PRIMARY KEY ("id")
);
