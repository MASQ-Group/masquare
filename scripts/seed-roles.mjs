// Seed the shipped roles, and give every existing user one.
//
// Run this in the SAME change that turns enforcement on. Until now the access grants enforced
// nothing — the token carried only { sub, email, isAdmin } and no guard read the module table — so
// a non-admin could reach every route. With the guard live, a user holding no role holds nothing,
// and four real people would be locked out of the platform the moment it deployed.
//
// The back-fill is therefore like-for-like rather than aspirational: every existing non-admin gets
// Operations, which is the closest honest description of what they could already do. Narrowing
// them is the next job, done deliberately from the Access page, one person at a time — not a side
// effect of a deployment nobody expected to change their access.
//
// Idempotent: re-running updates the shipped roles in place and leaves user assignments alone.
//
// Usage — in Git Bash, from the repo root:
//   node scripts/seed-roles.mjs              # report only, writes nothing
//   node scripts/seed-roles.mjs --apply      # writes
//
// Against production, in the same Git Bash window where you exported PROD_URL:
//   DATABASE_URL="$PROD_URL" node scripts/seed-roles.mjs --apply

import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { announceDatabase } from './db-target.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
announceDatabase(ROOT);

const APPLY = process.argv.includes('--apply');
const prisma = new PrismaClient();

/**
 * The role definitions, read from the API source so there is exactly one copy.
 *
 * Parsed rather than imported because the source is TypeScript and this is a plain node script;
 * duplicating the grants here would give the platform two answers to the same question, and the
 * copy would be the one that quietly went stale.
 */
function loadRoles() {
  const file = join(ROOT, 'apps/api/src/access/default-roles.ts');
  const src = readFileSync(file, 'utf8');
  const body = src.slice(src.indexOf('export const DEFAULT_ROLES'));
  const roles = [];
  // Each role literal: key, name, description, then its grants object.
  const re = /\{\s*key:\s*'([^']+)',\s*name:\s*'([^']+)',\s*description:\s*([\s\S]*?),\s*grants:\s*\{([\s\S]*?)\n {4}\},\s*\},/g;
  let m;
  while ((m = re.exec(body))) {
    const [, key, name, descRaw, grantsRaw] = m;
    const description = descRaw.trim().replace(/^'|'$/g, '').replace(/'\s*\+?\s*\n\s*'/g, '');
    const areas = {};
    const capabilities = {};
    const areaBlock = grantsRaw.slice(grantsRaw.indexOf('areas:'), grantsRaw.indexOf('capabilities:'));
    const capBlock = grantsRaw.slice(grantsRaw.indexOf('capabilities:'));
    for (const a of areaBlock.matchAll(/(\w+):\s*'(none|view|edit)'/g)) areas[a[1]] = a[2];
    for (const c of capBlock.matchAll(/(\w+):\s*(true|false)/g)) capabilities[c[1]] = c[2] === 'true';
    roles.push({ key, name, description, grants: { areas, capabilities } });
  }
  return roles;
}

async function main() {
  const roles = loadRoles();
  if (roles.length < 5) throw new Error(`Only parsed ${roles.length} roles from default-roles.ts — refusing to seed a partial set.`);

  console.log(`Parsed ${roles.length} role(s): ${roles.map((r) => r.key).join(', ')}\n`);
  for (const r of roles) {
    const areas = Object.entries(r.grants.areas);
    const caps = Object.entries(r.grants.capabilities).filter(([, v]) => v);
    console.log(`  ${r.name.padEnd(16)} ${areas.filter(([, v]) => v === 'edit').length} edit · ${areas.filter(([, v]) => v === 'view').length} view · ${caps.length} capabilit${caps.length === 1 ? 'y' : 'ies'}`);
  }

  const users = await prisma.user.findMany({
    where: { deletedAt: null },
    select: { id: true, fullName: true, email: true, isAdmin: true, roleId: true },
    orderBy: { fullName: 'asc' },
  });
  const needRole = users.filter((u) => !u.isAdmin && !u.roleId);

  console.log(`\n${users.length} user(s): ${users.filter((u) => u.isAdmin).length} admin, ${needRole.length} needing a role.`);
  for (const u of needRole) console.log(`  ${u.fullName} <${u.email}> → Operations`);
  if (!needRole.length) console.log('  (every non-admin already has one)');

  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply to write.');
    return;
  }

  for (const [i, r] of roles.entries()) {
    await prisma.role.upsert({
      where: { key: r.key },
      // isSystem is not reset on update: a role someone has since edited stays theirs to keep.
      create: { key: r.key, name: r.name, description: r.description, grants: r.grants, isSystem: true, sortOrder: i },
      update: { name: r.name, description: r.description, grants: r.grants, sortOrder: i },
    });
  }
  console.log(`\nSeeded ${roles.length} role(s).`);

  if (needRole.length) {
    const ops = await prisma.role.findUnique({ where: { key: 'operations' }, select: { id: true } });
    if (!ops) throw new Error('Operations role missing after seeding — refusing to leave users without one.');
    await prisma.user.updateMany({ where: { id: { in: needRole.map((u) => u.id) } }, data: { roleId: ops.id } });
    console.log(`Assigned Operations to ${needRole.length} user(s). Narrow them from Users → Access.`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
