import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Package, Pencil, Plus, Trash2 } from 'lucide-react';
import { Select } from '@masquare/ui';
import { portalApi, type CustomerProduct, type CustomerProductInput } from '../lib/api';
import { useConfirm } from '../components/ConfirmProvider';
import { CountrySelect } from '../components/common/CountrySelect';
import { PORTAL_COUNTRIES } from './ShipmentFormFields';
import { fieldProblem } from './formRules';

/**
 * A customer's own catalogue of goods.
 *
 * Exists to be borrowed from, nothing more: a product here is a set of answers the package section
 * can be filled with, not a record of stock and not anything the platform's own products know
 * about. Which is why a filed shipment copies the values rather than pointing at the product —
 * correcting a weight next month must not rewrite what was shipped last month.
 */
export function PortalProductsPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<Draft | null>(null);

  const { data: products = [], isLoading } = useQuery({ queryKey: ['portal', 'products'], queryFn: portalApi.products });
  const { data: home } = useQuery({ queryKey: ['portal', 'home'], queryFn: portalApi.home });

  const done = (message: string) => () => {
    toast.success(message);
    setEditing(null);
    qc.invalidateQueries({ queryKey: ['portal', 'products'] });
  };
  const failed = (e: any) => toast.error(e?.response?.data?.message ?? 'That did not work.');

  const save = useMutation({
    mutationFn: () => {
      const body = toInput(editing!);
      return editing!.id ? portalApi.updateProduct(editing!.id, body) : portalApi.createProduct(body);
    },
    onSuccess: done('Product saved'),
    onError: failed,
  });
  const remove = useMutation({
    mutationFn: (id: string) => portalApi.removeProduct(id),
    onSuccess: done('Product removed'),
    onError: failed,
  });

  const askRemove = async (p: CustomerProduct) => {
    const ok = await confirm({
      title: `Remove ${p.name}?`,
      message: 'It stops being offered when you fill in a package. Shipments you have already filed keep the details they were given.',
      confirmLabel: 'Remove',
      tone: 'danger',
    });
    if (ok) remove.mutate(p.id);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-[18px] font-semibold text-n-900">Your products</h1>
          <p className="text-[13px] text-n-600">
            Describe what you ship often, once. Each one fills a package's description, size, weight and value in a click.
          </p>
        </div>
        <div className="flex-1" />
        <button type="button" className="btn btn-primary" onClick={() => setEditing(emptyDraft('EUR'))}>
          <Plus size={16} /> New product
        </button>
      </div>

      {editing && (
        <ProductForm
          draft={editing}
          setDraft={setEditing}
          batteryTypes={home?.batteryTypes ?? []}
          saving={save.isPending}
          onSave={() => save.mutate()}
          onCancel={() => setEditing(null)}
        />
      )}

      {isLoading && <p className="text-[13px] text-n-500">Loading…</p>}

      {!isLoading && products.length === 0 && !editing && (
        <div className="card grid place-items-center gap-2 p-10 text-center">
          <Package size={22} className="text-n-400" />
          <p className="text-[13.5px] font-medium text-n-800">Nothing saved yet</p>
          <p className="max-w-[420px] text-[12.5px] text-n-600">
            You can file shipments without this. Saving a product only means not typing its size and weight again next time.
          </p>
        </div>
      )}

      {products.length > 0 && (
        <div className="grid grid-cols-2 gap-3 max-[760px]:grid-cols-1">
          {products.map((p) => (
            <div key={p.id} className="card flex items-start gap-3 p-4">
              <Package size={16} className="mt-0.5 text-n-400" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-[13.5px] font-semibold text-n-900">{p.name}</span>
                  {p.dangerousGoods && <span className="tag bg-warning-bg text-warning">Dangerous goods</span>}
                  {!p.active && <span className="tag bg-n-100 text-n-600">Not offered</span>}
                </div>
                <p className="mono mt-1 text-[12px] text-n-600">
                  {[
                    p.lengthCm && p.widthCm && p.heightCm ? `${p.lengthCm} × ${p.widthCm} × ${p.heightCm} cm` : null,
                    p.weightKg ? `${p.weightKg} kg` : null,
                    p.declaredValue ? `${p.currency} ${p.declaredValue}` : null,
                  ].filter(Boolean).join('  ·  ') || 'No measurements saved'}
                </p>
              </div>
              <button type="button" className="grid h-8 w-8 place-items-center rounded-md text-n-500 hover:bg-n-100" title="Edit" onClick={() => setEditing(draftOf(p))}>
                <Pencil size={14} />
              </button>
              <button type="button" className="grid h-8 w-8 place-items-center rounded-md text-n-500 hover:bg-danger-bg hover:text-danger" title="Remove" onClick={() => askRemove(p)}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── the form ───────────────────────────────────────────────────────────────────────────────────

/** Everything as typed. Numbers become numbers once, on save. */
interface Draft {
  id: string | null;
  name: string;
  lengthCm: string;
  widthCm: string;
  heightCm: string;
  weightKg: string;
  declaredValue: string;
  currency: string;
  dangerousGoods: boolean;
  batteryType: string | null;
  hsCode: string;
  countryOfOrigin: string;
  active: boolean;
}

const emptyDraft = (currency: string): Draft => ({
  id: null, name: '', lengthCm: '', widthCm: '', heightCm: '', weightKg: '',
  declaredValue: '', currency, dangerousGoods: false, batteryType: null, hsCode: '', countryOfOrigin: '', active: true,
});

const draftOf = (p: CustomerProduct): Draft => ({
  id: p.id,
  name: p.name,
  lengthCm: p.lengthCm != null ? String(p.lengthCm) : '',
  widthCm: p.widthCm != null ? String(p.widthCm) : '',
  heightCm: p.heightCm != null ? String(p.heightCm) : '',
  weightKg: p.weightKg != null ? String(p.weightKg) : '',
  declaredValue: p.declaredValue != null ? String(p.declaredValue) : '',
  currency: p.currency,
  dangerousGoods: p.dangerousGoods,
  batteryType: p.batteryType,
  hsCode: p.hsCode ?? '',
  countryOfOrigin: p.countryOfOrigin ?? '',
  active: p.active,
});

const toInput = (d: Draft): CustomerProductInput => {
  const num = (v: string) => {
    const n = Number(v.trim().replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  return {
    name: d.name.trim(),
    lengthCm: num(d.lengthCm),
    widthCm: num(d.widthCm),
    heightCm: num(d.heightCm),
    weightKg: num(d.weightKg),
    declaredValue: num(d.declaredValue),
    currency: d.currency,
    dangerousGoods: d.dangerousGoods,
    batteryType: d.dangerousGoods ? d.batteryType : null,
    hsCode: d.hsCode.trim() || null,
    countryOfOrigin: d.countryOfOrigin.trim().toUpperCase() || null,
    active: d.active,
  };
};

function ProductForm({ draft, setDraft, batteryTypes, saving, onSave, onCancel }: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  batteryTypes: { key: string; label: string }[];
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const yesNo = [{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }];

  return (
    <section className="card p-5">
      <h2 className="mb-4 text-[14px] font-semibold text-n-900">{draft.id ? 'Edit product' : 'New product'}</h2>

      <div className="grid grid-cols-2 gap-4 max-[560px]:grid-cols-1">
        <div className="col-span-2 max-[560px]:col-span-1">
          <label className="label">Product name *</label>
          <input
            className="input"
            value={draft.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="What it is called — this becomes the goods description"
          />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-4 gap-3 max-[700px]:grid-cols-2">
        <div><label className="label">Length (cm)</label><input className="input mono" inputMode="decimal" value={draft.lengthCm} onChange={(e) => set({ lengthCm: e.target.value })} /></div>
        <div><label className="label">Width (cm)</label><input className="input mono" inputMode="decimal" value={draft.widthCm} onChange={(e) => set({ widthCm: e.target.value })} /></div>
        <div><label className="label">Height (cm)</label><input className="input mono" inputMode="decimal" value={draft.heightCm} onChange={(e) => set({ heightCm: e.target.value })} /></div>
        <div><label className="label">Weight (kg)</label><input className="input mono" inputMode="decimal" value={draft.weightKg} onChange={(e) => set({ weightKg: e.target.value })} /></div>
      </div>

      <div className="mt-4 grid grid-cols-4 gap-3 max-[700px]:grid-cols-2">
        <div><label className="label">Declared value</label><input className="input mono" inputMode="decimal" value={draft.declaredValue} onChange={(e) => set({ declaredValue: e.target.value })} /></div>
        <div>
          <label className="label">Currency</label>
          <Select value={draft.currency} onChange={(v) => set({ currency: v })} options={['EUR', 'GBP', 'USD'].map((c) => ({ value: c, label: c }))} />
        </div>
        <div>
          <label className="label">Dangerous goods</label>
          <Select
            value={draft.dangerousGoods ? 'yes' : 'no'}
            onChange={(v) => set({ dangerousGoods: v === 'yes', batteryType: v === 'yes' ? draft.batteryType : null })}
            options={yesNo}
          />
        </div>
        <div>
          <label className="label">Offer this product</label>
          <Select value={draft.active ? 'yes' : 'no'} onChange={(v) => set({ active: v === 'yes' })} options={yesNo} />
        </div>
      </div>

      {/* Its customs answers, asked once here rather than on every shipment outside the EU. */}
      <div className="mt-4 grid grid-cols-2 gap-3 max-[560px]:grid-cols-1">
        <div>
          <label className="label">Country of origin</label>
          <CountrySelect value={draft.countryOfOrigin || null} valueKind="code" source={PORTAL_COUNTRIES} onChange={(v) => set({ countryOfOrigin: v ?? '' })} />
        </div>
        <div>
          <label className="label">HS code</label>
          <input
            className={`input mono ${fieldProblem('hs', draft.hsCode) ? 'border-danger' : ''}`}
            value={draft.hsCode}
            onChange={(e) => set({ hsCode: e.target.value })}
            placeholder="8516.79"
          />
          {fieldProblem('hs', draft.hsCode) && <p className="mt-1 text-[12px] text-danger">{fieldProblem('hs', draft.hsCode)}</p>}
        </div>
      </div>
      <p className="mt-1.5 text-[12px] text-n-500">Needed by customs for deliveries outside the EU. Saved here, they fill in automatically when you choose this product.</p>

      {draft.dangerousGoods && (
        <div className="mt-4 max-w-[420px]">
          <label className="label">Battery type</label>
          <Select
            searchable
            value={draft.batteryType ?? ''}
            onChange={(v) => set({ batteryType: v || null })}
            options={[{ value: '', label: 'Choose the packing instruction' }, ...batteryTypes.map((b) => ({ value: b.key, label: b.label }))]}
          />
        </div>
      )}

      <div className="mt-5 flex items-center gap-3">
        <button type="button" className="btn btn-primary" disabled={saving || !draft.name.trim() || !!fieldProblem('hs', draft.hsCode)} onClick={onSave}>
          {saving ? 'Saving…' : 'Save product'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </section>
  );
}
