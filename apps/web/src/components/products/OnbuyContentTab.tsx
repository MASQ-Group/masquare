import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, ClipboardCopy, ExternalLink, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { listingApi, onbuyContentApi, type OnbuyContentField, type OnbuyContentView, type OnbuySafety } from '../../lib/api';
import { OnbuyCreateCategory } from './OnbuyListing';
import { Provenance } from './EbayCategoryPicker';
import { RichTextEditor } from '../common/RichTextEditor';
import { FeatureList } from './FeatureList';

/** OnBuy's own limits: a 150-character title (about 70 recommended) and five summary points. */
const TITLE_MAX = 150;
const TITLE_GOOD = 70;
const POINTS_MAX = 5;

/**
 * Everything OnBuy needs when the platform CREATES a product there — the same process as eBay content.
 *
 * Only used for a product OnBuy does not have yet: listing against an existing OnBuy product carries
 * OnBuy's own page, and none of this is sent. When we create it, our content becomes OnBuy's product
 * page (and locks once other sellers list on it), so it is written for OnBuy rather than copied.
 *
 * The order is the order the work happens in: the category decides which features and technical
 * details exist; research fills them; the words and the title come last, built from what was found.
 * The title, description and summary points are saved with the product card; the category, the
 * field answers and the safety text save here, straight away.
 */
