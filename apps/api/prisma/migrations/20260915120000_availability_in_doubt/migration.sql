-- An availability figure an oversell proved wrong. While set, no push sends it to any channel.
-- Every existing row starts trusted; nothing is inferred backwards from the ledger.
ALTER TABLE "product_availability"
  ADD COLUMN "in_doubt_since" TIMESTAMP(3),
  ADD COLUMN "in_doubt_note" TEXT;
