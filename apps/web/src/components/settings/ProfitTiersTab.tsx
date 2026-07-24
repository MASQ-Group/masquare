import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { profitTiersApi, type ProfitTier } from '../../lib/api';

interface TierForm {
  name: string;
  fromPct: string;
  toPct: string;
  bgColor: string;
  fontColor: string;
}

const DEFAULT_TIERS: TierForm[] = [
  { name: 'Loss', fromPct: '-100', toPct: '-0.01', bgColor: '#FCEBE9', fontColor: '#C8372E' },
  { name: 'Low', fromPct: '0', toPct: '10', bgColor: '#FEF4E5', fontColor: '#B97D18' },
  { name: 'Healthy', fromPct: '10.01', toPct: '20', bgColor: '#F2F8E6', fontColor: '#71A22F' },
  { name: 'Strong', fromPct: '20.01', toPct: '100', bgColor: '#8DC73F', fontColor: '#FFFFFF' },
];

const toForm = (t: ProfitTier): TierForm => ({ name: t.name ?? '', fromPct: String(t.fromPct), toPct: String(t.toPct), bgColor: t.bgColor, fontColor: t.fontColor });

export function ProfitTiersTab() {
  const qc = useQueryClient();
  const { data: tiers, isLoading } = useQuery({ queryKey: ['profit-tiers'], queryFn: () => profitTiersApi.list() });
  const [rows, setRows] = useState<TierForm[]>([]);
  const [dirty, setDirty] = useState(false);

  // Load the saved tiers into the editor (until the user starts editing).
  useEffect(() => { if (tiers && !dirty) setRows(tiers.map(toForm)); }, [tiers, dirty]);

  const setRow = (i: number, patch: Partial<TierForm>) => { setRows((r) => r.map((x, idx) => (idx === i ? { ...x, ...patch } : x))); setDirty(true); };

  const save = useMutation({
    mutationFn: () =>
      profitTiersApi.saveAll(
        rows
          .filter((r) => r.fromPct.trim() !== '' && r.toPct.trim() !== '')
          .map((r) => ({ name: r.name.trim() || null, fromPct: Number(r.fromPct), toPct: Number(r.toPct), bgColor: r.bgColor, fontColor: r.fontColor })),
      ),
    onSuccess: () => { toast.success('Profit tiers saved'); setDirty(false); qc.invalidateQueries({ queryKey: ['profit-tiers'] }); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Save failed'),
  });

  const overlaps = (i: number) => {
    const a = rows[i];
    const af = Number(a.fromPct); const at = Number(a.toPct);
    if (Number.isNaN(af) || Number.isNaN(at)) return false;
    return rows.some((b, j) => {
      if (j === i) return false;
      const bf = Number(b.fromPct); const bt = Number(b.toPct);
      if (Number.isNaN(bf) || Number.isNaN(bt)) return false;
      return af <= bt && bf <= at;
    });
  };

  return (
    <div className="max-w-3xl">
      <div className="mb-4">
        <h2 className="text-[17px] font-semibold text-n-900">Profit Percentage Tiers</h2>
        <p className="mt-1 text-[13px] text-n-500">
          Define profit % bands and the colours used for the <strong>Profit (%)</strong> chip in the sales transaction list.
          A transaction's profit % falls into the first tier whose range contains it.
        </p>
      </div>

      <div className="card p-4">
        {isLoading && <p className="py-4 text-center text-[13px] text-n-500">Loading…</p>}
        {!isLoading && rows.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-6">
            <p className="text-[13px] text-n-500">No tiers defined yet.</p>
            <button className="btn btn-ghost" onClick={() => { setRows(DEFAULT_TIERS); setDirty(true); }}>Start from a suggested set</button>
          </div>
        )}
        {rows.length > 0 && (
          <div className="flex flex-col gap-2.5">
            <div className="grid grid-cols-[1fr_90px_90px_74px_74px_96px_36px] items-center gap-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-n-500 max-[640px]:hidden">
              <span>Tier name</span><span>From %</span><span>To %</span><span>Chip bg</span><span>Chip font</span><span>Preview</span><span />
            </div>
            {rows.map((r, i) => {
              const bad = overlaps(i);
              return (
                <div key={i} className={`grid grid-cols-[1fr_90px_90px_74px_74px_96px_36px] items-center gap-2 rounded-md border p-1.5 max-[640px]:grid-cols-2 ${bad ? 'border-warning-bd bg-warning-bg' : 'border-n-200'}`}>
                  <input className="input h-9" placeholder={`Tier ${i + 1}`} value={r.name} onChange={(e) => setRow(i, { name: e.target.value })} />
                  <input className="input mono h-9" inputMode="decimal" placeholder="0" value={r.fromPct} onChange={(e) => setRow(i, { fromPct: e.target.value })} />
                  <input className="input mono h-9" inputMode="decimal" placeholder="10" value={r.toPct} onChange={(e) => setRow(i, { toPct: e.target.value })} />
                  <input type="color" className="h-9 w-full cursor-pointer rounded-md border border-n-200 bg-n-0 p-1" value={r.bgColor} onChange={(e) => setRow(i, { bgColor: e.target.value })} title="Chip background colour" />
                  <input type="color" className="h-9 w-full cursor-pointer rounded-md border border-n-200 bg-n-0 p-1" value={r.fontColor} onChange={(e) => setRow(i, { fontColor: e.target.value })} title="Chip font colour" />
                  <span className="tag mono justify-self-center" style={{ background: r.bgColor, color: r.fontColor }}>
                    {r.toPct !== '' ? `${r.toPct}%` : '12.5%'}
                  </span>
                  <button className="grid h-8 w-8 place-items-center rounded-md text-n-500 hover:bg-danger-bg hover:text-danger" onClick={() => { setRows((x) => x.filter((_, idx) => idx !== i)); setDirty(true); }}><Trash2 size={14} /></button>
                </div>
              );
            })}
            {rows.some((_, i) => overlaps(i)) && (
              <p className="text-[12px] text-warning">Some tier ranges overlap — the first matching tier wins.</p>
            )}
          </div>
        )}

        <div className="mt-4 flex items-center gap-2">
          <button className="btn btn-ghost" onClick={() => { setRows((r) => [...r, { name: '', fromPct: '', toPct: '', bgColor: '#F2F8E6', fontColor: '#557A23' }]); setDirty(true); }}>
            <Plus size={16} /> Add tier
          </button>
          <button className="btn btn-primary ml-auto" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : 'Save tiers'}
          </button>
        </div>
      </div>

      <p className="mt-3 text-[12px] text-n-400">
        Values outside every tier show as a neutral chip. Use a negative "From %" (e.g. −100) to colour loss-making transactions.
      </p>
    </div>
  );
}
