import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { repricingApi, type RepricingSkuRow } from '../../lib/api';

/**
 * Switching one SKU's automation, from its row.
 *
 * This is how a pilot is run: a few SKUs live, the rest in shadow. Going live is the only step that
 * can change a price on Amazon, so it asks first and says what it will do; stopping does not ask.
 *
 * A quarantined SKU has no control here on purpose — its way back is Resolve, on the quarantine
 * list, so that somebody looks at the conflict first.
 */
export function SkuStateControl({ row, liveWritesEnabled }: { row: RepricingSkuRow; liveWritesEnabled: boolean }) {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  const change = useMutation({
    mutationFn: (state: 'LIVE' | 'SHADOW' | 'KILLED') => repricingApi.setAutomationState(row.id, state),
    onSuccess: (r) => {
      setConfirming(false);
      toast.success(
        `${row.sku} is now ${r.automationState.toLowerCase()}${r.notes.length ? ` — ${r.notes.join(' ')}` : ''}`,
        r.notes.length ? { duration: 8000 } : undefined,
      );
      qc.invalidateQueries({ queryKey: ['repricing', 'sku-pricing'] });
      qc.invalidateQueries({ queryKey: ['repricing', 'readiness'] });
    },
    onError: (e: any) => {
      setConfirming(false);
      toast.error(e?.response?.data?.message ?? 'Could not change the state', { duration: 9000 });
    },
  });

  if (row.automationState === 'QUARANTINED') {
    return <span className="text-[11px] text-n-400" title="Fix the conflict, then press Resolve on the quarantine list">Resolve first</span>;
  }
  if (change.isPending) return <Loader2 size={13} className="animate-spin text-n-400" />;

  const link = 'text-[11.5px] font-semibold text-teal-700 hover:underline disabled:opacity-40';

  if (confirming) {
    return (
      <span className="flex items-center justify-end gap-2">
        <span className="text-[11px] text-n-600">
          {liveWritesEnabled ? 'Send real prices to Amazon?' : 'Go live? Platform live writes are off, so nothing is sent yet.'}
        </span>
        <button type="button" className={link} onClick={() => change.mutate('LIVE')}>Yes</button>
        <button type="button" className="text-[11.5px] text-n-500 hover:underline" onClick={() => setConfirming(false)}>No</button>
      </span>
    );
  }

  return (
    <span className="flex items-center justify-end gap-2">
      {row.automationState !== 'LIVE' && (
        <button type="button" className={link} onClick={() => setConfirming(true)}>Go live</button>
      )}
      {row.automationState !== 'SHADOW' && (
        <button type="button" className="text-[11.5px] font-semibold text-n-600 hover:underline" onClick={() => change.mutate('SHADOW')}>
          {row.automationState === 'LIVE' ? 'Pause' : 'Shadow'}
        </button>
      )}
      {row.automationState !== 'KILLED' && (
        <button type="button" className="text-[11.5px] text-n-500 hover:underline" onClick={() => change.mutate('KILLED')}>Stop</button>
      )}
    </span>
  );
}
