/**
 * Is the migration history healthy, or is it blocking deploys?
 *
 *   REPORT=migration-health bash scripts/prod-scan.sh
 *
 * `prisma migrate deploy` refuses to do anything while a previous migration is recorded as started
 * and neither finished nor rolled back. That is the state a failed migration leaves behind, and it
 * blocks every subsequent deploy — including the one that would fix it. The container chains the
 * migration and the app with &&, so the app does not start either.
 *
 * Read-only: it reads the history table and prints it.
 */
const { PrismaClient } = require('@prisma/client');

const pad = (s, n) => String(s ?? '').padEnd(n).slice(0, n);
const when = (d) => (d ? new Date(d).toISOString().slice(0, 19).replace('T', ' ') : '—');

(async () => {
  const p = new PrismaClient();

  const rows = await p.$queryRawUnsafe(`
    SELECT migration_name, started_at, finished_at, rolled_back_at, applied_steps_count, logs
    FROM _prisma_migrations
    ORDER BY started_at DESC
    LIMIT 12
  `);

  // Started, not finished, not rolled back. This is what stops everything.
  const blocking = rows.filter((r) => !r.finished_at && !r.rolled_back_at);
  const rolledBack = rows.filter((r) => r.rolled_back_at);

  console.log(`  migrations blocking deploys          ${blocking.length}`);
  console.log(`  rolled back in the last 12           ${rolledBack.length}`);
  console.log('');

  console.log(`  ${pad('migration', 48)} ${pad('started', 20)} ${pad('finished', 20)} steps`);
  for (const r of rows) {
    const flag = !r.finished_at && !r.rolled_back_at ? '  <- BLOCKING' : r.rolled_back_at ? '  <- rolled back' : '';
    console.log(`  ${pad(r.migration_name, 48)} ${pad(when(r.started_at), 20)} ${pad(when(r.finished_at), 20)} ${String(r.applied_steps_count ?? 0).padStart(5)}${flag}`);
  }

  for (const r of blocking) {
    console.log('');
    console.log(`  why "${r.migration_name}" stopped:`);
    // The error Postgres gave, as Prisma recorded it. This is the whole diagnosis.
    console.log(String(r.logs ?? '(no log recorded)').split('\n').slice(0, 14).map((l) => `    ${l}`).join('\n'));
  }

  await p.$disconnect();
})();