export function OnbuyContentTab({
  productId, sku, productTitle, manufacturerSku, ean, upc,
  onbuyTitle, onTitleChange, descriptionHtml, onDescriptionChange, summaryPoints, onSummaryPointsChange, aiModel,
}: {
  productId: string;
  sku: string;
  productTitle: string;
  manufacturerSku: string;
  ean: string;
  upc: string;
  onbuyTitle: string;
  onTitleChange: (v: string) => void;
  descriptionHtml: string;
  onDescriptionChange: (v: string) => void;
  summaryPoints: string[];
  onSummaryPointsChange: (next: string[]) => void;
  /** Set when Claude wrote the words — OnBuy is told the content is AI-written. */
  aiModel: string | null;
}) {
  const qc = useQueryClient();
  const view = useQuery({
    queryKey: ['onbuy', 'content', productId],
    queryFn: () => onbuyContentApi.view(productId),
    retry: false,
    // Always the latest on opening the tab: Claude writes these answers while the card may be open.
    refetchOnMount: 'always',
  });
  const setView = (v: OnbuyContentView) => qc.setQueryData(['onbuy', 'content', productId], v);

  const chooseCategory = useMutation({
    mutationFn: (picked: { id: string; tree: string }) =>
      listingApi.upsertPlan(productId, view.data!.integrationId, { categoryRef: picked.id, categoryName: picked.tree || null }),
    onSuccess: () => {
      toast.success('OnBuy category saved');
      qc.invalidateQueries({ queryKey: ['onbuy'] });
      qc.invalidateQueries({ queryKey: ['listing'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not save the category'),
  });

  if (view.isLoading) return <p className="text-[12.5px] text-n-500">Loading OnBuy content…</p>;
  if (view.isError || !view.data) {
    const msg = (view.error as any)?.response?.data?.message ?? 'OnBuy content could not be loaded.';
    return <p className="rounded-lg border border-n-200 bg-n-25 px-3 py-2 text-[12.5px] text-n-600">{msg}</p>;
  }
  const d = view.data;
  const identMissing = [
    ...(manufacturerSku.trim() ? [] : ['manufacturer SKU']),
    ...(ean.trim() || upc.trim() ? [] : ['EAN or UPC']),
  ];
  const descriptionText = descriptionHtml.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').trim();
  const answered = d.fields.filter((f) => f.current && !f.current.heldBack).length;

  return (
    <div className="flex flex-col gap-5">
      <p className="text-[12.5px] text-n-500">
        Used only when maSquare <b>creates</b> this product on OnBuy — our words become OnBuy’s product page.
        Listing against a product OnBuy already has sends none of this. Nothing here is sent until you
        create it from the Channels tab.
      </p>

      <Step n={1} title="OnBuy category" done={!!d.category}>
        <p className="mb-2 text-[12px] text-n-400">
          First, because OnBuy decides from the category which features and technical details exist.
        </p>
        <OnbuyCreateCategory
          productId={productId}
          integrationId={d.integrationId}
          chosen={{ id: d.category?.id ?? null, tree: d.category?.name ?? null }}
          onChoose={(id, tree) => chooseCategory.mutate({ id, tree })}
        />
      </Step>

      <Step n={2} title="Category fields" done={!!d.category && d.missing.length === 0 && answered > 0} muted={!d.category}>
        {!d.category ? (
          <p className="text-[12px] text-n-400">Choose a category first.</p>
        ) : (
          <FieldsStep productId={productId} view={d} onView={setView} />
        )}
      </Step>

      <Step n={3} title="Research with Claude" done={false}>
        <ResearchStep sku={sku} view={d} refusal={identMissing.length
          ? `This product has no ${identMissing.join(' and no ')}. Claude will refuse to research it. Fill it in on Identifiers first.`
          : !d.category ? 'Choose the OnBuy category first — it decides which fields Claude researches.' : null} />
      </Step>

      <Step n={4} title="Description, summary points and safety" done={!!descriptionText && summaryPoints.length > 0}>
        <div className="flex flex-col gap-2">
          <p className="text-[12px] text-n-400">
            Plain prose — maSquare sends it to OnBuy as simple HTML (paragraphs). Claude writes it during
            research; edit freely. Saved with the product.
          </p>
          <RichTextEditor minHeight={140} value={descriptionHtml} onChange={onDescriptionChange} placeholder="What the product is, what it does, who it suits." />
          <div>
            <span className="mb-1 block text-[12px] font-semibold text-n-700">Summary points <span className="font-normal text-n-400">(up to {POINTS_MAX})</span></span>
            <FeatureList value={summaryPoints} onChange={(next) => onSummaryPointsChange(next.slice(0, POINTS_MAX))} />
            {summaryPoints.length >= POINTS_MAX && <p className="mt-1 text-[11.5px] text-n-400">OnBuy shows five; more are not sent.</p>}
          </div>
          <SafetyEditor productId={productId} view={d} onView={setView} />
          {d.productData.length > 0 && (
            <details className="text-[12px] text-n-600">
              <summary className="cursor-pointer text-n-500 hover:text-n-700">Specification table sent to OnBuy ({d.productData.length} rows, from the specifics verified for eBay)</summary>
              <dl className="mt-1.5 grid grid-cols-[180px_1fr] gap-x-3 gap-y-0.5">
                {d.productData.map((r) => (
                  <div key={r.label} className="contents">
                    <dt className="text-n-500">{r.label}</dt><dd className="text-n-800">{r.value}</dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
          {aiModel && <p className="text-[11.5px] text-n-400">Written by {aiModel} — OnBuy is told the content is AI-written.</p>}
        </div>
      </Step>

      <Step n={5} title="OnBuy title" done={!!onbuyTitle.trim()}>
        <input
          className="input"
          maxLength={TITLE_MAX}
          value={onbuyTitle}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder={productTitle ? `e.g. ${productTitle.slice(0, 60)}…` : 'Brand, model, what it is, then the facts buyers filter on'}
        />
        <p className={`mt-1 text-[12px] ${onbuyTitle.length > TITLE_GOOD ? 'text-warning' : 'text-n-400'}`}>
          {onbuyTitle.length}/{TITLE_MAX} characters — OnBuy refuses more, and recommends about {TITLE_GOOD}.
        </p>
      </Step>

      <div className="flex items-start gap-2 rounded-lg border border-n-200 bg-n-25 px-3.5 py-2.5 text-[12.5px] text-n-600">
        <ExternalLink size={14} className="mt-0.5 shrink-0 text-n-400" />
        <span>
          Then create it from <b>Channels › OnBuy</b>: choose “Create it on OnBuy”, set the price and delivery
          template, and the preview shows exactly what will be sent.
        </span>
      </div>
    </div>
  );
}

/** The category's fields: an answer each, with where it came from. Saved together. */
function FieldsStep({ productId, view, onView }: { productId: string; view: OnbuyContentView; onView: (v: OnbuyContentView) => void }) {
  const [edits, setEdits] = useState<Record<string, string>>({});
  useEffect(() => setEdits({}), [view.category?.id]);
  const dirty = Object.keys(edits).length > 0;

  const save = useMutation({
    mutationFn: () => onbuyContentApi.save(productId, { integrationId: view.integrationId, edits }),
    onSuccess: (v) => { onView(v); setEdits({}); toast.success('OnBuy fields saved'); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not save'),
  });
  const confirm = useMutation({
    mutationFn: (name: string) => onbuyContentApi.confirm(productId, view.integrationId, name),
    onSuccess: (v) => onView(v),
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not confirm'),
  });

  if (view.fieldsProblem) return <p className="text-[12px] text-warning">{view.fieldsProblem}</p>;
  if (!view.fields.length) return <p className="text-[12px] text-n-500">OnBuy asks for no extra fields in this category.</p>;

  // Required first, then features, then measurements — the order they matter in.
  const ordered = [...view.fields].sort((a, b) => rank(a) - rank(b));
  const value = (f: OnbuyContentField) => (f.name in edits ? edits[f.name] : f.current?.value ?? '');

  return (
    <div className="flex flex-col gap-2">
      {view.missing.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-warning-bd bg-warning-bg px-3 py-2 text-[12px] text-warning">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>OnBuy requires {view.missing.join(', ')} in this category. The product cannot be created until {view.missing.length === 1 ? 'it has' : 'they have'} a usable answer.</span>
        </div>
      )}
      {view.rejected.length > 0 && (
        <p className="text-[12px] text-amber-800">
          Not sendable: {view.rejected.map((r) => `${r.name} “${r.value}” — ${r.why}`).join('; ')}.
        </p>
      )}
      <div className="flex flex-col divide-y divide-n-100 rounded-lg border border-n-200">
        {ordered.map((f) => (
          <div key={f.name} className="flex flex-col gap-1 px-3 py-2">
            <div className="grid grid-cols-[180px_1fr] items-center gap-3 max-[560px]:grid-cols-1">
              <label htmlFor={`onbuy-field-${f.name}`} className="text-[12.5px] text-n-700">
                {f.name}
                {f.kind === 'feature' && f.required && <span className="ml-1 text-danger">*</span>}
                <span className="block text-[11px] text-n-400">{f.kind === 'feature' ? `${f.options.length} OnBuy options` : `measurement · ${f.units.join(', ')}`}</span>
              </label>
              {f.kind === 'feature' ? (
                <select
                  id={`onbuy-field-${f.name}`}
                  className="input h-8 text-[12.5px]"
                  value={f.options.some((o) => o.name === value(f)) ? value(f) : ''}
                  onChange={(e) => setEdits((s) => ({ ...s, [f.name]: e.target.value }))}
                >
                  <option value="">{value(f) && !f.options.some((o) => o.name === value(f)) ? `“${value(f)}” is not an OnBuy option — choose one` : '—'}</option>
                  {f.options.map((o) => <option key={o.id} value={o.name}>{o.name}</option>)}
                </select>
              ) : (
                <input
                  id={`onbuy-field-${f.name}`}
                  className="input mono h-8 text-[12.5px]"
                  value={value(f)}
                  onChange={(e) => setEdits((s) => ({ ...s, [f.name]: e.target.value }))}
                  placeholder={`e.g. 45 ${f.units[0] ?? ''}`.trim()}
                />
              )}
            </div>
            {f.current && !(f.name in edits) && (
              <Provenance
                prov={f.current}
                indent={false}
                confirming={confirm.isPending && confirm.variables === f.name}
                onConfirm={() => confirm.mutate(f.name)}
              />
            )}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button type="button" className="hbtn" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save fields
        </button>
        {dirty && <span className="text-[11.5px] text-n-400">Unsaved changes. An emptied field deletes its answer.</span>}
      </div>
    </div>
  );
}

const rank = (f: OnbuyContentField) => (f.kind === 'feature' ? (f.required ? 0 : 1) : 2);

/** The copyable prompt, as on eBay content. The rules live on the connector. */
function ResearchStep({ sku, view, refusal }: { sku: string; view: OnbuyContentView; refusal: string | null }) {
  const [copied, setCopied] = useState(false);
  const prompt = `Research OnBuy product data and write the OnBuy title, description, summary points and safety text for maSquare product ${sku}.`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast('Copy blocked by the browser — select the text instead.');
    }
  };
  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-[12.5px] text-n-500">
        Claude fills the category fields and writes the OnBuy words through the maSquare connector.
        {view.reusablePages > 0 && <> It starts from the <b>{view.reusablePages} pages</b> already accepted for this product’s eBay research, and searches only for what they leave open.</>}
        {' '}maSquare decides what may be used, by the same rules as eBay.
      </p>
      {refusal && (
        <div className="flex items-start gap-2 rounded-lg border border-warning-bd bg-warning-bg px-3 py-2 text-[12.5px] text-warning">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>{refusal}</span>
        </div>
      )}
      <div className="flex flex-col gap-1.5 rounded-lg border border-n-200 bg-n-25 p-3">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-n-500">Ask Claude this</span>
        <code className="mono block rounded-md border border-n-200 bg-n-0 px-2.5 py-2 text-[12.5px] text-n-800">{prompt}</code>
        <button type="button" className="hbtn mt-0.5 self-start" onClick={copy} disabled={!!refusal}>
          {copied ? <Check size={13} className="text-success" /> : <ClipboardCopy size={13} />}
          {copied ? 'Copied' : 'Copy prompt'}
        </button>
        <p className="text-[11.5px] text-n-400">
          Paste it into Claude with the maSquare connector switched on. When Claude has finished, close and reopen
          the product to see the words it wrote.
        </p>
      </div>
    </div>
  );
}

/** OnBuy's product-safety (GPSR) text. Only what a manufacturer page or manual states. Saved here. */
function SafetyEditor({ productId, view, onView }: { productId: string; view: OnbuyContentView; onView: (v: OnbuyContentView) => void }) {
  const [draft, setDraft] = useState<OnbuySafety>(view.safety);
  useEffect(() => setDraft(view.safety), [view.safety.warnings, view.safety.usageInstructions, view.safety.ingredients]);
  const dirty = (['warnings', 'usageInstructions', 'ingredients'] as const).some((k) => (draft[k] ?? '') !== (view.safety[k] ?? ''));
  const save = useMutation({
    mutationFn: () => onbuyContentApi.save(productId, { integrationId: view.integrationId, safety: draft }),
    onSuccess: (v) => { onView(v); toast.success('Safety information saved'); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not save'),
  });
  if (!view.category) return null;
  const field = (key: keyof OnbuySafety, label: string, hint: string) => (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] font-semibold text-n-700">{label} <span className="font-normal text-n-400">{hint}</span></span>
      <textarea
        id={`onbuy-safety-${key}`}
        className="input min-h-[56px] py-1.5 text-[12.5px]"
        value={draft[key] ?? ''}
        onChange={(e) => setDraft((s) => ({ ...s, [key]: e.target.value }))}
      />
    </label>
  );
  return (
    <div className="mt-1 flex flex-col gap-2 rounded-lg border border-n-200 bg-n-25 p-3">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-n-500">Product safety (GPSR)</span>
      {field('warnings', 'Warnings', '— as the manufacturer states them')}
      {field('usageInstructions', 'Usage instructions', '')}
      {field('ingredients', 'Ingredients / materials', '— where relevant (cosmetics, food)')}
      <p className="text-[11.5px] text-n-400">PDF documents on the product (manuals, certificates) are sent to OnBuy as safety documents.</p>
      <div>
        <button type="button" className="hbtn" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save safety information
        </button>
      </div>
    </div>
  );
}

function Step({ n, title, children, done, muted }: { n: number; title: string; children: React.ReactNode; done: boolean; muted?: boolean }) {
  return (
    <div className={muted ? 'opacity-70' : undefined}>
      <div className="mb-1.5 flex items-center gap-2">
        <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold ${done ? 'bg-teal-500 text-white' : 'border border-n-300 bg-n-0 text-n-500'}`}>
          {n}
        </span>
        <span className="text-[13px] font-semibold text-n-800">{title}</span>
      </div>
      <div className="pl-7">{children}</div>
    </div>
  );
}
