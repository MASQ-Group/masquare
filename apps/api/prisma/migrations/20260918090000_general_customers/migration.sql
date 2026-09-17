-- Customers become general: what they take from us is a list of types, and the logistics-only
-- reference prefix stops being required of everybody.
ALTER TABLE "customer" ADD COLUMN "types" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "customer" ALTER COLUMN "reference_prefix" DROP NOT NULL;

-- Everyone created so far was created as a logistics customer; say so.
UPDATE "customer" SET "types" = ARRAY['logistics']::TEXT[] WHERE "reference_prefix" IS NOT NULL;

-- The access area is renamed from logistics_customers to customers. System roles are rewritten
-- from code on every boot; custom roles and per-person overrides live only here, so they are
-- renamed here, keeping whatever level each held.
UPDATE "role"
SET "grants" = jsonb_set("grants" #- '{areas,logistics_customers}', '{areas,customers}', "grants" -> 'areas' -> 'logistics_customers')
WHERE "grants" -> 'areas' ? 'logistics_customers';

UPDATE "user"
SET "access_overrides" = jsonb_set("access_overrides" #- '{areas,logistics_customers}', '{areas,customers}', "access_overrides" -> 'areas' -> 'logistics_customers')
WHERE "access_overrides" IS NOT NULL AND "access_overrides" -> 'areas' ? 'logistics_customers';
