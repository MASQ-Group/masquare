import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Check, Copy, Download, FileText, Package } from 'lucide-react';
import { toast } from 'sonner';
import { productsApi } from '../lib/api';
import { PriceCard } from '../components/store/PriceCard';

/**
 * The B2B webstore's product page, rendered inside the platform.
 *
 * The store itself — its customers, their entitlements, their agreed prices — is future work, so
 * this sits behind the platform login and shows what a buyer WOULD see. The layout, the states and
 * the sparse behaviour are the deliverable; where it is mounted is cheap to change later.
 *
 * The governing constraint is that the catalogue is mostly empty: 12% of products have an image,
 * 3% a description. So the sparse page is the primary design and the rich one is the variant — a
 * field with no value renders nothing at all, and the layout closes up rather than showing dashes.
 */
export function StoreProductPreviewPage() {
  const { productId = '' } = useParams();
  const [active, setActive] = useState(0);
  const [tab, setTab] = useState(0);
  const [qty, setQty] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['storefront', productId],
    queryFn: () => productsApi.storefront(productId),
    enabled: !!productId,
  });

  const tabs = useMemo(() => {
    if (!data) return [];
    return [
      data.descriptionHtml || data.keyFeatures.length ? 'Product description' : null,
      data.specifications.length ? 'Specifications' : null,
      data.documents.length ? 'Product files' : null,
    ].filter(Boolean) as string[];
  }, [data]);

  if (isLoading) return <div className="py-24 text-center text-[13px] text-n-400">Loading…</div>;
  if (!data) return <div className="py-24 text-center text-[13px] text-n-500">Product not found.</div>;

  const copySku = () => {
    navigator.clipboard.writeText(data.sku).then(() => toast.success('SKU copied'));
  };

  return (
    <div className="min-h-screen bg-n-50">
      {/* A shell for the store's own header — not part of this scope, but the page is designed to
          sit under one and the spacing reads wrongly without it.

          Not sticky here: previewed inside the platform it pins to the app's scrolling main and
          floats over the chrome above. In the real store it will be the top of the window. */}
      <div className="flex h-14 items-center gap-4 border-b border-n-200 bg-n-0 px-8">
        <span className="text-[15px] font-bold tracking-[-.01em]">
          ma<span className="text-teal-500">Square</span> <span className="font-medium text-n-500">Store</span>
        </span>
        <div className="flex-1" />
        <span className="rounded-pill border border-warning-bd bg-warning-bg px-2 py-1 text-[11.5px] font-semibold text-warning">
          Preview — signed in as staff
        </span>
      </div>

      <div className="mx-auto box-border flex w-full max-w-[1160px] flex-col gap-8 px-8 pb-20 pt-9">
        <div className="text-[12.5px] text-n-500">
          Catalogue
          {data.category && <><span className="px-1.5 text-n-300">/</span><span className="text-n-700">{data.category}</span></>}
        </div>

        <div className="grid grid-cols-[440px_1fr] items-start gap-12 max-[900px]:grid-cols-1 max-[900px]:gap-8">
          {/* --- Media ------------------------------------------------------ */}
          <div className="flex flex-col gap-3">
            {data.images.length > 0 ? (
              <>
                <div className="aspect-square overflow-hidden rounded-lg border border-n-200 bg-n-0">
                  <img src={data.images[active]} alt={data.title} className="h-full w-full object-contain" />
                </div>
                {data.images.length > 1 && (
                  <div className="grid grid-cols-5 gap-2.5">
                    {data.images.map((src, i) => (
                      <button
                        key={src}
                        onClick={() => setActive(i)}
                        className={`aspect-square overflow-hidden rounded-md bg-n-0 ${i === active ? 'border-2 border-teal-500' : 'border border-n-200'}`}
                      >
                        <img src={src} alt="" className="h-full w-full object-contain" />
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <IdentityPlate brand={data.brand} title={data.title} sku={data.sku} />
            )}
          </div>

          {/* --- Summary ---------------------------------------------------- */}
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2.5">
              {data.brand && (
                <div className="text-[12px] font-semibold uppercase tracking-[.09em] text-teal-600">{data.brand}</div>
              )}
              <h1 className="text-[28px] font-semibold leading-[1.3] tracking-[-.02em] text-n-900">{data.title}</h1>
              <div className="flex flex-wrap items-center gap-3.5 text-[13px] text-n-500">
                <span>SKU <span className="mono font-medium text-n-800">{data.sku}</span></span>
                {data.ean && (
                  <>
                    <span className="text-n-200">|</span>
                    <span>EAN <span className="mono font-medium text-n-800">{data.ean}</span></span>
                  </>
                )}
                <button
                  onClick={copySku}
                  title="Copy SKU"
                  className="grid h-[26px] w-[26px] place-items-center rounded-sm border border-n-200 bg-n-0 text-n-500 hover:text-n-800"
                >
                  <Copy size={13} />
                </button>
              </div>
            </div>

            <PriceCard price={data.price} availability={data.availability} qty={qty} onQty={setQty} />

            {data.shortDescription && (
              <div className="rte border-b border-n-100 pb-[18px] text-[14px] leading-[1.65] text-n-600">
                {/* HTML now, like the full description: both are authored in the same editor. */}
                <span dangerouslySetInnerHTML={{ __html: data.shortDescription }} />
                {tabs.includes('Product description') && (
                  <>
                    {' '}
                    <a href="#detail" onClick={() => setTab(tabs.indexOf('Product description'))} className="text-teal-600 hover:text-teal-700">
                      Full description ↓
                    </a>
                  </>
                )}
              </div>
            )}

          </div>
        </div>

        {/* --- Tabs --------------------------------------------------------- */}
        {tabs.length > 0 ? (
          <div id="detail" className="flex flex-col gap-5 pt-2">
            <div className="flex gap-7 border-b border-n-200">
              {tabs.map((label, i) => (
                <button
                  key={label}
                  onClick={() => setTab(i)}
                  className={`px-0.5 pb-3 text-[14px] ${i === tab ? 'font-semibold text-n-800 shadow-[inset_0_-2px_var(--teal-500)]' : 'font-medium text-n-500 hover:text-n-700'}`}
                >
                  {label}
                </button>
              ))}
            </div>

            {tabs[tab] === 'Product description' && (
              <div className="grid grid-cols-[1fr_320px] items-start gap-12 max-[900px]:grid-cols-1">
                {data.descriptionHtml && (
                  <div
                    className="flex flex-col gap-3 text-[14px] leading-[1.7] text-n-700"
                    // Author-controlled copy from the product card, the same text the marketplaces get.
                    dangerouslySetInnerHTML={{ __html: data.descriptionHtml }}
                  />
                )}
                {data.keyFeatures.length > 0 && (
                  <div className="flex flex-col gap-2.5 rounded-lg border border-n-200 bg-n-0 p-[18px_22px]">
                    <div className="text-[11px] font-semibold uppercase tracking-[.09em] text-n-500">Key features</div>
                    {data.keyFeatures.map((f) => (
                      <div key={f} className="flex gap-2.5 text-[13.5px] leading-[1.5] text-n-700">
                        <Check size={15} className="shrink-0 text-teal-500" />{f}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {tabs[tab] === 'Specifications' && (
              /* Grouped rather than one long run: twelve flat rows make a buyer read all of them to
                 find the one they came for. Groups stay in a fixed order across products, so the
                 same fact is always in the same place. */
              <div className="grid grid-cols-2 items-start gap-x-12 gap-y-7 max-[900px]:grid-cols-1">
                {data.specifications.map((g) => (
                  <div key={g.group} className="flex flex-col">
                    {/* Darker and ruled rather than coloured. The accent is already carrying the
                        brand eyebrow, the price, the active tab and the feature ticks — a fifth use
                        would spend it on structure, which is what weight and a rule are for. */}
                    <div className="mb-1 border-b-2 border-n-200 pb-1.5 text-[11.5px] font-semibold uppercase tracking-[.09em] text-n-800">
                      {g.group}
                    </div>
                    {g.rows.map((sRow) => (
                      <div key={sRow.label} className="grid grid-cols-[200px_1fr] border-b border-n-100 px-0.5 py-[11px] text-[13.5px]">
                        <span className="text-n-500">{sRow.label}</span>
                        <span className={sRow.mono ? 'mono text-[13px]' : ''}>{sRow.value}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}

            {tabs[tab] === 'Product files' && (
              <div className="grid grid-cols-3 gap-3.5 max-[900px]:grid-cols-1">
                {data.documents.map((d) => (
                  <div key={d.id} className="flex cursor-pointer items-center gap-3 rounded-md border border-n-200 bg-n-0 px-4 py-3.5 hover:border-teal-200">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-teal-50 text-[10px] font-semibold text-teal-800">PDF</span>
                    <div className="flex min-w-0 flex-1 flex-col gap-px">
                      <span className="truncate text-[13.5px] font-medium text-n-900">{d.name}</span>
                      <span className="mono text-[11.5px] text-n-400">PDF{d.sizeBytes ? ` · ${fileSize(d.sizeBytes)}` : ''}</span>
                    </div>
                    <Download size={16} className="shrink-0 text-n-500" />
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* Nothing to put in tabs. Rather than an empty strip, say what is missing and offer the
             one action a buyer would want — which is also the nudge that gets the catalogue filled. */
          <div className="rounded-lg border border-dashed border-n-200 px-6 py-8 text-center">
            <Package size={20} className="mx-auto mb-2 text-n-300" />
            <div className="text-[13.5px] text-n-600">
              Need the full specification or images? We&rsquo;ll attach them within one working day.
            </div>
            <button className="mt-3 inline-flex h-9 items-center rounded-md border border-n-200 bg-n-0 px-4 text-[13px] font-semibold text-n-700 hover:border-teal-300 hover:text-teal-700">
              Request spec sheet
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const fileSize = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/**
 * What stands where the photograph would be, for the 88% of products that have none.
 *
 * Built only from data that always exists — brand, a fragment of the title, the SKU — so it is
 * never empty and never a broken-image box. Deterministic: the same product always draws the same
 * plate, so it reads as this product's mark rather than as a placeholder.
 */
function IdentityPlate({ brand, title, sku }: { brand: string | null; title: string; sku: string }) {
  // The model fragment: the first token carrying a digit is almost always the model number, which
  // is what a trade buyer recognises. Falling back to the opening word beats showing nothing.
  const model = useMemo(() => {
    const tokens = title.split(/[\s,]+/).filter(Boolean);
    return (tokens.find((t) => /\d/.test(t) && t.length <= 14) ?? tokens[0] ?? sku).toUpperCase();
  }, [title, sku]);

  return (
    <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-lg border border-n-200 bg-[linear-gradient(160deg,var(--teal-50),var(--n-50)_55%,var(--n-100))]">
      {brand && (
        <span className="absolute left-5 top-[18px] text-[11px] font-semibold uppercase tracking-[.09em] text-teal-200">{brand}</span>
      )}
      <span className="mono px-6 text-center text-[46px] font-semibold leading-none tracking-[-.02em] text-teal-800 opacity-[.85] max-[520px]:text-[32px]">
        {model}
      </span>
      <span className="mono absolute bottom-[18px] left-5 text-[12.5px] text-teal-300">{sku}</span>
      <FileText className="absolute -bottom-8 -right-8 text-teal-800 opacity-10" size={220} strokeWidth={1} />
    </div>
  );
}
