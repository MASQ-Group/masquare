import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { extractSheet, listSheets } from './workbook';
import { suggestMapping, capabilitiesOf } from './field-suggest';

const FILES = [
  ['26.4.25.xlsx', 'C:/Users/m.stylianou/Downloads/26.4.25.xlsx'],
  ['UPDATED STOCK 23.06.2026.xlsx', 'C:/Users/m.stylianou/Downloads/UPDATED STOCK 23.06.2026.xlsx'],
  ['Stock 23.06.2026 retail (1).xlsx', 'C:/Users/m.stylianou/Downloads/Stock 23.06.2026 retail (1).xlsx'],
] as const;

// Runs against the real price lists when they are on this machine, and skips otherwise: the
// files are commercial vendor data and are deliberately not committed. The structures they
// exercise are covered by fixtures in sheet-extract.spec.ts, which is the suite that must pass
// everywhere; this one is for eyeballing a real file end to end.
describe('real vendor files', () => {
  for (const [name, path] of FILES) {
    it.skipIf(!existsSync(path))(name, () => {
      const buf = readFileSync(path);
      console.log('\n' + '='.repeat(72) + '\n' + name);
      console.log('sheets:', listSheets(buf).map((s) => `${s.name} ref=${s.ref} originCol=${s.originCol}`).join(' | '));
      const t = extractSheet(buf);
      console.log(`headerRow=${t.headerRowIndex} dataRows=${t.rows.length} discarded=`, t.discarded);
      if (t.sectionLabels.length) console.log('sections (first 3):', t.sectionLabels.slice(0, 3));
      const sug = suggestMapping(t.columns);
      console.log('columns:');
      for (const c of t.columns) {
        console.log(`  ${c.letter.padEnd(3)} ord=${String(c.ordinal).padStart(2)} ${String(c.header).padEnd(20).slice(0,20)} ${c.kind.padEnd(8)} filled=${(c.filled*100).toFixed(0).padStart(3)}%  eg ${JSON.stringify(c.samples.slice(0,2))}`);
      }
      console.log('suggested:');
      for (const s of sug) {
        const col = s.columnIndex != null ? t.columns[s.columnIndex] : null;
        console.log(`  ${s.field.padEnd(16)} -> ${col ? `${col.letter} (ord ${col.ordinal}) "${col.header}"` : '—'}  conf=${s.confidence}  ${s.reason}`);
      }
      console.log('capabilities:', capabilitiesOf(sug));
      expect(t.rows.length).toBeGreaterThan(0);
    });
  }
});
