-- The documents FedEx returns with a booking: a label per parcel, and the commercial invoice.
--
-- In the database rather than object storage: the platform's only bucket is public, so that eBay
-- and Amazon can load product images, and a label carries the recipient's name, address and
-- telephone. Stored here they are private by default and reachable only through a signed-in
-- download. Written after the booking row and never able to undo it: FedEx returns a label once,
-- and if these cannot be written the bytes remain in the reply stored on the booking.
CREATE TABLE "carrier_booking_document" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "booking_id" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "content_type" TEXT,
  "doc_type" TEXT,
  "piece_index" INTEGER,
  "tracking_number" TEXT,
  "found_at" TEXT NOT NULL,
  "content" BYTEA NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "carrier_booking_document_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "carrier_booking_document_booking_id_idx" ON "carrier_booking_document"("booking_id");

ALTER TABLE "carrier_booking_document"
  ADD CONSTRAINT "carrier_booking_document_booking_id_fkey"
  FOREIGN KEY ("booking_id") REFERENCES "carrier_booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
