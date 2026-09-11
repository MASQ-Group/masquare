/**
 * Turn whatever an order import threw into one line a person can act on.
 *
 * This exists because of what the importer used to do with it: nothing. A failure was caught per
 * order, counted, and written to the log; the interface could only ever say "6 errors". A defect
 * that failed every Amazon and eBay order carrying a particular field ran for a day in plain sight
 * because the reason was not anywhere a person would look.
 *
 * The hard case is Prisma. Its errors are long, and the sentence that matters is at the END, after
 * a dump of the whole rejected payload:
 *
 *     Invalid `prisma.salesTransactionItem.createMany()` invocation:
 *     { data: [ { sku: "RE-MB3000", …forty more lines… } ] }
 *     Unknown argument `channelReportedTaxCollection`. Available options are marked with ?.
 *
 * Taking the first line gives "Invalid invocation", which says only that something went wrong.
 * Taking the last gives the name of the field — which is the whole answer.
 */

/** Longest reason we will store or show. Long enough for a Prisma diagnosis, short enough for a row. */
const MAX = 300;

/** Lines that are payload, punctuation or noise rather than a statement about what went wrong. */
function isNoise(line: string): boolean {
  if (!line) return true;
  // A dump of the rejected data: object/array punctuation, or a `key: value` property line.
  if (/^[{}\[\],]+$/.test(line)) return true;
  if (/^[a-zA-Z_$][\w$]*:\s/.test(line)) return true;
  if (/^(data|where|select|include|create|update):/.test(line)) return true;
  // Prisma's column legend and its trailing hints.
  if (/^[?+~-]\s/.test(line)) return true;
  return false;
}

/**
 * The one line worth keeping.
 *
 * @param e whatever was thrown — an Error, a Prisma error, a Nest exception, or anything at all.
 */
export function syncFailureReason(e: unknown): string {
  const raw = typeof e === 'string' ? e : ((e as any)?.message ?? '');
  const lines = String(raw).split('\n').map((l) => l.trim()).filter((l) => !isNoise(l));

  if (lines.length === 0) {
    /**
     * Never an empty string. An empty reason reads as "no reason given", which is what sent me
     * looking in the wrong place once already — the error had simply rendered as blank.
     */
    const name = (e as any)?.name || (e as any)?.constructor?.name;
    return name ? `${name} (no message given)` : 'Failed with no message.';
  }

  // Prisma states the diagnosis last, after the payload; everything else states it first.
  const isPrisma = /^Invalid `prisma\./.test(lines[0]) || (e as any)?.name?.startsWith?.('PrismaClient');
  const chosen = isPrisma ? lines[lines.length - 1] : lines[0];

  // A Prisma message whose only line is the invocation header says nothing on its own; keep the
  // header too so the reader at least knows which write failed.
  const reason = isPrisma && lines.length > 1 && chosen !== lines[0]
    ? `${chosen} (${lines[0].replace(/^Invalid `prisma\.([^`]+)` invocation:?$/, '$1')})`
    : chosen;

  return reason.length > MAX ? `${reason.slice(0, MAX - 1)}…` : reason;
}
