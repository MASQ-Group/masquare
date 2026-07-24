// Canonical columns for the expenses import sheet. `key` is what the API reads; `label` is
// the sheet header; `sample` seeds the downloadable template.
export interface ExpenseImportColumn { key: string; label: string; sample: string }

export const EXPENSE_IMPORT_COLUMNS: ExpenseImportColumn[] = [
  { key: 'name', label: 'Expense name', sample: 'Office rent' },
  { key: 'category', label: 'Category', sample: 'Premises' },
  { key: 'type', label: 'Type', sample: 'Monthly' },
  { key: 'amount', label: 'Amount', sample: '1200' },
  { key: 'currency', label: 'Currency', sample: 'EUR' },
  { key: 'date', label: 'Date (DD/MM/YYYY)', sample: '01/07/2026' },
  { key: 'note', label: 'Note', sample: 'Landlord ACME Ltd' },
  { key: 'tag', label: 'Tag', sample: '' },
];

/** Two template rows: a recurring and a once-off example, so the format is self-explanatory.
 *  Dates are DD/MM/YYYY; for recurring types only the month matters (the start month). */
export const EXPENSE_IMPORT_SAMPLE_ROWS: string[][] = [
  ['Office rent', 'Premises', 'Monthly', '1200', 'EUR', '01/07/2026', 'Landlord ACME Ltd', ''],
  ['Company laptop', 'Equipment', 'Once-off', '1450', 'EUR', '14/07/2026', 'MacBook Pro', ''],
];

/** Map arbitrary sheet headers to known column keys (case-insensitive, by label or key). */
export function mapExpenseHeaders(headers: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const h of headers) {
    const lower = h.trim().toLowerCase();
    const col = EXPENSE_IMPORT_COLUMNS.find(
      (c) => c.label.toLowerCase() === lower || c.key.toLowerCase() === lower
        // tolerate a couple of common header variants
        || (c.key === 'name' && ['expense', 'name'].includes(lower))
        || (c.key === 'date' && ['start month', 'month', 'start'].includes(lower)),
    );
    if (col) map[h] = col.key;
  }
  return map;
}
