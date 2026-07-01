import * as XLSX from 'xlsx';

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
export function downloadSheet(baseName: string, aoa: Cell[][], format: 'csv' | 'xlsx' = 'xlsx') {
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
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, blankrows: false });
  const columns = (grid[0] ?? []).map((c) => String(c ?? '').trim());
  const rows = grid.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    columns.forEach((c, i) => (obj[c] = String((r as any[])[i] ?? '').trim()));
    return obj;
  });
  return { columns, rows };
}
