// Probe: can we pull the Amazon VAT Transactions Report through SP-API?
//
// Answers three questions before anyone builds the monthly job, in one read-only pass:
//
//   1. Does this company's SP-API app hold the "Tax Invoicing (Restricted)" role? Without it every
//      call is a 403 and no amount of code helps.
//   2. Does one request really cover ALL EU stores? Amazon documents the report as available in
//      DE/ES/IT/FR/UK while also saying it "ignores the marketplaceId parameter and will return
//      data for all available stores" — which would mean NL, BE, PL, SE and IE come along for
//      free. Worth proving rather than assuming.
//   3. Does the Restricted Data Token flow work end to end, including the presigned download.
//
// Nothing is written anywhere: no database, no file. The report contains buyer names, addresses
// and VAT numbers, so the summary deliberately reports SHAPE ONLY — headers, counts, marketplaces,
// date span. No row is ever printed and the file is never persisted.
//
// Amazon only makes this report available from the THIRD of each month, so before then the
// previous month cannot be requested; the script picks a month it is allowed to ask for and says
// which and why.
//
// Usage:
//   node scripts/probe-vat-report.mjs "Amazon DE"          # previous (or last available) month
//   node scripts/probe-vat-report.mjs "Amazon DE" 2026-07  # a specific month
//
// DATABASE_URL is read from the environment (see scripts/db-target.mjs).

import { PrismaClient } from '@prisma/client';
import { createDecipheriv } from 'crypto';
import { gunzipSync } from 'zlib';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { announceDatabase } from './db-target.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
announceDatabase(ROOT);

const INTEGRATION = process.argv[2] || 'Amazon DE';
const MONTH_ARG = process.argv[3] || null;

const EU_ENDPOINT = 'https://sellingpartnerapi-eu.amazon.com';
const REPORT_TYPE = 'GET_VAT_TRANSACTION_DATA';
const prisma = new PrismaClient();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Which month to ask for.
 *
 * Amazon publishes the report from the 3rd, so on the 1st or 2nd the previous month does not yet
 * exist and asking for it proves nothing about our access. Fall back a further month so a failure
 * means what we want it to mean.
 */
function chooseMonth() {
  if (MONTH_ARG) {
    const m = /^(\d{4})-(\d{2})$/.exec(MONTH_ARG);
    if (!m) throw new Error(`Month must be YYYY-MM (got "${MONTH_ARG}")`);
    return { year: Number(m[1]), month: Number(m[2]) - 1, why: 'requested on the command line' };
  }
  const now = new Date();
  const backOff = now.getUTCDate() < 3 ? 2 : 1;
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - backOff, 1));
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth(),
    why: backOff === 2
      ? `today is the ${now.getUTCDate()}${now.getUTCDate() === 1 ? 'st' : 'nd'} and Amazon publishes from the 3rd, so last month is not available yet`
      : 'the previous calendar month',
  };
}

