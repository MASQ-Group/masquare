-- Sales lines can carry a fraction of a unit.
--
-- Some goods are sold by length or weight, so 1.5 is a real order line rather than a typo. Widening
-- an integer to a decimal is lossless: every existing whole quantity survives unchanged.
--
-- Three decimal places, which covers halves, quarters and thirds of a metre or kilo without
-- inviting float noise into the revenue arithmetic.
--
-- Deliberately scoped to the SALES line. Stock movements, stock levels and availability stay
-- integer for now: both stock-deduction settings are off, so nothing downstream consumes this yet,
-- and widening the stock ledger is a separate decision with its own consequences — channel
-- quantities in particular must be whole numbers when pushed to a marketplace.
ALTER TABLE "sales_transaction_item"
  ALTER COLUMN "quantity" TYPE DECIMAL(14,3) USING "quantity"::DECIMAL(14,3);
