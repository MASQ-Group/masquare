// Template workbooks with real dropdowns.
//
// downloadSheet uses SheetJS, which cannot write data validation — dropdowns are a paid feature
// there and the community build drops them silently, producing a file that looks right and
// validates nothing. ExcelJS writes them properly, so templates use it while everything else keeps
// SheetJS. Both are loaded on demand; neither is in the main bundle.

type Cell = string | number | null | undefined;

/** A column whose values must come from a list rather than from typing. */
export interface TemplateList {
  /** 0-based column index in the sheet. */
  column: number;
  /** The permitted values, in the order they should appear. */
  values: string[];
}

export interface TemplateOptions {
  /** Header row. */
  headers: string[];
  /**
   * Rows written under the header — an illustrative sample in a blank template, or the exported
   * products themselves when a filled file is downloaded to edit.
   *
   * Either way the validation covers them. An exported row is the one most likely to be edited,
   * so leaving it as free text would put the dropdowns everywhere except where the work happens.
   */
  sampleRows?: Cell[][];
  /** Columns that get a dropdown. */
  lists?: TemplateList[];
  /** Sheet name. Excel forbids : \ / ? * [ ] and caps it at 31 characters. */
  sheetName?: string;
  /** How many rows below the samples to arm with validation. */
  validationRows?: number;
}

/**
 * Which sheet rows get the dropdown, 1-based, header excluded.
 *
 * Starts at row 2 so rows ALREADY in the sheet are armed, not just the blank ones beneath them.
 * A file exported to be edited is nothing but pre-filled rows; validating only below them would
 * put the dropdowns everywhere except where the editing happens — which was the bug this fixes.
 *
 * Excel validates on entry, never retroactively, so arming a filled cell does not reject what is
 * already in it. It only has to satisfy the list once someone changes it.
 */
export function validationRange(sampleRowCount: number, validationRows = 500): { first: number; last: number } {
  return { first: 2, last: 1 + sampleRowCount + validationRows };
}

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

/** A1, B1 … Z1, AA1 … — Excel's column letters, which are base-26 with no zero. */
export function columnLetter(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/**
 * Build a template workbook and download it.
 *
 * Permitted values live on a separate hidden sheet and the dropdown points at that range, rather
 * than being inlined into the validation formula. Excel caps an inline list at 255 characters —
 * about a dozen sales channels — and silently drops the validation when it overflows, which is the
 * worst kind of failure: the file opens, the column looks ordinary, and free text is accepted
 * again. A range has no such limit.
 */
export async function downloadTemplate(
  baseName: string,
  opts: TemplateOptions,
): Promise<{ emptyLists: string[] }> {
  const ExcelJS = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet((opts.sheetName ?? 'Template').slice(0, 31));

  ws.addRow(opts.headers);
  ws.getRow(1).font = { bold: true };
  for (const row of opts.sampleRows ?? []) ws.addRow(row as any[]);

  // Header widths, so a column of long channel names is readable without dragging anything.
  opts.headers.forEach((h, i) => {
    const longestSample = Math.max(0, ...(opts.sampleRows ?? []).map((r) => String(r[i] ?? '').length));
    ws.getColumn(i + 1).width = Math.min(40, Math.max(12, h.length + 2, longestSample + 2));
  });

  const empty: string[] = [];
  const lists = opts.lists ?? [];
  if (lists.length > 0) {
    const listSheet = wb.addWorksheet('Lists');
    // Hidden, not deleted: the dropdown references it, so it has to remain in the file. Excel is
    // content for a validation source to live on a hidden sheet.
    listSheet.state = 'veryHidden';

    const { first: firstDataRow, last: lastDataRow } = validationRange(opts.sampleRows?.length ?? 0, opts.validationRows);

    lists.forEach((list, li) => {
      const col = li + 1;
      listSheet.getCell(1, col).value = opts.headers[list.column] ?? `List ${col}`;
      list.values.forEach((v, ri) => { listSheet.getCell(ri + 2, col).value = v; });

      if (list.values.length === 0) {
        // Nothing to choose from, so the column stays free text — but say so. A template that
        // quietly drops a dropdown looks identical to one that never had it, and the person filling
        // it in has no way to tell that the column they were told to pick from now accepts anything.
        empty.push(opts.headers[list.column] ?? columnLetter(list.column));
        return;
      }
      const letter = columnLetter(li);
      const source = `Lists!$${letter}$2:$${letter}$${list.values.length + 1}`;
      const target = columnLetter(list.column);

      for (let r = firstDataRow; r <= lastDataRow; r++) {
        ws.getCell(`${target}${r}`).dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: [source],
          // showErrorMessage refuses anything off the list. A warning would let a typo through,
          // which is the whole reason for doing this.
          showErrorMessage: true,
          errorStyle: 'stop',
          errorTitle: 'Pick from the list',
          error: 'This column only accepts one of the listed values. Use the dropdown arrow in the cell.',
        };
      }
    });
  }

  const buf = await wb.xlsx.writeBuffer();
  triggerDownload(new Blob([buf], { type: 'application/octet-stream' }), `${baseName}.xlsx`);
  return { emptyLists: empty };
}
