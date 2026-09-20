-- A channel that performs and charges delivery itself (e.g. Jinius): our carrier rate is not a cost
-- of that sale. Additive, defaulting to the behaviour every channel has today.
ALTER TABLE "sales_channel" ADD COLUMN "shipping_by_channel" BOOLEAN NOT NULL DEFAULT false;
