// Match a vendor's rows to our products. PURE — the caller supplies the candidate index.
//
// Vendor codes equal our main SKU most of the time, but not always, so the file is matched down a
// chain of identifiers and anything the chain cannot settle is REPORTED rather than guessed. A
// wrong match writes a cost onto the wrong product, which is invisible until someone notices the
// margin: exactly the failure this whole feature has to avoid.

export type MatchedBy = 'alias' | 'mainSku' | 'ean' | 'vendorSku' | 'manufacturerSku';

export interface MatchCandidateIndex {
  /** vendorSku (lowercased) -> productId. An explicit human decision; outranks everything. */
  alias: Map<string, string>;
  /** mainSku (lowercased) -> productId. Unique in our catalogue. */
  mainSku: Map<string, string>;
  /** barcode (normalised) -> productIds. Covers both our EAN and UPC columns. */
  ean: Map<string, string[]>;
  /** our record of this vendor's own code -> productIds. */
  vendorSku: Map<string, string[]>;
  /** manufacturer part number -> productIds. Weakest: routinely shared across variants. */
  manufacturerSku: Map<string, string[]>;
}

export interface VendorRow {
  sku?: string | null;
  ean?: string | null;
  manufacturerSku?: string | null;
}

export interface RowMatch {
  index: number;
  productId: string | null;
  matchedBy: MatchedBy | null;
  /** Set when a step found several products; nothing is chosen and a human decides. */
  ambiguous?: { by: MatchedBy; productIds: string[] };
  /** Why no match, for the report: 'no-identifiers' | 'not-found'. */
  reason?: 'no-identifiers' | 'not-found';
}

/** Trim and lowercase for comparison. Vendor files are inconsistent about both. */
export const norm = (v: string | null | undefined): string => String(v ?? '').trim().toLowerCase();

/**
 * Normalise a barcode for comparison.
 *
 * A 12-digit UPC is the same article as the 13-digit EAN with a leading zero, and vendors quote
 * whichever their system holds. Compared zero-padded to 13 so the two forms meet.
 */
export function normBarcode(v: string | null | undefined): string {
  const digits = String(v ?? '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.length === 12 ? `0${digits}` : digits;
}

/** Build the lookup index from our catalogue. */
export function buildIndex(
  products: Array<{ id: string; mainSku: string; ean?: string | null; upc?: string | null; vendorSku?: string | null; manufacturerSku?: string | null }>,
  aliases: Array<{ vendorSku: string; productId: string }>,
): MatchCandidateIndex {
  const idx: MatchCandidateIndex = {
    alias: new Map(), mainSku: new Map(), ean: new Map(), vendorSku: new Map(), manufacturerSku: new Map(),
  };
  const push = (m: Map<string, string[]>, key: string, id: string) => {
    if (!key) return;
    const cur = m.get(key);
    if (cur) { if (!cur.includes(id)) cur.push(id); } else m.set(key, [id]);
  };

  for (const a of aliases) idx.alias.set(norm(a.vendorSku), a.productId);
  for (const p of products) {
    const main = norm(p.mainSku);
    if (main) idx.mainSku.set(main, p.id);
    push(idx.ean, normBarcode(p.ean), p.id);
    push(idx.ean, normBarcode(p.upc), p.id);
    push(idx.vendorSku, norm(p.vendorSku), p.id);
    push(idx.manufacturerSku, norm(p.manufacturerSku), p.id);
  }
  return idx;
}

/**
 * Match one row.
 *
 * Order is by how deliberate the identifier is, not by convenience: an alias is a human decision,
 * our main SKU is our own identity, a barcode identifies an article globally, and a manufacturer
 * part number is last because it is routinely shared across colours and pack sizes.
 *
 * An ambiguous hit STOPS the chain. Falling through to a weaker identifier to break a tie would
 * turn "we are not sure" into a confident wrong answer.
 */
export function matchRow(row: VendorRow, idx: MatchCandidateIndex, index = 0): RowMatch {
  const sku = norm(row.sku);
  const bc = normBarcode(row.ean);
  const mfr = norm(row.manufacturerSku);

  if (!sku && !bc && !mfr) return { index, productId: null, matchedBy: null, reason: 'no-identifiers' };

  const aliasHit = sku ? idx.alias.get(sku) : undefined;
  if (aliasHit) return { index, productId: aliasHit, matchedBy: 'alias' };

  const mainHit = sku ? idx.mainSku.get(sku) : undefined;
  if (mainHit) return { index, productId: mainHit, matchedBy: 'mainSku' };

  const steps: Array<{ by: MatchedBy; ids: string[] | undefined }> = [
    { by: 'ean', ids: bc ? idx.ean.get(bc) : undefined },
    { by: 'vendorSku', ids: sku ? idx.vendorSku.get(sku) : undefined },
    { by: 'manufacturerSku', ids: mfr ? idx.manufacturerSku.get(mfr) : undefined },
  ];
  for (const s of steps) {
    if (!s.ids?.length) continue;
    if (s.ids.length === 1) return { index, productId: s.ids[0], matchedBy: s.by };
    return { index, productId: null, matchedBy: null, ambiguous: { by: s.by, productIds: s.ids } };
  }

  return { index, productId: null, matchedBy: null, reason: 'not-found' };
}

export interface MatchSummary {
  total: number;
  matched: number;
  unmatched: number;
  ambiguous: number;
  byMethod: Record<MatchedBy, number>;
  /** Rows whose SKU appears more than once in the file — the vendor's own duplication. */
  duplicateSkus: string[];
}

/** Match every row and summarise. */
export function matchRows(rows: VendorRow[], idx: MatchCandidateIndex): { matches: RowMatch[]; summary: MatchSummary } {
  const matches = rows.map((r, i) => matchRow(r, idx, i));
  const byMethod: Record<MatchedBy, number> = { alias: 0, mainSku: 0, ean: 0, vendorSku: 0, manufacturerSku: 0 };
  for (const m of matches) if (m.matchedBy) byMethod[m.matchedBy] += 1;

  // A SKU listed twice in one file means two rows want to write the same product, usually with
  // different numbers. Surfaced rather than letting the last row silently win.
  const seen = new Map<string, number>();
  for (const r of rows) {
    const k = norm(r.sku);
    if (k) seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  const duplicateSkus = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);

  return {
    matches,
    summary: {
      total: rows.length,
      matched: matches.filter((m) => m.productId).length,
      unmatched: matches.filter((m) => !m.productId && !m.ambiguous).length,
      ambiguous: matches.filter((m) => m.ambiguous).length,
      byMethod,
      duplicateSkus,
    },
  };
}
