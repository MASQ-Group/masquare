import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { settingsApi } from '../../lib/api';

/**
 * Whether editing a quantity here pushes it to the channels straight away.
 *
 * Admin-only, and off by default. A figure typed while working through a catalogue is half-finished,
 * and broadcasting every intermediate value puts wrong quantities on live listings — so the safe
 * behaviour is the default and the convenience is opt-in. It sits on this page rather than in
 * Settings because this is where the editing happens and where the consequence is felt.
 *
 * Sales are unaffected by it in either position: an order is a fact about stock that has already
 * gone, and it always pushes.
 */
export function AutoPushToggle() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['settings'], queryFn: () => settingsApi.get() });
  const on = data?.autoPushAvailabilityOnEdit ?? false;

  const save = useMutation({
    mutationFn: (next: boolean) => settingsApi.update({ autoPushAvailabilityOnEdit: next }),
    onSuccess: (_r, next) => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      toast.success(next
        ? 'Quantity edits will now be sent to the channels straight away'
        : 'Quantity edits stay here until you push them');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not change the setting'),
  });

  return (
    <label
      className={`flex items-center gap-2 text-[12.5px] ${save.isPending || isLoading ? 'opacity-60' : 'cursor-pointer'}`}
      title={on
        ? 'Editing a quantity sends it to every channel this product is listed on, immediately'
        : 'Editing a quantity only saves it here — use Push to channels when your work is ready'}
    >
      {save.isPending
        ? <Loader2 size={14} className="animate-spin text-n-400" />
        : (
          <input
            type="checkbox"
            className="h-3.5 w-3.5 accent-[var(--teal-500)]"
            checked={on}
            disabled={isLoading || save.isPending}
            onChange={(e) => save.mutate(e.target.checked)}
          />
        )}
      <span className="text-n-600">
        Push edits to channels automatically
        {/* The consequence, not just the state — the label alone reads as harmless either way. */}
        <span className="ml-1 text-n-400">{on ? '· edits go live at once' : '· push manually'}</span>
      </span>
    </label>
  );
}