async function main() {
  const { year, month, why } = chooseMonth();
  const start = new Date(Date.UTC(year, month, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year, month + 1, 1, 0, 0, 0) - 1);
  const label = `${start.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' })} ${year}`;

  // Both companies run their own "Amazon DE", so a name alone is ambiguous. Refuse to guess —
  // picking the wrong one would probe the wrong developer account and answer the wrong question.
  const matches = await prisma.channelIntegration.findMany({
    where: { deletedAt: null, channelType: 'amazon', ...(INTEGRATION.includes('-') && INTEGRATION.length > 30 ? { id: INTEGRATION } : { name: INTEGRATION }) },
    orderBy: { createdAt: 'asc' },
  });
  if (matches.length === 0) throw new Error(`No Amazon integration matching "${INTEGRATION}"`);
  if (matches.length > 1) {
    const companies = await prisma.company.findMany({ where: { id: { in: matches.map((m) => m.targetCompanyId) } }, select: { id: true, officialName: true } });
    const nameOf = new Map(companies.map((c) => [c.id, c.officialName]));
    console.error(`"${INTEGRATION}" matches ${matches.length} connections — one per company.`);
    console.error('Re-run with the id of the one you mean:');
    console.error('');
    for (const m of matches) console.error(`  ${m.id}   ${nameOf.get(m.targetCompanyId) ?? '(no company)'}`);
    console.error('');
    console.error('  node scripts/probe-vat-report.mjs <id>');
    process.exitCode = 1;
    return;
  }
  const intg = matches[0];
  const company = await prisma.company.findFirst({ where: { id: intg.targetCompanyId }, select: { officialName: true } });

  console.log(`Company:    ${company?.officialName ?? '—'}  (via ${intg.name})`);
  console.log(`Month:      ${label}  — ${why}`);
  console.log(`Range:      ${start.toISOString()} .. ${end.toISOString()}\n`);

  // Credentials for THIS integration only. The two companies have separate Amazon developer
  // accounts and a call must never cross between them.
  const key = Buffer.from(process.env.SECRETS_MASTER_KEY, 'base64');
  const secretRows = await prisma.integrationSecret.findMany({ where: { integrationId: intg.id } });
  const secrets = Object.fromEntries(secretRows.map((r) => {
    const d = createDecipheriv('aes-256-gcm', key, Buffer.from(r.iv, 'base64'));
    d.setAuthTag(Buffer.from(r.authTag, 'base64'));
    return [r.fieldKey, Buffer.concat([d.update(Buffer.from(r.ciphertext, 'base64')), d.final()]).toString('utf8')];
  }));
  const config = intg.config ?? {};

  const tokenRes = await fetch('https://api.amazon.com/auth/o2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token', refresh_token: secrets.refreshToken,
      client_id: config.lwaClientId, client_secret: secrets.lwaClientSecret,
    }).toString(),
  });
  const tokenJson = await tokenRes.json();
  if (!tokenJson.access_token) throw new Error(`LWA auth failed (${tokenRes.status})`);
  const token = tokenJson.access_token;
  console.log('Authenticated.\n');

  const amz = (path, init = {}, bearer = token) => fetch(`${EU_ENDPOINT}${path}`, {
    ...init,
    headers: { 'x-amz-access-token': bearer, 'Content-Type': 'application/json', Accept: 'application/json', ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(30000),
  });

  // --- 1. Request the report ------------------------------------------------
  // marketplaceIds is required by the schema but this report ignores it — the claim under test.
  console.log('1. createReport …');
  const createRes = await amz('/reports/2021-06-30/reports', {
    method: 'POST',
    body: JSON.stringify({
      reportType: REPORT_TYPE,
      dataStartTime: start.toISOString(),
      dataEndTime: end.toISOString(),
      marketplaceIds: ['A1PA6795UKMFR9'], // DE, as a formality
    }),
  });
  const created = await createRes.json().catch(() => null);
  if (!createRes.ok) {
    console.error(`\n   FAILED ${createRes.status}: ${JSON.stringify(created?.errors ?? created)}`);
    if (createRes.status === 403) {
      console.error('\n   403 means the app lacks the "Tax Invoicing (Restricted)" role.');
      console.error('   That is granted in Amazon Developer Central per application, and this');
      console.error('   company has its own developer account — so it must be granted there.');
      console.error('   No code change can work around it.');
    }
    process.exitCode = 1;
    return;
  }
  const reportId = created.reportId;
  console.log(`   accepted — reportId ${reportId}\n`);

  // --- 2. Wait for it -------------------------------------------------------
  console.log('2. polling getReport (Amazon generates asynchronously) …');
  let doc = null;
  const deadline = Date.now() + 12 * 60 * 1000;
  while (Date.now() < deadline) {
    await sleep(15000);
    const r = await amz(`/reports/2021-06-30/reports/${reportId}`);
    const j = await r.json().catch(() => null);
    if (!r.ok) { console.error(`   getReport ${r.status}: ${JSON.stringify(j?.errors ?? j)}`); process.exitCode = 1; return; }
    const status = j.processingStatus;
    process.stdout.write(`   ${status} … `);
    if (status === 'DONE') { doc = j.reportDocumentId; console.log('\n'); break; }
    if (status === 'CANCELLED') {
      // Amazon cancels rather than returning an empty file when the range holds no data.
      console.log('\n\n   CANCELLED — Amazon had no data for this range. Access works; the month is empty.');
      return;
    }
    if (status === 'FATAL') { console.log('\n\n   FATAL — Amazon could not generate it.'); process.exitCode = 1; return; }
  }
  if (!doc) { console.log('\n\n   Timed out after 12 minutes. Not a failure — try again with the same reportId.'); return; }

  // --- 3. Restricted Data Token --------------------------------------------
  // The document holds buyer names, addresses and VAT numbers, so the ordinary access token is
  // not enough: the download needs a token minted for this one document.
  console.log('3. createRestrictedDataToken …');
  const rdtRes = await amz('/tokens/2021-03-01/restrictedDataToken', {
    method: 'POST',
    body: JSON.stringify({ restrictedResources: [{ method: 'GET', path: `/reports/2021-06-30/documents/${doc}` }] }),
  });
  const rdtJson = await rdtRes.json().catch(() => null);
  if (!rdtRes.ok || !rdtJson?.restrictedDataToken) {
    console.error(`   FAILED ${rdtRes.status}: ${JSON.stringify(rdtJson?.errors ?? rdtJson)}`);
    console.error('   The report generated but cannot be downloaded — the app is missing the');
    console.error('   restricted role even though createReport was allowed.');
    process.exitCode = 1;
    return;
  }
  console.log(`   token issued, valid ${rdtJson.expiresIn}s\n`);

  // --- 4. Download ----------------------------------------------------------
  console.log('4. getReportDocument + download …');
  const docRes = await amz(`/reports/2021-06-30/documents/${doc}`, {}, rdtJson.restrictedDataToken);
  const docJson = await docRes.json().catch(() => null);
  if (!docRes.ok) { console.error(`   FAILED ${docRes.status}: ${JSON.stringify(docJson?.errors ?? docJson)}`); process.exitCode = 1; return; }

  // The presigned URL expires in 5 minutes, which is why the real job must download immediately
  // rather than storing the URL for later.
  const fileRes = await fetch(docJson.url, { signal: AbortSignal.timeout(120000) });
  if (!fileRes.ok) { console.error(`   download failed ${fileRes.status}`); process.exitCode = 1; return; }
  const raw = Buffer.from(await fileRes.arrayBuffer());
  const text = (docJson.compressionAlgorithm === 'GZIP' ? gunzipSync(raw) : raw).toString('utf8');
  console.log(`   ${(raw.length / 1024).toFixed(0)} KB ${docJson.compressionAlgorithm ?? 'uncompressed'} -> ${(text.length / 1024).toFixed(0)} KB\n`);

  // --- 5. Shape only, never contents ---------------------------------------
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const headers = (lines[0] ?? '').split('\t');
  const rows = lines.slice(1).map((l) => l.split('\t'));
  const col = (name) => headers.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase());

  const distinct = (i) => {
    if (i < 0) return null;
    const s = new Set();
    for (const r of rows) if (r[i]?.trim()) s.add(r[i].trim());
    return [...s].sort();
  };

  console.log('='.repeat(70));
  console.log(`RESULT — ${label}: access works, ${rows.length} transaction rows.`);
  console.log('='.repeat(70));
  console.log(`\nColumns (${headers.length}):`);
  console.log('  ' + headers.join(', ').slice(0, 1200));

  // The question this probe exists to answer.
  for (const name of ['MARKETPLACE_NAME', 'SALES_CHANNEL', 'ARRIVAL_COUNTRY', 'TAXABLE_JURISDICTION', 'TRANSACTION_TYPE', 'TRANSACTION_SELLER_VAT_NUMBER_COUNTRY']) {
    const vals = distinct(col(name));
    if (vals) console.log(`\n${name} (${vals.length}): ${vals.join(', ').slice(0, 600)}`);
  }

  const dateIdx = col('TRANSACTION_COMPLETE_DATE') >= 0 ? col('TRANSACTION_COMPLETE_DATE') : col('TRANSACTION_DEPART_DATE');
  if (dateIdx >= 0) {
    const ds = rows.map((r) => r[dateIdx]).filter(Boolean).sort();
    console.log(`\nDate span: ${ds[0]} .. ${ds[ds.length - 1]}`);
  }
  console.log('\n(no rows printed and nothing saved — the file holds buyer names, addresses and VAT numbers)');
}

main().catch((e) => { console.error('FAILED:', e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
