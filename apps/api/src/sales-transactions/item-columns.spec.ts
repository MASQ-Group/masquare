import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every field on the item DTO must either BE a column on the item row, or be deliberately stripped
 * before the row is written.
 *
 * Both write paths — `create` and `update` — spread the DTO line straight into Prisma. A field that
 * is neither a column nor stripped is handed over as an unknown argument, Prisma rejects the whole
 * insert, and the order fails to save. In the importer that failure is caught per order and counted,
 * so the only trace is an "N errors" chip with no reason attached to it anywhere.
 *
 * That is exactly what happened to `channelReportedTaxCollection`: added to the DTO so the channel
 * could report who collected the tax, never added to the strip, and from then until it was found
 * every Amazon and eBay sync failed every order that carried one.
 *
 * This reads the three sources rather than restating them, so it cannot drift out of date.
 */
const here = join(__dirname);
const read = (p: string) => readFileSync(join(here, p), 'utf8');

/** Field names declared on SalesTransactionItemDto. */
function dtoFields(): string[] {
  const src = read('dto/sales-transaction.dto.ts');
  const body = /export class SalesTransactionItemDto \{([\s\S]*?)\n\}/.exec(src)?.[1] ?? '';
  return [...body.matchAll(/^\s*(?:@[\w]+\([^)]*\)\s*)*([a-zA-Z_]\w*)[?!]?:/gm)].map((m) => m[1]);
}

/** Column (and relation) names on the SalesTransactionItem model. */
function itemColumns(): string[] {
  const src = readFileSync(join(here, '../../prisma/schema.prisma'), 'utf8');
  const body = /model SalesTransactionItem \{([\s\S]*?)\n\}/.exec(src)?.[1] ?? '';
  return body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('/') && !l.startsWith('*') && !l.startsWith('@@'))
    .map((l) => l.split(/\s+/)[0]);
}

/** Names destructured away in `linkItemsToCatalogue` before the row is built. */
function strippedFields(): string[] {
  const src = read('sales-transactions.service.ts');
  const block = /const \{([^}]*?)\.\.\.rest \} =\s*i as T &/.exec(src)?.[1] ?? '';
  return [...block.matchAll(/([a-zA-Z_]\w*)\s*:/g)].map((m) => m[1]);
}

describe('sales transaction item DTO against the item row', () => {
  it('finds all three sources', () => {
    expect(dtoFields().length).toBeGreaterThan(5);
    expect(itemColumns().length).toBeGreaterThan(10);
    expect(strippedFields().length).toBeGreaterThan(0);
  });

  it('leaves no DTO field that is neither a column nor stripped', () => {
    const columns = new Set(itemColumns());
    const stripped = new Set(strippedFields());
    const leaking = dtoFields().filter((f) => !columns.has(f) && !stripped.has(f));
    expect(leaking, `these would reach Prisma as unknown columns: ${leaking.join(', ')}`).toEqual([]);
  });

  /** The two known non-columns, named so a careless strip-removal is caught too. */
  it('strips the fields that belong elsewhere', () => {
    const stripped = strippedFields();
    expect(stripped).toContain('serials');
    expect(stripped).toContain('channelReportedTaxCollection');
  });

  /** Both are real DTO fields — the test above would pass vacuously if either were renamed away. */
  it('is testing fields that actually exist on the DTO', () => {
    const fields = dtoFields();
    expect(fields).toContain('serials');
    expect(fields).toContain('channelReportedTaxCollection');
  });
});
