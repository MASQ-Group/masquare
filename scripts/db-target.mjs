/**
 * Work out which database a maintenance script is about to touch, and say so out loud.
 *
 * These scripts default to the repo-root `.env`, which points at localhost. That default is right
 * for a local run and dangerous for an intended production one: `DATABASE_URL="$PROD_URL" node …`
 * with `PROD_URL` unset expands to an empty string, the fallback quietly takes over, and the script
 * reports a clean success against the wrong database. The operator sees "Applied" and believes
 * production is done.
 *
 * So: an explicitly-supplied-but-empty DATABASE_URL is a hard error, never a fallback, and every
 * run prints the host and database name it resolved. Credentials are never printed.
 */
import { readFileSync } from 'fs';

export function resolveDatabase(root) {
  // Distinguish "not supplied" from "supplied as empty". Only the former may fall back.
  const supplied = Object.prototype.hasOwnProperty.call(process.env, 'DATABASE_URL');
  if (supplied && !String(process.env.DATABASE_URL).trim()) {
    throw new Error(
      'DATABASE_URL was supplied but is empty — refusing to fall back to the local .env.\n' +
      '  This usually means the variable you passed is unset, e.g. DATABASE_URL="$PROD_URL" with no PROD_URL.\n' +
      '  Set it, or omit DATABASE_URL entirely to deliberately use the local database.',
    );
  }

  if (!supplied) {
    try {
      for (const line of readFileSync(`${root}/.env`, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
      }
    } catch { /* env already provided another way */ }
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('No DATABASE_URL — pass one, or provide a repo-root .env.');

  // Host and database only. Never the user, never the password.
  let where = '(unparseable connection string)';
  let local = false;
  try {
    const u = new URL(url);
    const db = u.pathname.replace(/^\//, '') || '(default)';
    where = `${u.hostname}:${u.port || '5432'}/${db}`;
    local = ['localhost', '127.0.0.1', '::1', 'host.docker.internal'].includes(u.hostname);
  } catch { /* keep the placeholder */ }

  return { where, local, supplied };
}

/** Print the target so a misdirected run is obvious before anything is written. */
export function announceDatabase(root) {
  const t = resolveDatabase(root);
  console.log(`Database: ${t.where}${t.local ? '  (LOCAL)' : '  ** NOT LOCAL **'}`);
  console.log('');
  return t;
}
