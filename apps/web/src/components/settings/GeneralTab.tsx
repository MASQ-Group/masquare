import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { settingsApi, type PlatformSettings } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { SectionHeader } from './shared';

const DATE_FORMATS: { value: PlatformSettings['dateFormat']; label: string }[] = [
  { value: 'ddmmyyyy', label: 'dd/mm/yyyy' },
  { value: 'mmddyyyy', label: 'mm/dd/yyyy' },
  { value: 'yyyymmdd', label: 'yyyy-mm-dd' },
];

export function GeneralTab() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data } = useQuery({ queryKey: ['settings'], queryFn: settingsApi.get });
  const [measurementSystem, setMeasurementSystem] = useState<PlatformSettings['measurementSystem']>('metric');
  const [dateFormat, setDateFormat] = useState<PlatformSettings['dateFormat']>('ddmmyyyy');

  useEffect(() => {
    if (data) {
      setMeasurementSystem(data.measurementSystem);
      setDateFormat(data.dateFormat);
    }
  }, [data]);

  const save = useMutation({
    mutationFn: () => settingsApi.update({ measurementSystem, dateFormat }),
    onSuccess: () => { toast.success('Settings saved'); qc.invalidateQueries({ queryKey: ['settings'] }); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Save failed'),
  });

  const readOnly = !user?.isAdmin;

  return (
    <div className="max-w-[560px]">
      <SectionHeader title="General" description="Platform-wide display defaults. Drives units and how dates render everywhere." />

      <div className="card flex flex-col gap-5 p-5">
        <div>
          <label className="label">Measurement system</label>
          <div className="flex gap-2">
            {(['metric', 'imperial'] as const).map((opt) => (
              <button
                key={opt}
                disabled={readOnly}
                onClick={() => setMeasurementSystem(opt)}
                className={`h-10 flex-1 rounded-md border text-[13.5px] font-medium capitalize transition-colors ${
                  measurementSystem === opt ? 'border-teal-400 bg-teal-50 text-teal-700' : 'border-n-200 bg-n-0 text-n-600 hover:bg-n-50'
                } disabled:opacity-60`}
              >
                {opt} {opt === 'metric' ? '(cm, kg)' : '(in, lb)'}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="label">Date format</label>
          <div className="flex gap-2">
            {DATE_FORMATS.map((opt) => (
              <button
                key={opt.value}
                disabled={readOnly}
                onClick={() => setDateFormat(opt.value)}
                className={`mono h-10 flex-1 rounded-md border text-[13px] font-medium transition-colors ${
                  dateFormat === opt.value ? 'border-teal-400 bg-teal-50 text-teal-700' : 'border-n-200 bg-n-0 text-n-600 hover:bg-n-50'
                } disabled:opacity-60`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {!readOnly ? (
          <div className="flex justify-end">
            <button className="btn btn-primary" onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save settings'}
            </button>
          </div>
        ) : (
          <p className="text-[12px] text-n-400">Only admins can change platform settings.</p>
        )}
      </div>
    </div>
  );
}
