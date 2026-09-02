-- Who changed what, and when.
--
-- The per-row created_by/updated_by stamps only ever hold the LAST person to touch a row, and say
-- nothing about which field moved. This records each change with its field-level diff, so a
-- mistake is visible in the log itself rather than needing a hunt through the current state.
--
-- `source` separates a person from a machine. It exists for retention: a sync writes thousands of
-- rows and a person writes a handful, so purging both on one clock would force a choice between
-- unbounded growth and losing the human record this is for.

CREATE TABLE "activity" (
  "id"           UUID NOT NULL,
  "entity_type"  TEXT NOT NULL,
  "entity_id"    UUID NOT NULL,
  "entity_label" TEXT,
  "action"       TEXT NOT NULL,
  "source"       TEXT NOT NULL DEFAULT 'user',
  "actor_id"     UUID,
  "summary"      TEXT,
  "changes"      JSONB,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "activity_pkey" PRIMARY KEY ("id")
);

-- The product card reads one entity newest-first; a global feed reads by date; "what did X do"
-- reads by actor.
CREATE INDEX "activity_entity_type_entity_id_created_at_idx" ON "activity"("entity_type", "entity_id", "created_at");
CREATE INDEX "activity_created_at_idx" ON "activity"("created_at");
CREATE INDEX "activity_actor_id_idx" ON "activity"("actor_id");

-- The actor may be deleted later; the record of what they did must survive them.
ALTER TABLE "activity" ADD CONSTRAINT "activity_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
