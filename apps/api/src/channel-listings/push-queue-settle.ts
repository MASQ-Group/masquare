/**
 * Which products a push actually paid off, and which still owe their channels a number.
 *
 * The queue row is a debt: one product owes its channels a quantity. Deciding when that debt is
 * settled is the whole correctness question, and the tempting answer — the drain returned, so clear
 * everything — is wrong. A product listed on eight marketplaces where one refuses has not been
 * paid. Clearing it would bury the refusal, which is precisely the silence this queue exists to end.
 *
 * So a product is settled only when NOTHING it was pushed to refused. Anything else keeps its row,
 * counts an attempt, and carries the channel's own words forward so a stuck product explains itself.
 */
export interface PushResult {
  productId?: string | null;
  ok: boolean;
  message?: string | null;
}

export function settlePushQueue<T extends { id: string; productId: string }>(
  due: T[],
  results: PushResult[],
): { settled: T[]; retry: { row: T; why: string }[] } {
  /**
   * Only refusals are indexed, and only those naming a product.
   *
   * A result with no productId cannot be attributed to a debt — it must not silently condemn one,
   * and it must not silently clear one either. It simply says nothing about this decision.
   */
  const refusedBy = new Map<string, string>();
  for (const r of results) {
    if (r.ok || !r.productId) continue;
    if (!refusedBy.has(r.productId)) refusedBy.set(r.productId, (r.message ?? 'refused').trim() || 'refused');
  }

  const settled: T[] = [];
  const retry: { row: T; why: string }[] = [];
  for (const row of due) {
    const why = refusedBy.get(row.productId);
    if (why) retry.push({ row, why });
    else settled.push(row);
  }
  return { settled, retry };
}
