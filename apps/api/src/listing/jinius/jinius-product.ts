/**
 * Creating a product in Jinius's own catalogue, so an offer can carry OUR description.
 *
 * The offer flow already built attaches to a product Jinius already holds, and the buyer then reads
 * THEIR page — which is fine when their entry is good and useless when it is thin, wrong, or absent.
 * Mirakl's answer is a product import: the seller supplies the catalogue entry, the operator accepts
 * it, and offers then hang off something we wrote.
 *
 * WHAT IS KNOWN, from asking Jinius rather than from the documentation:
 *   - imports are permitted for this shop (the probe read P51 and got 200, not the 403 many
 *     operators answer with);
 *   - a real category demands Category, Shop sku, Name, Product mainImage url and Description, out
 *     of 48 attributes in all;
 *   - attribute CODES come from PM11 per category, and those codes are the columns.
 *
 * WHAT IS ASSUMED, and stated here so the first failure is quick to read: Mirakl takes the import as
 * a FILE, and the file is delimited text whose header row is the attribute codes. The delimiter is
 * an operator's choice — semicolon is Mirakl's usual default — so it is a setting rather than a
 * constant, and a wrong guess is a settings change instead of a deployment.
 *
 * PURE.
 */

/** One product to create, as the columns Jinius asked for. */
export interface JiniusProductInput {
  /** Our SKU. It is the product's identity in their catalogue and the offer's key afterwards. */
  shopSku: string | null;
  categoryCode: string | null;
  /** Answers by attribute CODE, not by label: the codes are the columns. */
  values: Record<string, string>;
}

/** One attribute, as PM11 describes it. */
export interface JiniusAttributeNeed {
  code: string;
  label: string;
  required: boolean;
}

/**
 * What stops this being sent, named by what a person would have to go and do.
 *
 * By LABEL rather than by code: "Product mainImage url" is a thing somebody can act on, `PMIU_03`
 * is a thing somebody has to go and look up first.
 */
export function missingForJiniusProduct(needs: readonly JiniusAttributeNeed[], input: JiniusProductInput): string[] {
  const out: string[] = [];
  if (!(input.shopSku ?? '').trim()) out.push('No SKU to create the product under.');
  if (!(input.categoryCode ?? '').trim()) out.push('No Jinius category chosen — it decides which attributes exist.');
  for (const need of needs) {
    if (!need.required) continue;
    if ((input.values[need.code] ?? '').trim()) continue;
    out.push(`${need.label} is required by this category and nothing answers it.`);
  }
  return out;
}

/**
 * One field of delimited text, quoted only where it has to be.
 *
 * A description carries commas, quotes and newlines as a matter of course, and any of the three
 * silently turns one row into two or one column into several. Quoting when in doubt costs nothing;
 * not quoting costs a catalogue entry that reads as gibberish.
 */
function field(value: string, delimiter: string): string {
  const s = String(value ?? '');
  if (!s.includes(delimiter) && !s.includes('"') && !/[\r\n]/.test(s)) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * The import file: a header of attribute codes, and one row.
 *
 * Only the columns we can answer are sent. An empty column is not the same as an absent one — some
 * operators read a blank as "clear this" — and a product import that silently blanks fields would be
 * worse than one that omits them.
 */
export function jiniusProductCsv(input: JiniusProductInput, delimiter = ';'): string {
  const codes = Object.keys(input.values).filter((c) => (input.values[c] ?? '').trim());
  const header = codes.map((c) => field(c, delimiter)).join(delimiter);
  const row = codes.map((c) => field(input.values[c], delimiter)).join(delimiter);
  return `${header}\r\n${row}\r\n`;
}

/** Mirakl answers an import with the id of the job it queued, not with the result. */
export function readJiniusProductImportId(json: unknown): number | null {
  const body = json && typeof json === 'object' ? (json as Record<string, any>) : null;
  const raw = body?.import_id ?? body?.importId ?? null;
  return raw != null && Number.isFinite(Number(raw)) ? Number(raw) : null;
}

/** How a product import ended, as Mirakl reports it while it runs and once it is done. */
export interface JiniusProductImportReport {
  status: string;
  done: boolean;
  /** Products Mirakl took, rejected, and is still thinking about. */
  integrated: number | null;
  rejected: number | null;
  pending: number | null;
  /** Whether Mirakl has an error report to fetch, which is where the real reason lives. */
  hasErrorReport: boolean;
}

const FINISHED = ['COMPLETE', 'FAILED', 'CANCELLED', 'CANCELED'];

export function readJiniusProductImportReport(json: unknown): JiniusProductImportReport {
  const body = json && typeof json === 'object' ? (json as Record<string, any>) : null;
  const o = body?.import_status != null || body?.status != null ? body! : (body?.imports?.[0] ?? body ?? {});
  const num = (v: unknown) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);
  const status = String(o?.import_status ?? o?.status ?? '').toUpperCase();
  return {
    status: status || 'UNKNOWN',
    done: FINISHED.includes(status),
    integrated: num(o?.products_integrated ?? o?.lines_in_success),
    rejected: num(o?.products_rejected ?? o?.lines_in_error),
    pending: num(o?.products_pending),
    hasErrorReport: o?.has_error_report === true || (num(o?.products_rejected ?? o?.lines_in_error) ?? 0) > 0,
  };
}

/**
 * What one import came to, in the words the person who pressed the button needs.
 *
 * "Queued" is a poor answer to "did it work", so a finished import says what happened to the
 * product; an unfinished one says it is still with them rather than claiming success. A rejection
 * points at the error report, because Mirakl's reason for refusing is the only thing worth reading.
 */
export function readJiniusProductOutcome(
  status: number,
  importId: number | null,
  report: JiniusProductImportReport | null,
): { ok: boolean; message: string } {
  if (status === 401 || status === 403) {
    return { ok: false, message: `Jinius refused the product import (${status}). This shop may not add products to the catalogue.` };
  }
  if (status >= 400) return { ok: false, message: `Jinius answered ${status} to the product import.` };
  if (importId == null) return { ok: false, message: 'Jinius accepted the file but returned no import id, so there is nothing to follow it by.' };
  if (!report || !report.done) {
    return { ok: true, message: `Sent to Jinius as import ${importId} — still being processed there. Check it again in a minute.` };
  }
  if (report.rejected) {
    return { ok: false, message: `Jinius rejected the product (import ${importId}, ${report.status}). Its error report says why.` };
  }
  if (report.integrated) return { ok: true, message: `Jinius accepted the product (import ${importId}).` };
  return { ok: false, message: `Import ${importId} finished as ${report.status} with nothing integrated and nothing rejected.` };
}
