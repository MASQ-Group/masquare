import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ImagePlus, Plus, Star, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ModalShell } from '@masquare/ui';
import {
  attributesApi, brandsApi, categoriesApi, fulfilmentTypesApi, productsApi,
  productTypesApi, vendorsApi,
  type Product, type ProductAlias, type ProductMediaItem, type RefLite,
} from '../../lib/api';
import { RefField } from './RefField';
import { CountrySelect } from '../common/CountrySelect';

interface Props {
  product: Product | null; // null = create
  onClose: () => void;
  onSaved: () => void;
}

const TABS = [
  { key: 'general', label: 'General' },
  { key: 'classification', label: 'Classification' },
  { key: 'identifiers', label: 'Identifiers' },
  { key: 'pricing', label: 'Cost & pricing' },
  { key: 'logistics', label: 'Package & logistics' },
];

const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s));

export function ProductModal({ product, onClose, onSaved }: Props) {
  const [tab, setTab] = useState('general');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const touch = () => setDirty(true);

  const { data: attributeLibrary = [] } = useQuery({ queryKey: ['attributes'], queryFn: () => attributesApi.list() });
  const { data: ftypes = [] } = useQuery({ queryKey: ['fulfilment-types'], queryFn: () => fulfilmentTypesApi.list() });

  const [mainSku, setMainSku] = useState(product?.mainSku ?? '');
  const [title, setTitle] = useState(product?.title ?? '');
  const [brand, setBrand] = useState<RefLite | null>(product?.brand ?? null);
  const [vendor, setVendor] = useState<RefLite | null>(product?.vendor ?? null);
  const [productType, setProductType] = useState<RefLite | null>(product?.productType ?? null);
  const [fulfilmentType, setFulfilmentType] = useState<RefLite | null>(product?.fulfilmentType ?? null);
  const [category, setCategory] = useState<RefLite | null>(product?.category ?? null);

  const [aliases, setAliases] = useState<ProductAlias[]>(product?.aliases ?? []);
  const [attrs, setAttrs] = useState<{ attributeId: string; value: string }[]>(
    product?.attributes.map((a) => ({ attributeId: a.attributeId, value: a.value })) ?? [],
  );

  const [ident, setIdent] = useState({
    ean: product?.ean ?? '', upc: product?.upc ?? '', vendorSku: product?.vendorSku ?? '',
    manufacturerSku: product?.manufacturerSku ?? '', countryOfOrigin: product?.countryOfOrigin ?? '', hsCode: product?.hsCode ?? '',
  });
  const [cost, setCost] = useState({
    purchase: product?.purchaseCost.amount?.toString() ?? '',
    map: product?.map.amount?.toString() ?? '',
    msrp: product?.msrp.amount?.toString() ?? '',
  });
  const [dims, setDims] = useState({
    productWeightKg: product?.productWeightKg?.toString() ?? '',
    packageWeightKg: product?.packageWeightKg?.toString() ?? '',
    packageLengthCm: product?.packageLengthCm?.toString() ?? '',
    packageWidthCm: product?.packageWidthCm?.toString() ?? '',
    packageHeightCm: product?.packageHeightCm?.toString() ?? '',
  });
  const [media, setMedia] = useState<ProductMediaItem[]>(product?.media ?? []);

  const volumetric = useMemo(() => {
    const l = Number(dims.packageLengthCm), w = Number(dims.packageWidthCm), h = Number(dims.packageHeightCm);
    if (!l || !w || !h) return null;
    return Number(((l * w * h) / 5000).toFixed(3));
  }, [dims]);

  const canSave = mainSku.trim().length > 0 && title.trim().length > 0;

  const save = async () => {
    if (!canSave) { setTab('general'); toast.error('Main SKU and title are required'); return; }
    setBusy(true);
    try {
      const body = {
        mainSku, title,
        brandId: brand?.id ?? null, vendorId: vendor?.id ?? null, productTypeId: productType?.id ?? null,
        fulfilmentTypeId: fulfilmentType?.id ?? null, categoryId: category?.id ?? null,
        ean: ident.ean, upc: ident.upc, vendorSku: ident.vendorSku, manufacturerSku: ident.manufacturerSku,
        countryOfOrigin: ident.countryOfOrigin, hsCode: ident.hsCode,
        purchaseCost: { amount: numOrNull(cost.purchase), currency: 'EUR' },
        map: { amount: numOrNull(cost.map), currency: 'EUR' },
        msrp: { amount: numOrNull(cost.msrp), currency: 'EUR' },
        productWeightKg: numOrNull(dims.productWeightKg),
        packageWeightKg: numOrNull(dims.packageWeightKg),
        packageLengthCm: numOrNull(dims.packageLengthCm),
        packageWidthCm: numOrNull(dims.packageWidthCm),
        packageHeightCm: numOrNull(dims.packageHeightCm),
        aliases: aliases.filter((a) => a.skuValue.trim()).map((a) => ({ skuValue: a.skuValue.trim(), label: a.label || undefined, fulfilmentTypeId: a.fulfilmentTypeId || undefined })),
        attributes: attrs.filter((a) => a.attributeId && a.value.trim()),
      };
      if (product) await productsApi.update(product.id, body); else await productsApi.create(body);
      toast.success(product ? 'Product saved' : 'Product created');
      onSaved();
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  // --- media (edit mode only) ---
  const onUpload = async (files: FileList | null) => {
    if (!files || !product) return;
    try {
      let updated: Product | undefined;
      for (const f of Array.from(files)) updated = await productsApi.uploadMedia(product.id, f);
      if (updated) setMedia(updated.media);
      toast.success('Image added');
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Upload failed');
    }
  };
  const removeMedia = async (mediaId: string) => {
    if (!product) return;
    const updated = await productsApi.deleteMedia(product.id, mediaId);
    setMedia(updated.media);
  };
  const makeFeatured = async (mediaId: string) => {
    if (!product) return;
    const ordered = [mediaId, ...media.filter((m) => m.id !== mediaId).map((m) => m.id)];
    const updated = await productsApi.reorderMedia(product.id, ordered);
    setMedia(updated.media);
  };

  return (
    <ModalShell
      open title={product ? 'Edit product' : 'New product'} subtitle={product?.mainSku}
      tabs={TABS} activeTab={tab} onTabChange={setTab} dirty={dirty}
      primaryLabel={product ? 'Save changes' : 'Create product'} onPrimary={save} primaryDisabled={!canSave} busy={busy} onClose={onClose}
    >
      {tab === 'general' && (
        <div className="flex flex-col gap-4">
          {/* Media */}
          <div>
            <label className="label">Images <span className="font-normal text-n-400">(up to 8, first is featured)</span></label>
            {product ? (
              <div className="flex flex-wrap gap-2">
                {media.map((m, i) => (
                  <div key={m.id} className="group relative h-20 w-20 overflow-hidden rounded-md border border-n-200">
                    <img src={m.url} alt="" className="h-full w-full object-cover" />
                    {i === 0 && <span className="absolute left-1 top-1 rounded bg-teal-600 px-1 text-[9px] font-semibold text-white">Featured</span>}
                    <div className="absolute inset-0 hidden items-center justify-center gap-1 bg-black/40 group-hover:flex">
                      {i !== 0 && <button className="grid h-7 w-7 place-items-center rounded bg-white/90 text-n-700" title="Make featured" onClick={() => makeFeatured(m.id)}><Star size={14} /></button>}
                      <button className="grid h-7 w-7 place-items-center rounded bg-white/90 text-danger" title="Remove" onClick={() => removeMedia(m.id)}><Trash2 size={14} /></button>
                    </div>
                  </div>
                ))}
                {media.length < 8 && (
                  <label className="grid h-20 w-20 cursor-pointer place-items-center rounded-md border border-dashed border-n-300 text-n-400 hover:border-teal-400 hover:text-teal-600">
                    <ImagePlus size={20} />
                    <input type="file" accept=".jpg,.jpeg,.png,.webp" multiple className="hidden" onChange={(e) => onUpload(e.target.files)} />
                  </label>
                )}
              </div>
            ) : (
              <p className="rounded-md border border-n-200 bg-n-50 px-3 py-2.5 text-[13px] text-n-500">Create the product first, then add images.</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4 max-[560px]:grid-cols-1">
            <div className="col-span-2"><label className="label">Title *</label><input className="input" value={title} onChange={(e) => { setTitle(e.target.value); touch(); }} /></div>
            <div><label className="label">Main SKU *</label><input className="input mono" value={mainSku} onChange={(e) => { setMainSku(e.target.value); touch(); }} /></div>
            <div><label className="label">Fulfilment type</label><RefField value={fulfilmentType} placeholder="FBA, FBM…" list={(q) => fulfilmentTypesApi.list(q)} create={(name) => fulfilmentTypesApi.create({ name })} createNoun="fulfilment type" onChange={(v) => { setFulfilmentType(v); touch(); }} /></div>
            <div><label className="label">Brand</label><RefField value={brand} placeholder="Brand…" list={(q) => brandsApi.list(q)} create={(name) => brandsApi.create({ name })} createNoun="brand" onChange={(v) => { setBrand(v); touch(); }} /></div>
            <div><label className="label">Vendor</label><RefField value={vendor} placeholder="Vendor…" list={(q) => vendorsApi.list(q)} create={(name) => vendorsApi.create({ name })} createNoun="vendor" onChange={(v) => { setVendor(v); touch(); }} /></div>
            <div><label className="label">Product type</label><RefField value={productType} placeholder="Type…" list={(q) => productTypesApi.list(q)} create={(name) => productTypesApi.create({ name })} createNoun="product type" onChange={(v) => { setProductType(v); touch(); }} /></div>
          </div>

          {/* Aliases */}
          <div>
            <label className="label">Alias SKUs <span className="font-normal text-n-400">(alternate SKUs that resolve to this product)</span></label>
            <div className="flex flex-col gap-2">
              {aliases.length > 0 && (
                <div className="grid grid-cols-[1fr_150px_150px_36px] gap-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-n-500 max-[560px]:hidden">
                  <span>SKU value</span><span>Fulfilment type</span><span>Label</span><span />
                </div>
              )}
              {aliases.map((a, i) => (
                <div key={i} className="grid grid-cols-[1fr_150px_150px_36px] items-center gap-2 max-[560px]:grid-cols-1">
                  <input className="input mono" placeholder="e.g. RE-S8540-FBA" value={a.skuValue} onChange={(e) => { setAliases((r) => r.map((x, idx) => idx === i ? { ...x, skuValue: e.target.value } : x)); touch(); }} />
                  <select className="input" value={a.fulfilmentTypeId ?? ''} onChange={(e) => { setAliases((r) => r.map((x, idx) => idx === i ? { ...x, fulfilmentTypeId: e.target.value || null } : x)); touch(); }}>
                    <option value="">— fulfilment —</option>
                    {ftypes.map((f) => <option key={f.id} value={f.id}>{f.code ?? f.name}</option>)}
                  </select>
                  <input className="input" placeholder="optional tag" value={a.label ?? ''} onChange={(e) => { setAliases((r) => r.map((x, idx) => idx === i ? { ...x, label: e.target.value } : x)); touch(); }} />
                  <button className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-md text-n-500 hover:bg-danger-bg hover:text-danger" onClick={() => { setAliases((r) => r.filter((_, idx) => idx !== i)); touch(); }}><Trash2 size={15} /></button>
                </div>
              ))}
              <div><button className="btn btn-ghost" onClick={() => { setAliases((r) => [...r, { skuValue: '', label: '', fulfilmentTypeId: null }]); touch(); }}><Plus size={16} /> Add alias</button></div>
              <p className="text-[12px] text-n-400"><strong>Fulfilment type</strong> ties an alias to a channel (e.g. an FBA-specific SKU). <strong>Label</strong> is an optional free-text tag for your own reference.</p>
            </div>
          </div>
        </div>
      )}

      {tab === 'classification' && (
        <div className="flex flex-col gap-4">
          <div>
            <label className="label">Category</label>
            <RefField value={category} placeholder="Category…" list={async (q) => (await categoriesApi.list()).filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase())).map((c) => ({ id: c.id, name: c.name }))} create={(name) => categoriesApi.create({ name })} createNoun="category" onChange={(v) => { setCategory(v); touch(); }} />
          </div>
          <div>
            <label className="label">Attributes <span className="font-normal text-n-400">(assigned manually)</span></label>
            <div className="flex flex-col gap-2">
              {attrs.map((a, i) => {
                const def = attributeLibrary.find((x) => x.id === a.attributeId);
                return (
                  <div key={i} className="flex items-center gap-2">
                    <select className="input w-48" value={a.attributeId} onChange={(e) => { setAttrs((r) => r.map((x, idx) => idx === i ? { ...x, attributeId: e.target.value, value: '' } : x)); touch(); }}>
                      <option value="">Attribute…</option>
                      {attributeLibrary.map((lib) => <option key={lib.id} value={lib.id}>{lib.name}</option>)}
                    </select>
                    {def?.inputType === 'predefined' ? (
                      <select className="input mono flex-1" value={a.value} onChange={(e) => { setAttrs((r) => r.map((x, idx) => idx === i ? { ...x, value: e.target.value } : x)); touch(); }}>
                        <option value="">Value…</option>
                        {def.values.map((v) => <option key={v.id} value={v.value}>{v.value}</option>)}
                      </select>
                    ) : (
                      <input className="input mono flex-1" placeholder="Value" value={a.value} onChange={(e) => { setAttrs((r) => r.map((x, idx) => idx === i ? { ...x, value: e.target.value } : x)); touch(); }} />
                    )}
                    <button className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-md text-n-500 hover:bg-danger-bg hover:text-danger" onClick={() => { setAttrs((r) => r.filter((_, idx) => idx !== i)); touch(); }}><Trash2 size={15} /></button>
                  </div>
                );
              })}
              <div><button className="btn btn-ghost" onClick={() => { setAttrs((r) => [...r, { attributeId: '', value: '' }]); touch(); }}><Plus size={16} /> Add attribute</button></div>
            </div>
          </div>
        </div>
      )}

      {tab === 'identifiers' && (
        <div className="grid grid-cols-2 gap-4 max-[560px]:grid-cols-1">
          {([['ean', 'EAN'], ['upc', 'UPC'], ['vendorSku', 'Vendor SKU'], ['manufacturerSku', 'Manufacturer SKU']] as const).map(([key, label]) => (
            <div key={key}><label className="label">{label}</label><input className="input mono" value={(ident as any)[key]} onChange={(e) => { setIdent((s) => ({ ...s, [key]: e.target.value })); touch(); }} /></div>
          ))}
          <div><label className="label">Country of origin</label><CountrySelect value={ident.countryOfOrigin || null} valueKind="code" onChange={(v) => { setIdent((s) => ({ ...s, countryOfOrigin: v ?? '' })); touch(); }} /></div>
          <div><label className="label">HS code</label><input className="input mono" value={ident.hsCode} onChange={(e) => { setIdent((s) => ({ ...s, hsCode: e.target.value })); touch(); }} /></div>
        </div>
      )}

      {tab === 'pricing' && (
        <div className="grid grid-cols-3 gap-4 max-[560px]:grid-cols-1">
          {([['purchase', 'Purchase cost'], ['map', 'MAP (min suggested)'], ['msrp', 'MSRP (max suggested)']] as const).map(([key, label]) => (
            <div key={key}>
              <label className="label">{label}</label>
              <div className="flex items-center gap-1.5">
                <span className="mono text-[13px] text-n-500">€</span>
                <input className="input mono" inputMode="decimal" value={(cost as any)[key]} onChange={(e) => { setCost((s) => ({ ...s, [key]: e.target.value })); touch(); }} placeholder="0.00" />
              </div>
            </div>
          ))}
          <p className="col-span-3 text-[12px] text-n-400">Amounts are stored in EUR. MAP/MSRP together define the suggested retail price band.</p>
        </div>
      )}

      {tab === 'logistics' && (
        <div className="grid grid-cols-2 gap-4 max-[560px]:grid-cols-1">
          <div><label className="label">Product weight (kg)</label><input className="input mono" inputMode="decimal" value={dims.productWeightKg} onChange={(e) => { setDims((s) => ({ ...s, productWeightKg: e.target.value })); touch(); }} /></div>
          <div><label className="label">Package weight (kg)</label><input className="input mono" inputMode="decimal" value={dims.packageWeightKg} onChange={(e) => { setDims((s) => ({ ...s, packageWeightKg: e.target.value })); touch(); }} /></div>
          <div><label className="label">Length (cm)</label><input className="input mono" inputMode="decimal" value={dims.packageLengthCm} onChange={(e) => { setDims((s) => ({ ...s, packageLengthCm: e.target.value })); touch(); }} /></div>
          <div><label className="label">Width (cm)</label><input className="input mono" inputMode="decimal" value={dims.packageWidthCm} onChange={(e) => { setDims((s) => ({ ...s, packageWidthCm: e.target.value })); touch(); }} /></div>
          <div><label className="label">Height (cm)</label><input className="input mono" inputMode="decimal" value={dims.packageHeightCm} onChange={(e) => { setDims((s) => ({ ...s, packageHeightCm: e.target.value })); touch(); }} /></div>
          <div>
            <label className="label">Volumetric weight (kg)</label>
            <input className="input mono bg-n-50" readOnly value={volumetric ?? ''} placeholder="—" />
            <p className="mt-1 text-[12px] text-n-400">Auto = (L × W × H) / 5000</p>
          </div>
        </div>
      )}
    </ModalShell>
  );
}
