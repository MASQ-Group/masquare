/**
 * Does a channel still advertise a quantity we no longer hold?
 *
 * This is the check that settles "did the sync happen", and it is deliberately independent of the
 * push log. A push row can be absent because the attempt was never made, and it can be present and
 * successful while our record of the listing was never updated. Comparing the two numbers catches
 * both cases and requires neither to be trustworthy.
 *
 * What `listed` actually is, which took a look at the sync to establish: the quantity the
 * MARKETPLACE reported at the last pull, later overwritten by any figure we successfully push. A
 * full pull deletes and recreates every listing row, so the pulled value is what survives in
 * practice. That makes drift the strong claim — the channel really did hold a different number when
 * we last looked — but only as fresh as that look, which is why the caller shows the pull date
 * beside it.
 */
export function channelDrifted(held: number | null | undefined, listed: number | null | undefined): boolean {
  /**
   * Unknown on either side is not agreement, and must not be reported as disagreement either.
   *
   * A listing pulled but never pushed has `listed` null, and a product with no availability row has
   * `held` null. Treating either as 0 would invent a conflict — or worse, hide a real one — out of
   * an absence of information. There are a lot of both: every listing this platform has only ever
   * pulled carries a null.
   */
  if (held == null || listed == null) return false;
  return listed !== held;
}
