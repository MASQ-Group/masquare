#!/usr/bin/env node
/**
 * Demo database helper.
 *
 *   node scripts/demo-db.mjs refresh   — re-clone the live database into the demo one
 *   node scripts/demo-db.mjs reset     — wipe the demo database back to an empty schema
 *
 * Safety: this script only ever WRITES to DEMO_DB. The live database is opened
 * read-only (pg_dump) and is never dropped, truncated or altered. The guard below
 * refuses to run if the target is anything other than the demo database.
 */
import { execFileSync } from 'node:child_process';

const CONTAINER = process.env.PG_CONTAINER ?? 'masquare-postgres';
const PG_USER = process.env.PG_USER ?? 'masquare';
const LIVE_DB = 'masquare';
const DEMO_DB = 'masquare_demo';

if (DEMO_DB === LIVE_DB || !DEMO_DB.endsWith('_demo')) {
  console.error(`Refusing to run: target "${DEMO_DB}" is not a demo database.`);
  process.exit(1);
}

const cmd = process.argv[2];
const sh = (script) => execFileSync('docker', ['exec', CONTAINER, 'sh', '-c', script], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
const psql = (db, sql) => sh(`psql -U ${PG_USER} -d ${db} -v ON_ERROR_STOP=1 -c ${JSON.stringify(sql)}`);

/** Drop and recreate the demo database. Never touches LIVE_DB. */
function recreateDemo() {
  // Disconnect anything still attached, or DROP DATABASE will refuse.
  psql('postgres', `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DEMO_DB}' AND pid <> pg_backend_pid();`);
  psql('postgres', `DROP DATABASE IF EXISTS ${DEMO_DB};`);
  psql('postgres', `CREATE DATABASE ${DEMO_DB} OWNER ${PG_USER};`);
}

try {
  if (cmd === 'refresh') {
    console.log(`Re-cloning ${LIVE_DB} → ${DEMO_DB} (live is read-only)…`);
    recreateDemo();
    sh(`pg_dump -U ${PG_USER} -d ${LIVE_DB} --no-owner --no-acl | psql -U ${PG_USER} -d ${DEMO_DB} -q`);
    const counts = psql(DEMO_DB, "SELECT 'sales_tx=' || (SELECT count(*) FROM sales_transaction WHERE deleted_at IS NULL) || ' products=' || (SELECT count(*) FROM product WHERE deleted_at IS NULL);");
    console.log(`Demo refreshed. ${counts.split('\n').find((l) => l.includes('sales_tx=')).trim()}`);
  } else if (cmd === 'reset') {
    console.log(`Wiping ${DEMO_DB} to an empty database…`);
    recreateDemo();
    console.log('Done. Now run:  npm run db:migrate:demo && npm run db:seed:demo');
  } else {
    console.error('Usage: node scripts/demo-db.mjs <refresh|reset>');
    process.exit(1);
  }
} catch (err) {
  console.error(err.stderr?.toString() || err.message);
  process.exit(1);
}
