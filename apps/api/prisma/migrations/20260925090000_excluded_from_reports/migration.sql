-- A transaction can be real, visible, and still not counted: a Jinius sale that accounting has
-- invoiced locally is the same money twice. Additive; everything counts as before by default.
ALTER TABLE "sales_transaction" ADD COLUMN "excluded_from_reports" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "sales_transaction" ADD COLUMN "excluded_reason" TEXT;
