/**
 * Asking FedEx where a parcel is, as pure logic.
 *
 * Tracking is the one FedEx capability we can use across the BACK CATALOGUE rather than only on
 * shipments this platform booked. The team has been recording FedEx tracking numbers by hand for a
 * long time — 172 of them, 70 in the last ninety days — and every one of those can be asked about
 * without having booked it through the API. That is unusual: rating needs an account, booking needs
 * an address, but tracking needs only the number.
 *
 * Two constraints from the handoff (§2.3) shape everything here:
 *
 *  - **There is no webhook.** FedEx's push product is sold to US accounts only and has no EU
 *    purchase path. Status has to be POLLED, which makes the cadence rules below part of the
 *    integration rather than a detail — a poller with no stopping conditions is a poller that
 *    hammers an endpoint forever for parcels delivered last spring.
 *  - **FedEx keeps tracking data for 90 days after delivery** and no longer. Past that a number
 *    returns nothing, permanently. So there is a point after which asking again cannot help, and
 *    knowing where it is means we stop rather than accumulate silent failures.
 */

/** Track by tracking number. There are sibling paths for reference and door tag; we use this one. */
export const TRACK_PATH = '/track/v1/trackingnumbers';

/** FedEx's own batch limit (handoff §6). Thirty numbers per call, 100,000 calls a day. */
export const TRACK_BATCH_LIMIT = 30;

/** How long FedEx retains a shipment's tracking history. After this, asking cannot succeed. */
export const TRACK_HISTORY_DAYS = 90;

/**
 * Straight refusals before a number is written off as not FedEx's.
 *
 * Tracking numbers here are typed by people, and the Shipments table holds Cyprus Post numbers in
 * the same column. A number FedEx does not recognise will never start being recognised, and polling
 * it four times a day forever is exactly the kind of waste nobody ever notices.
 */
export const TRACK_MAX_FAILURES = 5;

