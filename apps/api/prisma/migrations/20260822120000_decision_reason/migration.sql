-- Store why a decision came out as it did. It was computed on every decision and only logged,
-- which left the quarantine queue listing SKUs with no way to tell what was wrong with them.
ALTER TABLE "repricing_decision" ADD COLUMN "reason" TEXT;
