import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ImagePlus, Plus, Star, Trash2, X, Store } from 'lucide-react';
import { toast } from 'sonner';
import { CostHistory } from './CostHistory';
import { ProductStockSection } from './ProductStockSection';
import { ProductChannelIdentifiers } from './ProductChannelIdentifiers';
import { ProductChannelsTab } from './ProductChannelsTab';
import { ProductHistoryTab } from './ProductHistoryTab';
import { ProductDocuments } from './ProductDocuments';
import { RichTextEditor } from '../common/RichTextEditor';
import { FeatureList } from './FeatureList';
import { FileDrop, ModalShell, Select } from '@masquare/ui';
import {
  attributesApi, brandsApi, categoriesApi, complianceOptionsApi, fulfilmentTypesApi, productClassesApi, productsApi,
  productTypesApi, vatClassesApi, vendorsApi,
  type Attribute, type Product, type ProductAlias, type ProductDocumentItem, type ProductMediaItem, type RefLite,
} from '../../lib/api';
import { categoryOptions } from '../../lib/categoryPaths';
import { RefField } from './RefField';
import { CountrySelect } from '../common/CountrySelect';

interface Props {
  product: Product | null; // null = create
  onClose: () => void;
  onSaved: () => void;
}

// The first five are what the business runs on daily and are deliberately left alone. Content and
// Compliance are what the sales channels need — a different kind of data, on a different rhythm.
const TABS = [
  { key: 'general', label: 'General' },
  { key: 'classification', label: 'Classification' },
  { key: 'identifiers', label: 'Identifiers' },
  { key: 'pricing', label: 'Cost & pricing' },
  { key: 'logistics', label: 'Package & logistics' },
  { key: 'content', label: 'Content' },
  { key: 'compliance', label: 'Compliance' },
];
// Stock levels and channel plans only mean anything for a saved product, so both appear in edit
// mode only — there is no product id to hang them on until then.
const STOCK_TAB = { key: 'stock', label: 'Stock levels' };
const CHANNELS_TAB = { key: 'channels', label: 'Channels' };
// Last, and edit-only: a product being created has no history, and the tab is for looking back
// rather than for filling anything in.
const HISTORY_TAB = { key: 'history', label: 'History' };

const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s));

