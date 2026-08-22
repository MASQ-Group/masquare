import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The SKU table had ten headers and nine cells, so every column after Floor was showing the wrong
// field: the floors-computed timestamp sat under "Current", the exclusion reason under "Computed",
// and "Reason" was permanently blank. It read as missing data rather than a misaligned table,
// which is the expensive kind of display bug — it sends you looking for a pipeline fault.
const PAGE = join(__dirname, '../../../../../apps/web/src/pages/RepricingPage.tsx');

function countRow(src: string, startMarker: string, openTag: string, endMarker: string): number {
  const from = src.indexOf(startMarker);
  const to = src.indexOf(endMarker, from);
  return src.slice(from, to).split(openTag).length - 1;
}

describe('SKU pricing table', () => {
  const src = readFileSync(PAGE, 'utf8');

  it('has one cell per header', () => {
    // Bounded to the SKU table's own thead/tbody, which begin at its distinctive Breakeven header.
    const theadStart = src.indexOf('<th className="px-4 py-2 font-semibold">SKU</th>');
    const theadEnd = src.indexOf('</thead>', theadStart);
    const headers = src.slice(theadStart, theadEnd).split('<th ').length - 1;

    const tbodyEnd = src.indexOf('</tr>', src.indexOf('{r.exclusionReason', theadEnd));
    const rowStart = src.lastIndexOf('<tr', src.indexOf('{r.exclusionReason', theadEnd));
    const cells = src.slice(rowStart, tbodyEnd).split('<td ').length - 1;

    expect(cells).toBe(headers);
  });

  it('shows the current price, which the row already carries', () => {
    expect(src).toContain('{money(r.currentPriceCents, r.currency)}');
  });
});
