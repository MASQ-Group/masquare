import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ModalShell } from '@masquare/ui';
import { attributesApi, categoriesApi, productsApi, productTypesApi } from '../../lib/api';

interface Props {
  ids: string[];
  onClose: () => void;
  onDone: () => void;
}

/** Apply Product Type / Category / Attributes to the selected products in one pass.
 *  Only the sections you fill are applied. */
export function BulkEditModal({ ids, onClose, onDone }: Props) {
  const [busy, setBusy] = useState(false);
  const { data: ptypes = [] } = useQuery({ queryKey: ['product-types'], queryFn: () => productTypesApi.list() });
  const { data: categories = [] } = useQuery({ queryKey: ['categories'], queryFn: categoriesApi.list });
  const { data: attributeLib = [] } = useQuery({ queryKey: ['attributes'], queryFn: () => attributesApi.list() });

  const [productTypeId, setProductTypeId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [attrs, setAttrs] = useState<{ attributeId: string; value: string }[]>([]);

  const apply = async () => {
    const attributes = attrs.filter((a) => a.attributeId && a.value.trim());
    if (!productTypeId && !categoryId && attributes.length === 0) {
      toast.error('Set at least one field to apply');
      return;
    }
    setBusy(true);
    try {
      await productsApi.bulkUpdate({
        ids,
        ...(productTypeId ? { productTypeId } : {}),
        ...(categoryId ? { categoryId } : {}),
        ...(attributes.length ? { attributes } : {}),
      });
      toast.success(`Updated ${ids.length} products`);
      onDone();
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Bulk update failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell open title={`Bulk edit ${ids.length} products`} primaryLabel="Apply to selected" onPrimary={apply} busy={busy} onClose={onClose}>
      <div className="flex flex-col gap-5">
        <div>
          <label className="label">Product type</label>
          <select className="input" value={productTypeId} onChange={(e) => setProductTypeId(e.target.value)}>
            <option value="">— leave unchanged —</option>
            {ptypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Category</label>
          <select className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">— leave unchanged —</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Attributes to add/set</label>
          <div className="flex flex-col gap-2">
            {attrs.map((a, i) => {
              const def = attributeLib.find((x) => x.id === a.attributeId);
              return (
                <div key={i} className="flex items-center gap-2">
                  <select className="input w-48" value={a.attributeId} onChange={(e) => setAttrs((r) => r.map((x, idx) => idx === i ? { ...x, attributeId: e.target.value, value: '' } : x))}>
                    <option value="">Attribute…</option>
                    {attributeLib.map((lib) => <option key={lib.id} value={lib.id}>{lib.name}</option>)}
                  </select>
                  {def?.inputType === 'predefined' ? (
                    <select className="input mono flex-1" value={a.value} onChange={(e) => setAttrs((r) => r.map((x, idx) => idx === i ? { ...x, value: e.target.value } : x))}>
                      <option value="">Value…</option>
                      {def.values.map((v) => <option key={v.id} value={v.value}>{v.value}</option>)}
                    </select>
                  ) : (
                    <input className="input mono flex-1" placeholder="Value" value={a.value} onChange={(e) => setAttrs((r) => r.map((x, idx) => idx === i ? { ...x, value: e.target.value } : x))} />
                  )}
                  <button className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-md text-n-500 hover:bg-danger-bg hover:text-danger" onClick={() => setAttrs((r) => r.filter((_, idx) => idx !== i))}><Trash2 size={15} /></button>
                </div>
              );
            })}
            <div><button className="btn btn-ghost" onClick={() => setAttrs((r) => [...r, { attributeId: '', value: '' }])}><Plus size={16} /> Add attribute</button></div>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}
