-- Whether a returns allowance counts on a marketplace. On by default: returns were always
-- counted before this switch existed, so every floor keeps the basis it was solved on.
ALTER TABLE "repricing_marketplace_costs" ADD COLUMN "returns_apply" BOOLEAN NOT NULL DEFAULT true;
