import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { repricingApi } from '../../lib/api';

/**
 * How long the repricer's working data is kept.
 *
 * These four tables were two thirds of the database and growing about 9 MB a day — all of it
 * produced in shadow mode, most of it never read again. Two windows rather than one, because the
 * two halves are different kinds of record: decisions and their offer snapshots are the audit trail
 * you read when reviewing what the engine chose, while fee estimates are mostly the verbatim Amazon
 * response and matter only until the next refresh.
 */
export function RetentionCard() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['repricing-retention'], queryFn: () => repricingApi.retention() });
  const [decisionDays, setDecisionDays] = useState('');
  const [feeDays, setFeeDays] = useState('');

  useEffect(() => {
    if (!data) return;
    setDecisionDays(String(data.decisionDays));
    setFeeDays(String(data.feeDays));
  }, [data?.decisionDays, data?.feeDays]);

  const save = useMutation({
    mutationFn: () => repricingApi.setRetention({ decisionDays: Number(decisionDays), feeDays: Number(feeDays) }),
    onSuccess: () => { toast.success('Retention saved'); qc.invalidateQueries({ queryKey: ['repricing-retention'] }); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not save'),
  });

  const purge = useMutation({
    mutationFn: () => repricingApi.purgeRetention(),
    onSuccess: (r) => {
      const n = r.decisions + r.snapshots + r.fees;
      toast.success(`Removed ${n.toLocaleString()} row${n === 1 ? '' : 's'}`);
      qc.invalidateQueries({ queryKey: ['repricing-retention'] });
    },
    onError: () => toast.error('Purge failed'),
  });

  const dirty = !!data && (Number(decisionDays) !== data.decisionDays || Number(feeDays) !== data.feeDays);
  const due = (data?.decisionsDue ?? 0) + (data?.snapshotsDue ?? 0) + (data?.feesDue ?? 0);

  return (
    <div className="card flex flex-col gap-5 p-5">
      <div>
        <div className="text-[14px] font-semibold text-n-900">Data retention</div>
        <p className="mt-1 text-[12.5px] text-n-500">
          The repricer writes a decision for every offer change it sees. Old rows are deleted nightly
          at 03:15 UTC.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 max-[480px]:grid-cols-1">
        <Field
          label="Decisions & snapshots"
          hint="The audit trail — what it chose and the competition it saw."
          value={decisionDays}
          onChange={setDecisionDays}
          count={(data?.decisions ?? 0) + (data?.snapshots ?? 0)}
        />
        <Field
          label="Fee estimate history"
          hint="Each row holds Amazon's full response. The newest per SKU is always kept."
          value={feeDays}
          onChange={setFeeDays}
          count={data?.fees}
        />
      </div>

      <p className="-mt-2 text-[11.5px] text-n-400">
        {/* Both stated, because both are the sort of thing someone reasonably fears when typing a
            number into a box that deletes data. */}
        0 means keep forever. The newest fee estimate for each SKU is never deleted, whatever its
        age — the floor reads it as the live fee.
      </p>

      <div className="flex flex-wrap items-center gap-3 border-t border-n-100 pt-4">
        <button className="btn btn-primary h-9" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
        <button
          className="btn btn-ghost h-9"
          disabled={purge.isPending || due === 0 || dirty}
          title={dirty ? 'Save the new windows first' : due === 0 ? 'Nothing is past its window' : undefined}
          onClick={() => purge.mutate()}
        >
          {purge.isPending ? 'Purging…' : due > 0 ? `Purge ${due.toLocaleString()} now` : 'Nothing to purge'}
        </button>
        <div className="flex-1" />
        <span className="text-[12px] text-n-500">
          {data
            ? `${data.decisions.toLocaleString()} decisions · ${data.snapshots.toLocaleString()} snapshots · ${data.fees.toLocaleString()} fee estimates`
            : '—'}
        </span>
      </div>
    </div>
  );
}

function Field({ label, hint, value, onChange, count }: {
  label: string; hint: string; value: string; onChange: (v: string) => void; count?: number;
}) {
  return (
    <div className="flex min-w-0 flex-col">
      <label className="mb-1.5 flex items-baseline gap-2 text-[12px] font-semibold text-n-600">
        {label}
        {count != null && <span className="font-normal text-n-400">{count.toLocaleString()} held</span>}
      </label>
      <div className="relative">
        <input
          className="input mono pr-14"
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ''))}
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-n-400">days</span>
      </div>
      <div className="mt-1 text-[11px] leading-4 text-n-400">{hint}</div>
    </div>
  );
}
