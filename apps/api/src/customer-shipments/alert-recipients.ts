/**
 * Who is emailed when a logistics customer files a shipment.
 *
 * The platform user named in settings, plus any addresses somebody has typed in beside them — a
 * shared ops mailbox, a colleague with no login, a forwarding alias. The named user is checked
 * against the staff table before anything is sent; these are not, and cannot be, which is the whole
 * reason they are validated carefully here.
 *
 * A shipment notification carries a customer's recipient, their address and what is in the boxes.
 * A typo in this list sends that to a stranger, quietly, every time a shipment is filed. So an
 * address that is not plainly an address is refused at the moment it is typed rather than accepted
 * and half-delivered later.
 *
 * PURE.
 */

/**
 * What counts as an address.
 *
 * Deliberately narrower than the specification allows: no quoted local parts, no bracketed literal
 * IP domains, no display names. Those are legal and nobody is going to type one into this box, and
 * every form accepted here is a form the header builder has to be safe against.
 */
const ADDRESS = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

/** At most this many. A list longer than this is a distribution group's job, not a settings field. */
export const MOST_RECIPIENTS = 10;

export interface RecipientReview {
  /** The addresses to store: trimmed, lowercased, in the order given, without repeats. */
  addresses: string[];
  /** What was wrong, in the words the person typing needs. Empty when nothing was. */
  problems: string[];
}

/**
 * Check and tidy a list of typed addresses.
 *
 * Blank entries are dropped rather than complained about: a trailing empty row is how a list
 * editor looks mid-edit, not a mistake.
 */
export function reviewRecipients(input: unknown): RecipientReview {
  const raw = Array.isArray(input) ? input : [];
  const addresses: string[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    const text = String(entry ?? '').trim();
    if (!text) continue;

    /**
     * A newline or a comma would end the header and start another.
     *
     * The message builder strips these too, and must keep doing so — but an address silently
     * shortened at the point of sending is a different address from the one on the settings screen,
     * and that discrepancy is exactly what nobody would think to look for.
     */
    if (/[\r\n,;<>]/.test(text)) {
      problems.push(`“${text}” is not one address — put each on its own line.`);
      continue;
    }

    const lower = text.toLowerCase();
    if (!ADDRESS.test(lower)) {
      problems.push(`“${text}” does not look like an email address.`);
      continue;
    }
    if (seen.has(lower)) continue;

    seen.add(lower);
    addresses.push(lower);
  }

  if (addresses.length > MOST_RECIPIENTS) {
    problems.push(`That is more than ${MOST_RECIPIENTS} addresses. Use a group address instead.`);
  }

  return { addresses, problems };
}

/**
 * The final list to send to, given the named user and the extra addresses.
 *
 * Deduplicated against each other, because the person named in settings is very often also the
 * first address somebody adds, and being told twice about one shipment teaches people to ignore
 * the mail.
 */
export function recipientsFor(namedUserEmail: string | null | undefined, extras: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const candidate of [namedUserEmail ?? '', ...extras]) {
    const lower = String(candidate ?? '').trim().toLowerCase();
    if (!lower || seen.has(lower)) continue;
    seen.add(lower);
    out.push(lower);
  }
  return out;
}
