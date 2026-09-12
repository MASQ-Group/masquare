/**
 * Could this string ever have been a run id?
 *
 * Jobs are keyed by UUID, so anything that is not one cannot have been a job — which makes the
 * difference between "your run was lost" and "that is not a run id" decidable rather than guessed.
 *
 * It mattered: the missing-job message assumed a restarted server, so pasting the placeholder out of
 * an instruction returned "it stopped partway, run it again" — advice to re-trigger a job that was
 * very likely still running.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function looksLikeJobId(id: string | null | undefined): boolean {
  return UUID.test(String(id ?? '').trim());
}
