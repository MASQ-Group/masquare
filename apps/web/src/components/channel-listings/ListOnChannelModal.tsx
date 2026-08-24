import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { ModalShell } from '@masquare/ui';
import { listingApi } from '../../lib/api';
import { PlanEditor } from '../products/ProductChannelsTab';

/**
 * List one product on one channel, from the Channel Listings page.
 *
 * The same flow as the product card — match, price, check the competition, validate, list — scoped
 * to the single channel you clicked. Reuses PlanEditor rather than reimplementing it: two listing
 * flows would be two sets of guards, and the guards are the point.
 */
export function ListOnChannelModal({
  productId, integrationId, channelName, onClose,
}: {
  productId: string;
  integrationId: string;
  channelName: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['listing', 'product-channels', productId],
    queryFn: () => listingApi.productChannels(productId),
  });

  const row = data?.channels.find((c) => c.integrationId === integrationId);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['listing', 'product-channels', productId] });
    qc.invalidateQueries({ queryKey: ['channel-listings'] });
  };

  return (
    <ModalShell
      open
      title={`List on ${channelName}`}
      subtitle={row ? `${row.readiness.satisfiedCount} of ${row.readiness.totalCount} requirements met` : undefined}
      primaryLabel="Done"
      onPrimary={onClose}
      onClose={onClose}
      initialSize={{ w: 860, h: 680 }}
    >
      {isLoading && (
        <div className="flex items-center gap-2 py-10 text-[13px] text-n-500">
          <Loader2 size={15} className="animate-spin" /> Reading this channel…
        </div>
      )}

      {!isLoading && !row && (
        <div className="py-10 text-center text-[13px] text-n-500">
          This channel is no longer connected, so nothing can be listed on it.
        </div>
      )}

      {row && (
        <div className="flex flex-col gap-3">
          {/* Stated before anything else: a blocked channel is not a form to fill in. */}
          {!row.eligibility.eligible && (
            <div className="rounded-md border border-danger-bd bg-danger-bg px-3 py-2 text-[12.5px] text-danger">
              {row.eligibility.findings.filter((f) => f.severity === 'block').map((f) => f.reason).join('; ')
                || 'This product may not be sold on this marketplace.'}
            </div>
          )}
          {row.listing && (
            <div className="rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-[12.5px] text-teal-900">
              Already listed here as <b>{row.listing.channelSku}</b>. Editing the plan will not create a second offer.
            </div>
          )}

          <PlanEditor
            row={row}
            productId={productId}
            warnings={row.eligibility.findings.filter((f) => f.severity === 'warn').map((f) => f.reason)}
            onSaved={refresh}
          />
        </div>
      )}
    </ModalShell>
  );
}
