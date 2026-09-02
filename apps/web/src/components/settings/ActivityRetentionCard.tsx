import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { activityApi } from '../../lib/api';

/**
 * How long the change log is kept.
 *
 * Two windows rather than one, because the two halves of the log have nothing in common. Almost all
 * the rows come from machines — a nightly sync touches thousands of orders — while almost all the
 * value comes from people, who produce a handful a day. On a single clock you must choose between a
 * table that grows without bound and discarding the human record the log exists for.
 *
 * The counts are shown alongside so a window is chosen against real numbers rather than a guess.
 */
export function ActivityRetentionCard() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['activity-retention'], queryFn: () => activityApi.retention() });
  const [userDays, setUserDays] = useState('');
  const [systemDays, setSystemDays] = useState('');

  useEffect(() => {
    if (!data) return;
    setUserDays(String(data.userDays));
    setSystemDays(String(data.systemDays));
  }, [data?.userDays, data?.systemDays]);

  const save = useMutation({
    mutationFn: () => activityApi.setRetention({ userDays: Number(userDays), systemDays: Number(systemDays) }),
    onSuccess: () => { toast.success('Retention saved'); qc.invalidateQueries({ queryKey: ['activity-retention'] }); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not save'),
  });

  const purge = useMutation({
    mutationFn: () => activityApi.purgeNow(),
    onSuccess: (r) => { toast.success(`Removed ${r.human + r.machine} entr${r.human + r.machine === 1 ? 'y' : 'ies'}`); qc.invalidateQueries({ queryKey: ['activity-retention'] }); },
    onError: () => toast.error('Purge failed'),
  });

  const dirty = !!data && (Number(userDays) !== data.userDays || Number(systemDays) !== data.systemDays);
  const due = data?.dueForPurge ?? 0;

  return (
    <div className="card flex flex-col gap-5 p-5">
      <div>
        <div className="text-[14px] font-semibold text-n-900">Activity log retention</div>
        <p className="mt-1 text-[12.5px] text-n-500">
          How long the change history on products and orders is kept. Entries past their window are
          deleted nightly at 03:30 UTC.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 max-[480px]:grid-cols-1">
        <Field
          label="People's actions"
          hint="Edits, spreadsheet uploads — anything a person chose to do."
          value={userDays}
          onChange={setUserDays}
          count={data?.human}
        />
        <Field
          label="Machine actions"
          hint="Channel syncs and platform jobs. This is where the volume is."
          value={systemDays}
          onChange={setSystemDays}
          count={data?.machine}
        />
      </div>

      <p className="-mt-2 text-[11.5px] text-n-400">
        {/* Stated rather than implied: a settings field that silently emptied the log when typed to
            zero would be a trap. */}
        0 means keep forever.
      </p>

      <div className="flex flex-wrap items-center gap-3 border-t border-n-100 pt-4">
        <button className="btn btn-primary h-9" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : 'Save'}
        </button>

        {/* Saving a window and deleting to it are separate decisions on purpose: one button for
            both would make a mistyped number irreversible before anyone saw the count. */}
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
          {data ? (
            <>
              {data.total.toLocaleString()} entr{data.total === 1 ? 'y' : 'ies'}
              {data.oldest && <> · oldest {new Date(data.oldest).toLocaleDateString()}</>}
            </>
          ) : '—'}
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