/** Trim, drop the blanks, and keep each number once — the same parcel twice wastes a slot of 30. */
export function normaliseTrackingNumbers(numbers: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of numbers) {
    const t = (n ?? '').trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** Split into calls of at most 30. Normalises first, so the chunks are of real distinct numbers. */
export function chunkTrackingNumbers(
  numbers: Array<string | null | undefined>,
  size = TRACK_BATCH_LIMIT,
): string[][] {
  const list = normaliseTrackingNumbers(numbers);
  const limit = Math.max(1, Math.min(size, TRACK_BATCH_LIMIT));
  const chunks: string[][] = [];
  for (let i = 0; i < list.length; i += limit) chunks.push(list.slice(i, i + limit));
  return chunks;
}

export function buildTrackRequest(numbers: string[]): {
  includeDetailedScans: boolean;
  trackingInfo: Array<{ trackingNumberInfo: { trackingNumber: string } }>;
} {
  return {
    /**
     * The full scan history, not just the latest status.
     *
     * Asked for deliberately: "in transit" on its own cannot answer the question people actually
     * bring to a tracking screen, which is where it has been and where it stalled. The scans cost
     * nothing extra — same call, same quota.
     */
    includeDetailedScans: true,
    trackingInfo: normaliseTrackingNumbers(numbers).map((trackingNumber) => ({
      trackingNumberInfo: { trackingNumber },
    })),
  };
}

function errorList(body: unknown): Array<{ code?: unknown; message?: unknown }> {
  const errors = (body as { errors?: unknown } | null)?.errors;
  return Array.isArray(errors) ? (errors as Array<{ code?: unknown; message?: unknown }>) : [];
}

/**
 * What a failed tracking call means.
 *
 * Note what is NOT here: a number FedEx does not know is not a failure of this kind. It comes back
 * inside a 200 with an error against that one result, which is why the parser deals with it and not
 * this function. What lands here is the whole call failing — credentials, quota, or FedEx being
 * down — and those are worth telling apart because only one of them is ours to fix.
 */
export function describeTrackFailure(status: number, body: unknown): string {
  const codes = errorList(body).map((e) => String(e?.code ?? '')).filter(Boolean);
  if (status === 401 || status === 403 || codes.includes('NOT.AUTHORIZED.ERROR')) {
    return [
      'FedEx refused this account for the Track API. The key and secret are not the problem — a token was issued with them moments before this call.',
      'Check in the FedEx portal that the project behind these credentials includes "Basic Integrated Visibility". It needs no approval, but it does need to be selected on the project.',
    ].join('\n');
  }
  if (status === 429) {
    return 'FedEx is rate-limiting tracking. The daily allowance is 100,000 calls, so this is either a burst or an organisation-wide cap — wait before retrying.';
  }
  if (status >= 500) return `FedEx returned ${status}. Their side, not our request — the next sweep will pick these up.`;
  const messages = errorList(body).map((e) => String(e?.message ?? '')).filter(Boolean);
  return messages.length ? messages.join(' · ') : `FedEx refused the tracking request (${status}).`;
}

/** What we already hold about one number, as the cadence rules need to see it. */
export interface TrackRefreshState {
  /** When the parcel left. The clock FedEx's 90-day retention runs on. */
  shipmentDate: Date;
  /** Set once it has arrived. Terminal: a delivered parcel does not become undelivered. */
  deliveredAt: Date | null;
  /** Last time we asked, successfully or not. Null means never. */
  checkedAt: Date | null;
  /** Consecutive refusals for this number specifically. */
  failureCount: number;
}

/**
 * Whether a number is worth asking about again.
 *
 * The rules, in the order they are applied, and each with a reason it exists rather than a number
 * somebody liked:
 *
 *  1. **Delivered is finished.** The one state FedEx will never revise.
 *  2. **Past 90 days from despatch, stop.** FedEx has dropped it; every further call is guaranteed
 *     to return nothing and would do so for as long as the row exists.
 *  3. **Five straight refusals, stop.** The number is not FedEx's — a Cyprus Post number in a FedEx
 *     row, or a typo. Neither improves with asking.
 *  4. **Never asked, ask now.**
 *  5. Otherwise: every six hours for the first fortnight, then daily.
 *
 * The fortnight boundary is where movement stops being newsworthy. An express parcel that has been
 * out for three weeks is not going to be resolved by finding out four hours sooner, and the point of
 * frequent polling is answering "where is it" while somebody still cares.
 */
export function dueForRefresh(state: TrackRefreshState, now: Date, opts: { force?: boolean } = {}): boolean {
  const ageDays = (now.getTime() - state.shipmentDate.getTime()) / 86_400_000;

  /**
   * The two stops that hold even when somebody presses the button.
   *
   * `force` means "never mind the schedule", not "never mind the facts". Past ninety days FedEx has
   * no history to give, and five straight refusals means the number is not theirs — asking anyway
   * would return TRACKING.TRACKINGNUMBER.NOTFOUND and write "not recognised" against a parcel whose
   * only problem is being old, which reads on screen as a data error somebody should go and fix.
   */
  if (ageDays > TRACK_HISTORY_DAYS) return false;
  if (state.failureCount >= TRACK_MAX_FAILURES) return false;

  if (opts.force) return true;

  if (state.deliveredAt) return false;
  if (!state.checkedAt) return true;

  const sinceCheckHours = (now.getTime() - state.checkedAt.getTime()) / 3_600_000;
  return sinceCheckHours >= (ageDays <= 14 ? 6 : 24);
}

/**
 * Whether a shipping service in our catalogue is FedEx.
 *
 * Matched on the name because the catalogue has no carrier code — it is a list of couriers our
 * people typed ("FedEx", "Cyprus Postal Service", "TNT"), not a mapping onto integrations. A regex
 * rather than an equality test so that splitting it into "FedEx Priority" and "FedEx Economy" later
 * does not silently stop every one of those shipments being tracked.
 *
 * This is the ONLY place the question is answered. The database query that gathers candidates
 * pre-filters on the same FEDEX_NAME_FRAGMENT — a cheap narrowing, not a second opinion — and this
 * function still decides. When the catalogue grows a carrier code, this is what changes.
 */
export const FEDEX_NAME_FRAGMENT = 'fedex';

export function isFedexService(name?: string | null, alias?: string | null): boolean {
  return new RegExp(FEDEX_NAME_FRAGMENT, 'i').test(`${name ?? ''} ${alias ?? ''}`);
}