export function ProductModal({ product, onClose, onSaved }: Props) {
  const [costHistoryOpen, setCostHistoryOpen] = useState(false);
  const [serialTracked, setSerialTracked] = useState(product?.serialTracked ?? false);
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
  const [productClass, setProductClass] = useState<RefLite | null>(product?.productClass ?? null);
  const [vatClass, setVatClass] = useState<RefLite | null>(
    product?.vatClass ? { id: product.vatClass.id, name: product.vatClass.name, code: `${product.vatClass.ratePct}%` } : null,
  );

  const [aliases, setAliases] = useState<ProductAlias[]>(product?.aliases ?? []);
  // One row per attribute, holding all its values — a multi-value attribute is edited in a
  // single row instead of being added once per value.
  const [attrs, setAttrs] = useState<{ attributeId: string; values: string[] }[]>(() => groupAttributes(product?.attributes));

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
  const [documents, setDocuments] = useState<ProductDocumentItem[]>(product?.documents ?? []);

  // Listing copy. Amazon and OnBuy never display any of it — they carry our offer against their
  // own catalogue entry — so this is eBay and Shopify only.
  const [content, setContent] = useState({
    ebayTitle: product?.ebayTitle ?? '',
    shortDescription: product?.shortDescription ?? '',
    descriptionHtml: product?.descriptionHtml ?? '',
    searchKeywords: product?.searchKeywords ?? '',
  });
  // One row per feature rather than a textarea: bullets are an ordered list, and a list edited as
  // prose loses its order the moment anyone reflows it.
  const [features, setFeatures] = useState<string[]>(product?.keyFeatures ?? []);

  // Typed rather than free text: the channel-eligibility rules have to read these without parsing
  // prose, and "220-240V ~50Hz" sitting in a text attribute is not readable.
  const [tech, setTech] = useState({
    voltageRatingId: product?.voltageRatingId ?? '',
    frequencyId: product?.frequencyId ?? '',
    plugTypeId: product?.plugTypeId ?? '',
    batteryRequired: product?.batteryRequired ?? false,
    batteryTypeId: product?.batteryTypeId ?? '',
    hazmatClassId: product?.hazmatClassId ?? '',
    warrantyText: product?.warrantyText ?? '',
    dangerousGoodsNote: product?.dangerousGoodsNote ?? '',
  });

  // The whole vocabulary in one request; it is small, static and shared by six fields.
  const { data: complianceOptions = [] } = useQuery({
    queryKey: ['compliance-options'],
    queryFn: () => complianceOptionsApi.list(),
  });
  const optionsFor = (kind: string) => [
    { value: '', label: 'Not stated' },
    ...complianceOptions.filter((o) => o.kind === kind).map((o) => ({ value: o.id, label: o.label })),
  ];

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
        vatClassId: vatClass?.id ?? null,
        serialTracked,
        productClassId: productClass?.id ?? null,
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
        ebayTitle: content.ebayTitle.trim() || null,
        shortDescription: content.shortDescription.trim() || null,
        descriptionHtml: content.descriptionHtml.trim() || null,
        keyFeatures: features.map((f) => f.trim()).filter(Boolean),
        searchKeywords: content.searchKeywords.trim() || null,
        voltageRatingId: tech.voltageRatingId || null,
        frequencyId: tech.frequencyId || null,
        plugTypeId: tech.plugTypeId || null,
        batteryRequired: tech.batteryRequired,
        batteryTypeId: tech.batteryTypeId || null,
        hazmatClassId: tech.hazmatClassId || null,
        warrantyText: tech.warrantyText.trim() || null,
        dangerousGoodsNote: tech.dangerousGoodsNote.trim() || null,
        aliases: aliases.filter((a) => a.skuValue.trim()).map((a) => ({ skuValue: a.skuValue.trim(), label: a.label || undefined, fulfilmentTypeId: a.fulfilmentTypeId || undefined })),
        attributes: attrs
          .filter((a) => a.attributeId)
          .flatMap((a) => a.values.map((v) => v.trim()).filter(Boolean).map((value) => ({ attributeId: a.attributeId, value }))),
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
      tabs={product ? [...TABS, STOCK_TAB, CHANNELS_TAB, HISTORY_TAB] : TABS} activeTab={tab} onTabChange={setTab} dirty={dirty}
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
                  <FileDrop
                    accept=".jpg,.jpeg,.png,.webp"
                    multiple
                    onFiles={(files) => {
                      // onUpload takes a FileList; rebuild one so dropped and browsed files
                      // travel the same path.
                      const dt = new DataTransfer();
                      for (const f of files) dt.items.add(f);
                      onUpload(dt.files);
                    }}
                  >
                    {({ dragging }) => (
                      <div className={`grid h-20 w-20 place-items-center rounded-md border border-dashed transition-colors ${dragging ? 'border-teal-400 bg-teal-50 text-teal-600' : 'border-n-300 text-n-400 hover:border-teal-400 hover:text-teal-600'}`}>
                        <ImagePlus size={20} />
                      </div>
                    )}
                  </FileDrop>
                )}
              </div>
            ) : (
              <p className="rounded-md border border-n-200 bg-n-50 px-3 py-2.5 text-[13px] text-n-500">Create the product first, then add images.</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4 max-[560px]:grid-cols-1">
            <div className="col-span-2"><label className="label">Title *</label><input className="input" value={title} onChange={(e) => { setTitle(e.target.value); touch(); }} /></div>
            <div><label className="label">Main SKU *</label><input className="input code" value={mainSku} onChange={(e) => { setMainSku(e.target.value); touch(); }} /></div>
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
                  <input className="input code" placeholder="e.g. RE-S8540-FBA" value={a.skuValue} onChange={(e) => { setAliases((r) => r.map((x, idx) => idx === i ? { ...x, skuValue: e.target.value } : x)); touch(); }} />
                  <Select value={a.fulfilmentTypeId ?? ''} placeholder="— fulfilment —"
                    onChange={(v) => { setAliases((r) => r.map((x, idx) => idx === i ? { ...x, fulfilmentTypeId: v || null } : x)); touch(); }}
                    options={ftypes.map((f) => ({ value: f.id, label: f.code ?? f.name }))} />
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
            <label className="label">Product class</label>
            <div className="max-w-[280px]">
              <RefField
                value={productClass}
                placeholder="Product class…"
                list={(q) => productClassesApi.list(q)}
                onChange={(v) => { setProductClass(v); touch(); }}
              />
            </div>
            <p className="mt-1.5 text-[12px] text-n-400">Equipment or Service. Manage the list in Global settings → Product Classes.</p>
          </div>
          <div>
            <label className="label">Category</label>
            {/* Full paths, not bare names: leaf names repeat across the tree ("Filters", "Sets"),
                so a list of names alone offers the same label several times. */}
            <RefField value={category} placeholder="Category…" list={async (q) => categoryOptions(await categoriesApi.list()).filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase())).map((c) => ({ id: c.id, name: c.name }))} create={(name) => categoriesApi.create({ name })} createNoun="category" onChange={(v) => { setCategory(v); touch(); }} />
          </div>
          <div>
            <label className="label">Attributes <span className="font-normal text-n-400">(assigned manually)</span></label>
            <div className="flex flex-col gap-2">
              {attrs.map((a, i) => {
                const def = attributeLibrary.find((x) => x.id === a.attributeId);
                const setValues = (values: string[]) => { setAttrs((r) => r.map((x, idx) => idx === i ? { ...x, values } : x)); touch(); };
                return (
                  <div key={i} className="flex items-start gap-2">
                    <Select className="w-48" value={a.attributeId} placeholder="Attribute…"
                      onChange={(v) => { setAttrs((r) => r.map((x, idx) => idx === i ? { attributeId: v, values: [] } : x)); touch(); }}
                      options={attributeLibrary
                        // Each attribute occupies a single row (a multi-value one holds all its
                        // values), so don't offer an attribute already assigned on another row.
                        .filter((lib) => lib.id === a.attributeId || !attrs.some((x, xi) => xi !== i && x.attributeId === lib.id))
                        .map((lib) => ({ value: lib.id, label: lib.name }))} />
                    <div className="flex-1">
                      {!def ? (
                        <input className="input mono" placeholder="Value…" disabled value="" />
                      ) : def.allowMultiple ? (
                        <MultiValueEditor def={def} values={a.values} onChange={setValues} />
                      ) : def.inputType === 'predefined' ? (
                        <Select className="mono" value={a.values[0] ?? ''} placeholder="Value…"
                          onChange={(v) => setValues([v])}
                          options={def.values.map((v) => ({ value: v.value, label: v.value }))} />
                      ) : (
                        <input className="input mono" placeholder="Value" value={a.values[0] ?? ''} onChange={(e) => setValues([e.target.value])} />
                      )}
                    </div>
                    <button className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-md text-n-500 hover:bg-danger-bg hover:text-danger" onClick={() => { setAttrs((r) => r.filter((_, idx) => idx !== i)); touch(); }}><Trash2 size={15} /></button>
                  </div>
                );
              })}
              <div><button className="btn btn-ghost" onClick={() => { setAttrs((r) => [...r, { attributeId: '', values: [] }]); touch(); }}><Plus size={16} /> Add attribute</button></div>
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
          {product && <ProductChannelIdentifiers productId={product.id} />}
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
          <div className="col-span-3 border-t border-n-100 pt-4">
            <label className="flex cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-[var(--teal-500)]"
                checked={serialTracked}
                onChange={(e) => { setSerialTracked(e.target.checked); touch(); }}
              />
              <span>
                <span className="block text-[13px] font-semibold text-n-800">Track individual units by serial number</span>
                <span className="block text-[12px] text-n-500">
                  Receiving will require one serial per unit, and a sale cannot be submitted without naming which units
                  leave. Selling a tracked product also deducts it from stock.
                </span>
              </span>
            </label>
          </div>

          <div className="col-span-3 border-t border-n-100 pt-4">
            <label className="label">VAT class</label>
            <div className="max-w-[280px]">
              <RefField
                value={vatClass}
                placeholder="VAT class…"
                list={async (q) => (await vatClassesApi.list(q)).map((v) => ({ id: v.id, name: v.name, code: `${v.ratePct}%` }))}
                onChange={(v) => { setVatClass(v); touch(); }}
              />
            </div>
            <p className="mt-1.5 text-[12px] text-n-400">
              Used as the default VAT rate when this product is sold locally. Manage the list in Global settings → VAT Classes.
            </p>
          </div>
          {/* Average cost is produced by receiving, never typed — showing it read-only next
              to the catalogue cost makes the difference between the two obvious. */}
          <div className="col-span-3 border-t border-n-100 pt-4">
            <div className="flex items-baseline justify-between">
              <label className="label">Average cost (landed)</label>
              {product && (
                <button
                  type="button"
                  className="text-[12px] font-semibold text-teal-700 hover:text-teal-800"
                  onClick={() => setCostHistoryOpen((v) => !v)}
                >
                  {costHistoryOpen ? 'Hide history' : 'View history'}
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="mono text-[18px] font-bold text-n-900">
                {product?.averageCostEur != null ? `€${product.averageCostEur.toFixed(2)}` : '—'}
              </span>
              <span className="text-[12px] text-n-500">
                {product?.averageCostEur != null
                  ? `over ${product.averageCostQty} unit${product.averageCostQty === 1 ? '' : 's'}`
                  : 'Not costed yet — set when this product is first received.'}
              </span>
            </div>
            <p className="mt-1.5 text-[12px] text-n-400">
              Weighted average of what the stock actually cost to land, including its share of shipping, duty and
              handling. Maintained by goods receipts — it cannot be edited here.
            </p>
            {costHistoryOpen && product && <CostHistory productId={product.id} />}
          </div>

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

      {tab === 'content' && (
        <div className="flex flex-col gap-4">
          <p className="text-[12.5px] text-n-500">
            Only eBay shows any of this. Amazon and OnBuy attach our offer to their own catalogue entry and
            never display our copy.
          </p>
          <div>
            <label className="label">eBay title</label>
            <input
              className="input"
              maxLength={80}
              value={content.ebayTitle}
              onChange={(e) => { setContent((s) => ({ ...s, ebayTitle: e.target.value })); touch(); }}
              placeholder="Search-optimised, English"
            />
            {/* eBay rejects anything longer, so the limit is shown rather than discovered. */}
            <p className="mt-1 text-[12px] text-n-400">{content.ebayTitle.length}/80 characters</p>
          </div>
          {/* The copy on this tab is what the store page shows, so the preview belongs beside it
              rather than only back on the list. Edit mode only — there is nothing to preview until
              the product exists. */}
          {product && (
            <a
              href={`/store-preview/product/${product.id}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex w-fit items-center gap-1.5 text-[12.5px] font-semibold text-teal-600 hover:text-teal-700"
            >
              <Store size={14} /> Preview the store page
            </a>
          )}
          <div>
            <label className="label">Short description</label>
            {/* Deliberately short and plain: it sits under the price on the B2B store, where a buyer
                is deciding in seconds. Two sentences, no markup. */}
            <RichTextEditor
              minHeight={72}
              value={content.shortDescription}
              onChange={(html) => { setContent((s) => ({ ...s, shortDescription: html })); touch(); }}
              placeholder="One or two sentences — what this is, for a buyer deciding in seconds."
            />
          </div>
          <div>
            <label className="label">Description</label>
            <RichTextEditor
              value={content.descriptionHtml}
              onChange={(html) => { setContent((s) => ({ ...s, descriptionHtml: html })); touch(); }}
              placeholder="Full description shown on the listing page."
            />
          </div>
          <FeatureList value={features} onChange={(next) => { setFeatures(next); touch(); }} />
          {/* Documents hang off a saved product, like images: there is no id to attach them to
              until the product exists, and they upload immediately rather than on save. */}
          {product && <ProductDocuments productId={product.id} value={documents} onChange={setDocuments} />}
          <div>
            <label className="label">Search keywords</label>
            <input className="input" value={content.searchKeywords} onChange={(e) => { setContent((s) => ({ ...s, searchKeywords: e.target.value })); touch(); }} placeholder="Comma separated" />
          </div>
        </div>
      )}

      {tab === 'compliance' && (
        <div className="flex flex-col gap-5">
          <div>
            <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-n-500">Technical facts</h4>
            <p className="mb-3 text-[12.5px] text-n-500">
              Chosen from fixed lists, never typed — these are compared by machine, and an answer that varies
              with who filled it in cannot be. Pick a 220–240V rating and the product is blocked from the US,
              Canada, Mexico and Japan automatically. Add missing values under Settings → Compliance values.
            </p>
            <div className="grid grid-cols-2 gap-4 max-[560px]:grid-cols-1">
              <div>
                <label className="label">Voltage rating</label>
                <Select searchable value={tech.voltageRatingId} onChange={(v) => { setTech((s) => ({ ...s, voltageRatingId: v })); touch(); }}
                  placeholder="Not stated" options={optionsFor('VOLTAGE_RATING')} />
              </div>
              <div>
                <label className="label">Frequency</label>
                <Select searchable value={tech.frequencyId} onChange={(v) => { setTech((s) => ({ ...s, frequencyId: v })); touch(); }}
                  placeholder="Not stated" options={optionsFor('FREQUENCY')} />
              </div>
              <div>
                <label className="label">Plug type</label>
                <Select searchable value={tech.plugTypeId} onChange={(v) => { setTech((s) => ({ ...s, plugTypeId: v })); touch(); }}
                  placeholder="Not stated" options={optionsFor('PLUG_TYPE')} />
              </div>
              <div>
                <label className="label">Battery type</label>
                <Select searchable value={tech.batteryTypeId} onChange={(v) => { setTech((s) => ({ ...s, batteryTypeId: v })); touch(); }}
                  placeholder="Not stated" options={optionsFor('BATTERY_TYPE')} />
              </div>
              <div>
                <label className="label">Battery</label>
                <label className="flex h-9 cursor-pointer items-center gap-2 text-[13px] text-n-700">
                  <input type="checkbox" className="h-4 w-4 accent-[var(--teal-500)]" checked={tech.batteryRequired} onChange={(e) => { setTech((s) => ({ ...s, batteryRequired: e.target.checked })); touch(); }} />
                  Contains or requires a battery
                </label>
              </div>
              <div>
                <label className="label">Dangerous goods class</label>
                <Select searchable value={tech.hazmatClassId} onChange={(v) => { setTech((s) => ({ ...s, hazmatClassId: v })); touch(); }}
                  placeholder="Not stated" options={optionsFor('HAZMAT_CLASS')} />
              </div>
            </div>
          </div>

          <div>
            <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-n-500">Warranty &amp; safety</h4>
            <div className="flex flex-col gap-4">
              <div><label className="label">Warranty</label><input className="input" value={tech.warrantyText} onChange={(e) => { setTech((s) => ({ ...s, warrantyText: e.target.value })); touch(); }} placeholder="e.g. 2-year manufacturer warranty" /></div>
              <div>
                <label className="label">Dangerous goods note</label>
                <textarea className="input min-h-[72px] py-2" value={tech.dangerousGoodsNote} onChange={(e) => { setTech((s) => ({ ...s, dangerousGoodsNote: e.target.value })); touch(); }} placeholder="Anything the class above does not capture — storage or transport restrictions" />
              </div>
            </div>
          </div>

          {/* Manufacturer and EU responsible person describe a company, not a product — they live on
              the brand so one edit covers every line that brand sells. */}
          <div className="rounded-lg border border-n-200 bg-n-25 px-3.5 py-3 text-[12.5px] text-n-600">
            <span className="font-semibold text-n-800">Manufacturer and EU responsible person</span> are held on the
            brand{brand ? <> — edit them on <b>{brand.name}</b> under Settings &rarr; Brands</> : ', so set this product’s brand first'}.
            No channel demands them of us today; GPSR would make them required for EU listings.
          </div>
        </div>
      )}

      {tab === 'stock' && product && <ProductStockSection productId={product.id} />}
      {tab === 'channels' && product && <ProductChannelsTab productId={product.id} />}
      {tab === 'history' && product && <ProductHistoryTab productId={product.id} />}
    </ModalShell>
  );
}

/** Collapse a product's stored attributes (one row per value) into one row per attribute,
 *  gathering that attribute's values — so a multi-value attribute is edited as a single row. */
function groupAttributes(rows?: { attributeId: string; value: string }[]): { attributeId: string; values: string[] }[] {
  const out: { attributeId: string; values: string[] }[] = [];
  const idx = new Map<string, number>();
  for (const a of rows ?? []) {
    if (!idx.has(a.attributeId)) { idx.set(a.attributeId, out.length); out.push({ attributeId: a.attributeId, values: [] }); }
    out[idx.get(a.attributeId)!].values.push(a.value);
  }
  return out;
}

/** Editor for an attribute that allows several values on one SKU: shows the chosen values as
 *  removable chips, plus a picker (predefined) or a text field (free text) to add more. */
function MultiValueEditor({ def, values, onChange }: { def: Attribute; values: string[]; onChange: (values: string[]) => void }) {
  const [text, setText] = useState('');
  const has = (v: string) => values.some((x) => x.toLowerCase() === v.trim().toLowerCase());
  const add = (v: string) => { const t = v.trim(); if (t && !has(t)) onChange([...values, t]); };
  const remove = (v: string) => onChange(values.filter((x) => x !== v));
  const remaining = def.values.filter((o) => !has(o.value));
  return (
    <div className="rounded-md border border-n-200 bg-n-0 p-1.5">
      {values.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {values.map((v) => (
            <span key={v} className="mono inline-flex items-center gap-1 rounded bg-n-100 px-2 py-0.5 text-[12px] text-n-700">
              {v}
              <button type="button" className="text-n-400 hover:text-danger" onClick={() => remove(v)}><X size={12} /></button>
            </span>
          ))}
        </div>
      )}
      {def.inputType === 'predefined' ? (
        <Select className="mono" value="" disabled={remaining.length === 0}
          placeholder={remaining.length ? 'Add a value…' : 'All values added'}
          onChange={(v) => add(v)}
          options={remaining.map((o) => ({ value: o.value, label: o.value }))} />
      ) : (
        <div className="flex items-center gap-1.5">
          <input className="input mono flex-1" placeholder="Type a value, Enter to add" value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(text); setText(''); } }} />
          <button type="button" className="btn btn-ghost flex-shrink-0" onClick={() => { add(text); setText(''); }}><Plus size={15} /> Add</button>
        </div>
      )}
    </div>
  );
}
