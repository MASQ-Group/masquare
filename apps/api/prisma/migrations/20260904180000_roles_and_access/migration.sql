-- Roles, and per-user access overrides.
--
-- Until now `user_module_access` was the only thing resembling a permission, and it enforced
-- nothing: the token carried only { sub, email, isAdmin }, no guard ever read the table, and the
-- sidebar filtered on isAdmin alone. Of 309 API routes, 8 were guarded. The checkboxes on the
-- Access tab were a description of intent that nothing acted on.
--
-- This adds the storage. Enforcement follows in the next change; nothing here restricts anyone yet,
-- and every existing user keeps working exactly as before because roleId is null and null resolves
-- through the admin flag they already have.

CREATE TABLE "role" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    -- { areas: { <areaKey>: 'none'|'view'|'edit' }, capabilities: { <capKey>: boolean } }
    -- JSON against a catalogue held in code, so the keys stay versioned with the guards that read
    -- them. Unknown keys are dropped on read and refused on write.
    "grants" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "role_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "role_key_key" ON "role"("key");

ALTER TABLE "user" ADD COLUMN "role_id" UUID;
-- Deltas on top of the role. A key present here REPLACES the role's value, which is what lets an
-- override take something away as well as add it.
ALTER TABLE "user" ADD COLUMN "access_overrides" JSONB;

CREATE INDEX "user_role_id_idx" ON "user"("role_id");

-- SET NULL, not CASCADE: deleting a role must never delete the people who held it.
ALTER TABLE "user" ADD CONSTRAINT "user_role_id_fkey"
    FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE SET NULL ON UPDATE CASCADE;
