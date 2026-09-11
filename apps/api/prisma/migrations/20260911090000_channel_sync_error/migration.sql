-- Why an individual order failed to import, for the LAST sync run of each integration.
--
-- The sync catches per order so one bad order cannot abandon the rest, but the reason then went
-- only to the log and the page could say no more than "6 errors". A defect that failed every order
-- carrying a particular field survived a day of syncs behind that count.
--
-- Rows are replaced wholesale at the start of each run, so they always describe the count currently
-- on screen. ON DELETE CASCADE because a reason for a connection that no longer exists is noise.
CREATE TABLE "channel_sync_error" (
    "id" UUID NOT NULL,
    "integration_id" UUID NOT NULL,
    "transaction_ref" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_sync_error_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "channel_sync_error_integration_id_idx" ON "channel_sync_error"("integration_id");

ALTER TABLE "channel_sync_error" ADD CONSTRAINT "channel_sync_error_integration_id_fkey"
    FOREIGN KEY ("integration_id") REFERENCES "channel_integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
