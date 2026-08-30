import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ModalShell, Select } from '@masquare/ui';
import { attributesApi, brandsApi, categoriesApi, fulfilmentTypesApi, productClassesApi, productsApi, productTypesApi, vatClassesApi, vendorsApi } from '../../lib/api';
import { categoryOptions } from '../../lib/categoryPaths';

interface Props {
  ids: string[];
  onClose: () => void;
  onDone: () => void;
}

/** Apply Brand / Vendor / Fulfilment Type / Product Type / Category / VAT class / Attributes
 *  to the selected products in one pass. Only the sections you fill are applied. */
export function BulkEditModal({ ids, onClose, onDone }: Props) {
  const [busy, setBusy] = useState(false);
  const { data: brands = [] } = useQuery({ queryKey: ['brands'], queryFn: () => brandsApi.list() });
  const { data: vendors = [] } = useQuery({ queryKey: ['vendors'], queryFn: () => vendorsApi.list() });
  const { data: ftypes = [] } = useQuery({ queryKey: ['fulfilment-types'], queryFn: () => fulfilmentTypesApi.list() });
  const { data: ptypes = [] } = useQuery({ queryKey: ['product-types'], queryFn: () => productTypesApi.list() });
  const { data: categories = [] } = useQuery({ queryKey: ['categories'], queryFn: categoriesApi.list });
  const { data: attributeLib = [] } = useQuery({ queryKey: ['attributes'], queryFn: () => attributesApi.list() });
  const { data: vatClasses = [] } = useQuery({ queryKey: ['vat-classes'], queryFn: () => vatClassesApi.list() });
  const { data: productClasses = [] } = useQuery({ queryKey: ['product-classes'], queryFn: () => productClassesApi.list() });

  const [brandId, setBrandId] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [fulfilmentTypeId, setFulfilmentTypeId] = useState('');
  const [productTypeId, setProductTypeId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [vatClassId, setVatClassId] = useState('');
  const [productClassId, setProductClassId] = useState('');
  const [attrs, setAttrs] = useState<{ attributeId: string; value: string }[]>([]);

  const apply = async () => {
    const attributes = attrs.filter((a) => a.attributeId && a.value.trim());
    if (!brandId && !vendorId && !fulfilmentTypeId && !productTypeId && !categoryId && !vatClassId && !productClassId && attributes.length === 0) {
      toast.error('Set at least one field to apply');
      return;
    }
    setBusy(true);
    try {
      await productsApi.bulkUpdate({
        ids,
        ...(brandId ? { brandId } : {}),
        ...(vendorId ? { vendorId } : {}),
        ...(fulfilmentTypeId ? { fulfilmentTypeId } : {}),
        ...(productTypeId ? { productTypeId } : {}),
        ...(categoryId ? { categoryId } : {}),
        ...(vatClassId ? { vatClassId } : {}),
        ...(productClassId ? { productClassId } : {}),
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
          <label className="label">Brand</label>
          <Select value={brandId} onChange={setBrandId} placeholder="— leave unchanged —"
            options={brands.map((b) => ({ value: b.id, label: b.name }))} />
        </div>
        <div>
          <label className="label">Vendor</label>
          <Select value={vendorId} onChange={setVendorId} placeholder="— leave unchanged —"
            options={vendors.map((v) => ({ value: v.id, label: v.name }))} />
        </div>
        <div>
          <label className="label">Fulfilment type</label>
          <Select value={fulfilmentTypeId} onChange={setFulfilmentTypeId} placeholder="— leave unchanged —"
            options={ftypes.map((t) => ({ value: t.id, label: t.name }))} />
        </div>
        <div>
          <label className="label">Product type</label>
          <Select value={productTypeId} onChange={setProductTypeId} placeholder="— leave unchanged —"
            options={ptypes.map((t) => ({ value: t.id, label: t.name }))} />
        </div>
        <div>
          <label className="label">Category</label>
          <Select value={categoryId} onChange={setCategoryId} placeholder="— leave unchanged —"
            options={categoryOptions(categories).map((c) => ({ value: c.id, label: c.name }))} />
        </div>
        <div>
          <label className="label">Product class</label>
          <Select value={productClassId} onChange={setProductClassId} placeholder="— leave unchanged —"
            options={productClasses.map((c) => ({ value: c.id, label: c.name }))} />
        </div>
        <div>
          <label className="label">VAT class</label>
          <Select value={vatClassId} onChange={setVatClassId} placeholder="— leave unchanged —"
            options={vatClasses.map((v) => ({ value: v.id, label: `${v.name} (${v.ratePct}%)` }))} />
        </div>
        <div>
          <label className="label">Attributes to add/set</label>
          <div className="flex flex-col gap-2">
            {attrs.map((a, i) => {
              const def = attributeLib.find((x) => x.id === a.attributeId);
              return (
                <div key={i} className="flex items-center gap-2">
                  <Select className="w-48" value={a.attributeId} placeholder="Attribute…"
                    onChange={(v) => setAttrs((r) => r.map((x, idx) => idx === i ? { ...x, attributeId: v, value: '' } : x))}
                    options={attributeLib.map((lib) => ({ value: lib.id, label: lib.name }))} />
                  {def?.inputType === 'predefined' ? (
                    <Select className="flex-1 mono" value={a.value} placeholder="Value…"
                      onChange={(v) => setAttrs((r) => r.map((x, idx) => idx === i ? { ...x, value: v } : x))}
                      options={def.values.map((v) => ({ value: v.value, label: v.value }))} />
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
