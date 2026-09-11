/**
 * Confirms a migration actually landed on the database this connects to.
 *
 *   REPORT=migration-state bash scripts/prod-scan.sh
 *
 * A Railway deploy runs `migrate deploy` before the app boots, so its output sits above whatever
 * window `railway logs` returns — "the app started" is not evidence the table exists, and the
 * first proof otherwise would be a user clicking something and getting a 500.
 *
 * Reads `_prisma_migrations` and the catalogue. Writes nothing.
 */
const { PrismaClient } = require('@prisma/client');

const WANT = '20260911090000_channel_sync_error';
const TABLE = 'channel_sync_error';

(async () => {
  const prisma = new PrismaClient();

  const applied = await prisma.$queryRawUnsafe(
    `SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"
       WHERE migration_name = $1`, WANT);

  const cols = await prisma.$queryRawUnsafe(
    `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_name = $1 ORDER BY ordinal_position`, TABLE);

  console.log(`  migration ${WANT}`);
  if (applied.length === 0) {
    console.log('    NOT RECORDED — this database has not run it');
  } else {
    const m = applied[0];
    console.log(`    finished_at   ${m.finished_at ? m.finished_at.toISOString() : 'NULL (did not complete)'}`);
    console.log(`    rolled_back   ${m.rolled_back_at ? m.rolled_back_at.toISOString() : 'no'}`);
  }

  console.log(`\n  table "${TABLE}"`);
  if (cols.length === 0) console.log('    DOES NOT EXIST');
  else for (const c of cols) console.log(`    ${c.column_name.padEnd(18)} ${c.data_type}`);

  const rows = await prisma.channelSyncError.count();
  console.log(`\n  rows currently stored          ${rows}`);

  await prisma.$disconnect();
})().catch(async (e) => { console.error(e?.message ?? e); process.exit(1); });
