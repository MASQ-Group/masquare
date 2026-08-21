import * as XLSX from 'xlsx';
import { ExtractedTable, extractTable } from './sheet-extract';

// Reading the workbook is the only part of extraction that touches a library, kept separate so
// the table logic stays pure and testable without fixture files.

export interface SheetSummary {
  name: string;
  ref: string | null;
  /** 0-based index of the sheet's first used column. B1:I346 -> 1. */
  originCol: number;
  originRow: number;
  rowCount: number;
}

/** The sheets in a .csv/.xls/.xlsx, so a multi-sheet vendor file can be chosen from. */
export function listSheets(buf: Buffer): SheetSummary[] {
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const ref = (ws['!ref'] as string | undefined) ?? null;
    const origin = ref ? XLSX.utils.decode_range(ref).s : { c: 0, r: 0 };
    const rows = ref ? XLSX.utils.decode_range(ref).e.r - origin.r + 1 : 0;
    return { name, ref, originCol: origin.c, originRow: origin.r, rowCount: rows };
  });
}

/**
 * Extract one sheet into a mappable table.
 *
 * `sheet_to_json` re-bases a sheet whose used range starts at B to index 0, which silently shifts
 * every column by one and makes our letters disagree with the ones the user sees. The origin is
 * read from `!ref` and passed through so letters stay true.
 */
export function extractSheet(buf: Buffer, sheetName?: string): ExtractedTable & { sheet: string } {
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
  const name = sheetName && wb.SheetNames.includes(sheetName) ? sheetName : wb.SheetNames[0];
  const ws = wb.Sheets[name];
  if (!ws) throw new Error(`Sheet "${sheetName ?? ''}" not found in this file`);
  const ref = (ws['!ref'] as string | undefined) ?? null;
  const origin = ref ? XLSX.utils.decode_range(ref).s : { c: 0, r: 0 };
  // blankrows keeps the grid faithful: dropping them here would hide the preamble count and
  // shift the header row index the user is shown.
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: true, defval: null, raw: true });
  return { ...extractTable(grid, origin.c, origin.r), sheet: name };
}
