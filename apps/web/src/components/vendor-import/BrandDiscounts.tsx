import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2, Percent } from 'lucide-react';
import { Select } from '@masquare/ui';
import { brandsApi, type Brand } from '../../lib/api';

export interface BrandDiscountRow {
  brandId: string;
  /** Kept as text so a half-typed "1" does not become a committed 1%. */
  pct: string;
}

interface Props {
  rows: BrandDiscountRow[];
  onChange: (rows: BrandDiscountRow[]) => void;
  disabled?: boolean;
}

/**
 * Off-invoice brand discounts, set per upload.
 *
 * Chosen from OUR brands, not the vendor's brand column: their spelling differs from ours and the
 * column is often absent altogether, so matching on it would silently miss rows. At apply time
 * each product's own brand decides whether a discount applies.
 */
export function BrandDiscounts({ rows, onChange, disabled }: Props) {
  const { data: brands = [] } = useQuery({ queryKey: ['brands'], queryFn: () => brandsApi.list() });

  const used = new Set(rows.map((r) => r.brandId).filter(Boolean));
  const set = (i: number, patch: Partial<BrandDiscountRow>) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  return (
    <div className="flex flex-col gap-2">
      <div>
        <div className="label">Extra brand discount</div>
        <p className="text-[11.5px] text-n-500">
          For brands where the vendor gives a discount that is not already in the file. Deducted from the
          file&rsquo;s purchase cost; the suggested retail price is left alone.
        </p>
      </div>

      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="min-w-[200px] flex-1">
            <Select
              value={r.brandId}
              onChange={(v) => set(i, { brandId: v })}
              disabled={disabled}
              placeholder="Choose a brand…"
              searchable
              searchPlaceholder="Type a brand name…"
              dense
              options={brands
                .filter((b: Brand) => b.id === r.brandId || !used.has(b.id))
                .map((b: Brand) => ({ value: b.id, label: b.name }))}
            />
          </div>
          <div className="relative w-[110px]">
            <input
              className="input mono h-9 pr-6 text-right"
              inputMode="decimal"
              placeholder="0"
              value={r.pct}
              disabled={disabled}
              onChange={(e) => set(i, { pct: e.target.value })}
            />
            <Percent size={13} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-n-400" />
          </div>
          <button
            onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
            disabled={disabled}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-n-500 hover:bg-danger-bg hover:text-danger disabled:opacity-50"
            title="Remove"
          >
            <Trash2 size={15} />
          </button>
        </div>
      ))}

      <div>
        <button
          onClick={() => onChange([...rows, { brandId: '', pct: '' }])}
          disabled={disabled}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-n-200 bg-n-0 px-2.5 text-[12.5px] font-semibold text-n-700 hover:bg-n-50 disabled:opacity-50"
        >
          <Plus size={14} /> {rows.length ? 'Add another brand' : 'Add a brand discount'}
        </button>
      </div>
    </div>
  );
}

/** The rows the user has actually completed, as the payload the server expects. */
export function toDiscountPayload(rows: BrandDiscountRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const pct = Number(String(r.pct).replace(',', '.'));
    if (!r.brandId || !Number.isFinite(pct) || pct <= 0 || pct >= 100) continue;
    out[r.brandId] = pct;
  }
  return out;
}

/** An incomplete row is a discount the user meant to apply — worth blocking on, not ignoring. */
export function incompleteDiscountRows(rows: BrandDiscountRow[]): number {
  return rows.filter((r) => {
    const pct = Number(String(r.pct).replace(',', '.'));
    const hasBrand = !!r.brandId;
    const hasPct = String(r.pct).trim() !== '' && Number.isFinite(pct) && pct > 0 && pct < 100;
    return (hasBrand || String(r.pct).trim() !== '') && !(hasBrand && hasPct);
  }).length;
}
