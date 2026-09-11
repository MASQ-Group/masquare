import { useQuery } from '@tanstack/react-query';
import { ModalShell } from '@masquare/ui';
import { integrationsApi, type ChannelIntegration } from '../../lib/api';

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

/**
 * The orders that failed in the last sync, and why.
 *
 * The count on its own was a dead end. A sync catches per order so one bad order cannot abandon the
 * rest, but the reason went only to the server log — so "6 errors" was the most the page could ever
 * say, and a defect that failed every order carrying a particular field ran for a day behind it.
 *
 * Each row names the order, so it can be opened on the marketplace, and states the reason in the
 * words the failure actually used rather than a category we invented for it.
 */
export function SyncErrorsModal({ integration, onClose }: { integration: ChannelIntegration; onClose: () => void }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['sync-errors', integration.id],
    queryFn: () => integrationsApi.syncErrors(integration.id),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const rows = data?.errors ?? [];

  return (
    <ModalShell
      open
      title="Sync errors"
      subtitle={integration.name}
      primaryLabel="Close"
      onPrimary={onClose}
      onClose={onClose}
    >
      {isLoading && <div className="py-8 text-center text-[13px] text-n-500">Loading the last run’s failures…</div>}

      {isError && (
        <div className="rounded-md border border-danger-bd bg-danger-bg/50 px-3 py-2.5 text-[12.5px] text-danger">
          Couldn’t load the failures for this connection.
        </div>
      )}

      {!isLoading && !isError && (
        <>
          <p className="mb-2.5 text-[12.5px] text-n-500">
            {rows.length === 0
              ? 'Nothing failed in the last run.'
              : `${rows.length} order${rows.length === 1 ? '' : 's'} failed to import in the run of ${fmt(data?.lastSyncRunAt ?? null)}. The rest of the run completed — these orders were skipped, and a later sync will retry them.`}
          </p>

          {rows.length > 0 && (
            <div className="max-h-[55vh] overflow-auto rounded-lg border border-n-100">
              <table className="w-full text-[12.5px]">
                <thead className="sticky top-0 bg-n-50 text-left text-[11px] uppercase tracking-wide text-n-500">
                  <tr>
                    <th className="px-2.5 py-2">Order</th>
                    <th className="px-2.5 py-2">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e, i) => (
                    <tr key={i} className="border-t border-n-100 align-top">
                      <td className="mono whitespace-nowrap px-2.5 py-1.5">{e.transactionRef}</td>
                      {/* break-words, not truncate: a reason nobody can read is the problem being fixed. */}
                      <td className="break-words px-2.5 py-1.5 text-n-600">{e.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/**
            * The same reason repeated across every row means one defect, not many bad orders — worth
            * saying, because the instinct on seeing a list of failures is to go and inspect the orders.
            */}
          {rows.length > 1 && new Set(rows.map((e) => e.reason)).size === 1 && (
            <p className="mt-2.5 text-[12px] text-n-500">
              Every failure gives the same reason, so this is one fault affecting {rows.length} orders rather than
              a problem with the orders themselves.
            </p>
          )}
        </>
      )}
    </ModalShell>
  );
}
