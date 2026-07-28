import { useQuery } from '@tanstack/react-query';
import { ModalShell } from '@masquare/ui';
import { integrationsApi, type ChannelIntegration } from '../../lib/api';

/** Read-only preview of the live listings an integration would pull into Channel Listings —
 *  nothing is saved. Lets the operator sanity-check the field mapping (especially OnBuy, whose
 *  listing schema varies) before running a real sync. */
export function ListingsPreviewModal({ integration, onClose }: { integration: ChannelIntegration; onClose: () => void }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['listings-preview', integration.id],
    queryFn: () => integrationsApi.previewListings(integration.id),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const rows = data?.ok ? data.listings ?? [] : [];
  const failed = !isLoading && (isError || data?.ok === false);

  return (
    <ModalShell open title="Preview listings" subtitle={integration.name} primaryLabel="Close" onPrimary={onClose} onClose={onClose}>
      {isLoading && <div className="py-8 text-center text-[13px] text-n-500">Fetching a sample of live listings…</div>}

      {failed && (
        <div className="rounded-md border border-danger-bd bg-danger-bg/50 px-3 py-2.5 text-[12.5px] text-danger">
          Couldn’t fetch listings{data && 'message' in data && data.message ? `: ${data.message}` : ''}.
          <div className="mt-1 text-n-500">This calls the channel’s live API, so it needs the connection’s credentials on this environment. If they’re only set on production, run the preview there.</div>
        </div>
      )}

      {!isLoading && data?.ok && (
        <>
          <p className="mb-2 text-[12.5px] text-n-500">Showing {rows.length} live {data.channelType} listing{rows.length === 1 ? '' : 's'} — nothing has been saved. Use this to confirm the fields look right before syncing.</p>
          <div className="max-h-[55vh] overflow-auto rounded-lg border border-n-100">
            <table className="w-full text-[12.5px]">
              <thead className="sticky top-0 bg-n-50 text-left text-[11px] uppercase tracking-wide text-n-500">
                <tr>
                  <th className="px-2.5 py-2">SKU</th>
                  <th className="px-2.5 py-2">Title</th>
                  <th className="px-2.5 py-2 text-right">Price</th>
                  <th className="px-2.5 py-2 text-right">Qty</th>
                  <th className="px-2.5 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l, i) => (
                  <tr key={i} className="border-t border-n-100">
                    <td className="mono px-2.5 py-1.5">{l.sku}</td>
                    <td className="px-2.5 py-1.5 text-n-600">{l.title ?? '—'}</td>
                    <td className="mono px-2.5 py-1.5 text-right">{l.price != null ? `${l.price} ${l.currency ?? ''}`.trim() : '—'}</td>
                    <td className="mono px-2.5 py-1.5 text-right">{l.quantity ?? '—'}</td>
                    <td className="px-2.5 py-1.5 text-n-600">{l.status ?? '—'}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={5} className="px-2.5 py-6 text-center text-n-400">No listings returned for this connection.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </ModalShell>
  );
}
