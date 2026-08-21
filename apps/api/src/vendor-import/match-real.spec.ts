import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { extractSheet } from './workbook';
import { suggestMapping } from './field-suggest';
import { buildIndex, matchRows, norm } from './matcher';

// End-to-end against a real price list AND the real catalogue — a local diagnostic, not a test
// of the code. It needs both the vendor file and a reachable database, neither of which exists
// on a clean checkout, so it skips unless both are present rather than failing the suite.
const FILE = 'C:/Users/m.stylianou/Downloads/UPDATED STOCK 23.06.2026.xlsx';
const RUNNABLE = existsSync(FILE) && !!process.env.DATABASE_URL;

describe('matching a real file against the catalogue', () => {
  it.skipIf(!RUNNABLE)('reports how much is recognised', async () => {
    const prisma = new PrismaClient();
    try {
      const t = extractSheet(readFileSync(FILE));
      const sug = suggestMapping(t.columns);
      const col = (f: string) => sug.find((s) => s.field === f)?.columnIndex ?? -1;
      const rows = t.rows.map((r) => ({
        sku: col('sku') >= 0 ? r[col('sku')] : '',
        ean: col('ean') >= 0 ? r[col('ean')] : '',
        manufacturerSku: col('manufacturerSku') >= 0 ? r[col('manufacturerSku')] : '',
      }));

      const skus = [...new Set(rows.map((r) => norm(r.sku)).filter(Boolean))];
      const eans = [...new Set(rows.map((r) => String(r.ean ?? '').replace(/\D/g, '')).filter(Boolean))];
      const mfrs = [...new Set(rows.map((r) => norm(r.manufacturerSku)).filter(Boolean))];

      const products = await prisma.product.findMany({
        where: {
          deletedAt: null,
          OR: [
            { mainSku: { in: skus, mode: 'insensitive' } },
            { vendorSku: { in: skus, mode: 'insensitive' } },
            { ean: { in: eans } }, { upc: { in: eans } },
            { manufacturerSku: { in: mfrs, mode: 'insensitive' } },
          ],
        },
        select: { id: true, mainSku: true, ean: true, upc: true, vendorSku: true, manufacturerSku: true },
      });

      const { summary, matches } = matchRows(rows, buildIndex(products, []));
      console.log('\nrows:', summary.total, '| matched:', summary.matched, '| unmatched:', summary.unmatched, '| ambiguous:', summary.ambiguous);
      console.log('by method:', summary.byMethod);
      if (summary.duplicateSkus.length) console.log('duplicate SKUs in file:', summary.duplicateSkus.slice(0, 5));
      const misses = matches.filter((m) => !m.productId && !m.ambiguous).slice(0, 8);
      console.log('first unmatched vendor codes:', misses.map((m) => rows[m.index].sku));
      expect(summary.total).toBeGreaterThan(0);
    } finally {
      await prisma.$disconnect();
    }
  });
});
