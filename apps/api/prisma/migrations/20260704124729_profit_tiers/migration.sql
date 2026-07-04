-- CreateTable
CREATE TABLE "profit_tier" (
    "id" UUID NOT NULL,
    "name" TEXT,
    "from_pct" DOUBLE PRECISION NOT NULL,
    "to_pct" DOUBLE PRECISION NOT NULL,
    "bg_color" TEXT NOT NULL,
    "font_color" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "profit_tier_pkey" PRIMARY KEY ("id")
);
