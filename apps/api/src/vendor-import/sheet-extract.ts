import { ValueKind, columnKind } from './value-kind';

// Turn a vendor spreadsheet into a table we can map, and be explicit about everything discarded.
//
// PURE: takes a grid and its origin, does no I/O. The five sample price lists between them break
// every assumption our own export/import makes, and each trap here silently corrupts a mapping
// rather than failing:
//
//   • the header is not always row 1 (title rows, blank rows above it);
//   • the used range does not always start at column A — one file is B1:I346, and re-basing it to
//     zero shifts every column by one, so the letters a user sees stop matching ours;
//   • columns are interleaved with empty ones (J, K, L, P, S, V in a 24-column file);
//   • category separators sit among the data as rows with a single populated cell
//     ("COFFEE GRINDERS") — 46 of 346 rows in one file — and must not become products;
//   • headers repeat or are blank.

export interface DetectedColumn {
  /** Position within the extracted grid, 0-based. */
  index: number;
  /** True spreadsheet letter, offset by the sheet's origin — what the user sees in Excel. */
  letter: string;
  /** Position among columns that carry data, 1-based. How a person counts columns by eye. */
  ordinal: number;
  header: string;
  /** Up to five real values, so a mapping is confirmed against data rather than a column number. */
  samples: string[];
  /** Share of data rows where this column has a value, 0..1. */
  filled: number;
  kind: ValueKind;
}

export interface ExtractedTable {
  headerRowIndex: number;
  columns: DetectedColumn[];
  /** Data rows, aligned to `columns` by index. */
  rows: string[][];
  discarded: { preamble: number; blank: number; sectionHeaders: number };
  /** Section labels found among the rows, e.g. "COFFEE GRINDERS". Kept for the preview. */
  sectionLabels: string[];
}

const cell = (v: unknown): string => {
  if (v == null) return '';
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  return String(v).trim();
};

/** Excel column letter for a 0-based index: 0 -> A, 26 -> AA. */
export function columnLetter(index: number): string {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/**
 * Which row is the header.
 *
 * Scored, not assumed: a header row is mostly non-empty text, and the rows beneath it carry
 * markedly more numbers than it does. Picking row 0 blindly turns a title row ("AIR TREATMENT
 * PRICELIST 2026") into the column names and every real header into a product.
 */
export function findHeaderRow(grid: unknown[][], scanRows = 25): number {
  let bestRow = 0;
  let bestScore = -Infinity;
  const limit = Math.min(grid.length, scanRows);

  for (let r = 0; r < limit; r++) {
    const cells = (grid[r] ?? []).map(cell);
    const filled = cells.filter((c) => c !== '');
    if (filled.length < 2) continue; // a title or a section label, not a header

    const textish = filled.filter((c) => columnKind([c]) === 'text' || columnKind([c]) === 'sku').length;
    // How numeric the following rows are: a header sits above data, not above more headings.
    const below = grid.slice(r + 1, r + 6).map((row) => (row ?? []).map(cell));
    const belowValues = below.flat().filter((c) => c !== '');
    const belowNumeric = belowValues.filter((c) => {
      const k = columnKind([c]);
      return k === 'money' || k === 'integer' || k === 'ean';
    }).length;
    const belowNumericShare = belowValues.length ? belowNumeric / belowValues.length : 0;

    // Width matters — the header is usually the widest row near the top — and an early row wins
    // ties, so a repeated header further down does not displace the real one.
    const score = filled.length * 2 + textish + belowNumericShare * 10 - r * 0.5;
    if (score > bestScore) { bestScore = score; bestRow = r; }
  }
  return bestRow;
}

/**
 * Extract the mappable table.
 *
 * `originCol` is the 0-based index of the sheet's first used column, so letters stay true when the
 * data starts at B. Columns that are entirely empty are dropped from the mapping surface but still
 * counted when working out letters — a user pointing at "column Q" must land on Q.
 */
export function extractTable(grid: unknown[][], originCol = 0, originRow = 0): ExtractedTable {
  const headerRowIndex = findHeaderRow(grid);
  const headerCells = (grid[headerRowIndex] ?? []).map(cell);
  const body = grid.slice(headerRowIndex + 1);

  const width = Math.max(headerCells.length, ...body.map((r) => (r ?? []).length), 0);

  // Separate real data rows from separators and blanks before profiling the columns, so a
  // section label does not pollute a column's samples or its detected kind.
  const dataRows: string[][] = [];
  const sectionLabels: string[] = [];
  let blank = 0;
  for (const raw of body) {
    const row: string[] = [];
    for (let c = 0; c < width; c++) row.push(cell((raw ?? [])[c]));
    const filled = row.filter((v) => v !== '').length;
    if (filled === 0) { blank += 1; continue; }
    if (filled === 1) {
      // One populated cell among many columns is a category separator, not a product.
      sectionLabels.push(row.find((v) => v !== '') ?? '');
      continue;
    }
    dataRows.push(row);
  }

  const columns: DetectedColumn[] = [];
  let ordinal = 0;
  for (let c = 0; c < width; c++) {
    const values = dataRows.map((r) => r[c] ?? '');
    const nonEmpty = values.filter((v) => v !== '');
    const header = headerCells[c] ?? '';
    // A column with no header AND no data is structural padding — keep it out of the mapping UI.
    if (header === '' && nonEmpty.length === 0) continue;
    ordinal += 1;
    columns.push({
      index: c,
      letter: columnLetter(originCol + c),
      ordinal,
      header,
      samples: nonEmpty.slice(0, 5),
      filled: dataRows.length ? nonEmpty.length / dataRows.length : 0,
      kind: columnKind(values),
    });
  }

  // Rows are returned aligned to the surviving columns, so index N of a row is column N.
  const keep = columns.map((c) => c.index);
  return {
    headerRowIndex: originRow + headerRowIndex,
    columns,
    rows: dataRows.map((r) => keep.map((i) => r[i] ?? '')),
    discarded: { preamble: headerRowIndex, blank, sectionHeaders: sectionLabels.length },
    sectionLabels: [...new Set(sectionLabels)],
  };
}
