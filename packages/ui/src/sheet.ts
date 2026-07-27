// xlsx (SheetJS) is ~400KB. It's only needed when the user actually exports or
// imports a sheet, so we load it on demand instead of in the main bundle.
type Cell = string | number | null | undefined;

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Build a .csv or .xlsx from an array-of-arrays and download it. */
export async function downloadSheet(baseName: string, aoa: Cell[][], format: 'csv' | 'xlsx' = 'xlsx') {
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  if (format === 'csv') {
    const csv = XLSX.utils.sheet_to_csv(ws);
    triggerDownload(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${baseName}.csv`);
  } else {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Products');
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    triggerDownload(new Blob([out], { type: 'application/octet-stream' }), `${baseName}.xlsx`);
  }
}

/** Parse a .csv/.xls/.xlsx file into its header columns and row objects keyed by header. */
export async function parseSheetFile(
  file: File,
): Promise<{ columns: string[]; rows: Record<string, string>[] }> {
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  // cellDates parses date-formatted cells as JS Dates (not raw Excel serial numbers),
  // so a "Ship date" column comes through as a real date instead of e.g. 46028.
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, blankrows: false });
  const columns = (grid[0] ?? []).map((c) => String(c ?? '').trim());
  const cell = (v: unknown): string => {
    if (v == null) return '';
    if (v instanceof Date) return isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10); // YYYY-MM-DD
    return String(v).trim();
  };
  const rows = grid.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    columns.forEach((c, i) => (obj[c] = cell((r as any[])[i])));
    return obj;
  });
  return { columns, rows };
}
