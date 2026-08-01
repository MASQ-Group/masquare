import { useQuery } from '@tanstack/react-query';
import { Tag } from 'lucide-react';
import { channelListingsApi } from '../../lib/api';
import { Flag } from '../common/Flag';

/**
 * Read-only list of each sales channel's OWN identifier for this product — Amazon ASIN, eBay
 * ItemID, OnBuy OPC — pulled from the synced channel listings. These are what the marketplaces
 * key on (eBay in particular needs the ItemID to revise stock), so we surface them here for
 * reference. Populated by a channel sync; empty until the product has synced listings.
 */
export function ProductChannelIdentifiers({ productId }: { productId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['product-channel-identifiers', productId],
    queryFn: () => channelListingsApi.identifiers(productId),
  });

  if (isLoading) return <div className="col-span-2 py-3 text-[12px] text-n-400">Loading channel identifiers…</div>;
  const rows = data ?? [];
  if (rows.length === 0) return null;

  return (
    <div className="col-span-2 mt-1">
      <div className="mb-2 flex items-center gap-2">
        <Tag size={14} className="text-n-400" />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-n-500">Channel identifiers</span>
        <span className="text-[11.5px] text-n-400">Read-only · from the last channel sync</span>
      </div>
      <div className="overflow-hidden rounded-lg border border-n-200">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="border-b border-n-200 bg-n-25 px-3 py-2 text-left text-[10.5px] font-semibold uppercase tracking-wide text-n-500">Channel</th>
              <th className="border-b border-n-200 bg-n-25 px-3 py-2 text-left text-[10.5px] font-semibold uppercase tracking-wide text-n-500">Type</th>
              <th className="border-b border-n-200 bg-n-25 px-3 py-2 text-left text-[10.5px] font-semibold uppercase tracking-wide text-n-500">Identifier</th>
              <th className="border-b border-n-200 bg-n-25 px-3 py-2 text-left text-[10.5px] font-semibold uppercase tracking-wide text-n-500">Channel SKU</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="border-b border-n-100 px-3 py-1.5 text-[12.5px] text-n-800">
                  <span className="inline-flex items-center gap-1.5">
                    {r.countryIso && <Flag code={r.countryIso} />}
                    {r.channelName}
                    {r.marketplace && !r.channelName.toUpperCase().includes(r.marketplace.toUpperCase()) && <span className="code text-[10.5px] text-n-400">{r.marketplace}</span>}
                  </span>
                </td>
                <td className="border-b border-n-100 px-3 py-1.5 text-[11.5px] text-n-500">{r.identifierType}</td>
                <td className="border-b border-n-100 px-3 py-1.5">
                  {r.identifier ? <span className="code text-[12px] text-n-900">{r.identifier}</span> : <span className="text-[11.5px] text-n-400">— not synced —</span>}
                </td>
                <td className="border-b border-n-100 px-3 py-1.5"><span className="code text-[11.5px] text-n-600">{r.channelSku}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
