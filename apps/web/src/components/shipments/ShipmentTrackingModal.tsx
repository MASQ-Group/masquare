import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { carriersApi, type Shipment } from '../../lib/api';
import { TrackingPanel, useTrackingRefresh } from './TrackingPanel';

interface Props {
  shipment: Shipment;
  onClose: () => void;
  /** Called after a refresh, so the list behind picks up the new status. */
  onRefreshed: () => void;
}

/** One parcel's tracking, opened from the shipments log. The panel does the rendering. */
export function ShipmentTrackingModal({ shipment, onClose, onRefreshed }: Props) {
  const detail = useQuery({
    queryKey: ['shipment-tracking', shipment.id],
    queryFn: () => carriersApi.tracking(shipment.id),
  });
  const refresh = useTrackingRefresh(onRefreshed);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(12,16,20,0.5)] p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex max-h-[88vh] w-[560px] max-w-full flex-col rounded-lg bg-n-0 shadow-lg">
        <div className="border-b border-n-200 px-5 py-3.5">
          <h2 className="text-[15px] font-semibold text-n-900">Tracking</h2>
          <p className="mt-0.5 text-[12.5px] text-n-500">
            {shipment.transactionRef ?? 'Shipment'}
            {shipment.shippingService?.name ? ` · ${shipment.shippingService.name}` : ''}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {detail.isLoading && (
            <div className="flex items-center gap-2 py-6 text-[13px] text-n-500">
              <Loader2 size={15} className="animate-spin" /> Loading…
            </div>
          )}
          {detail.data && (
            <TrackingPanel
              view={detail.data}
              onRefresh={() => refresh.mutate([shipment.id])}
              refreshing={refresh.isPending}
            />
          )}
        </div>

        <div className="flex items-center justify-end border-t border-n-200 px-5 py-3.5">
          <button className="inline-flex h-10 items-center rounded-md border border-n-200 bg-n-0 px-4 text-[13.5px] font-semibold text-n-700 hover:bg-n-50" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
