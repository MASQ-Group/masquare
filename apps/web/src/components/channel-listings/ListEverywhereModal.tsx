import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, Ban, Check, ChevronRight, Link2, Link2Off, Rocket, Search, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { ModalShell } from '@masquare/ui';
import { amazonListingApi, type AmazonCandidates, type ListEverywherePreview, type ListEverywhereRow } from '../../lib/api';
import { eurAside } from '../../lib/format';
import { isZeroDecimalCurrency, limitPriceInput } from '../../lib/currencies';
import { sortByChannelCanonical } from '../../lib/channelGroups';
import { useConfirm } from '../ConfirmProvider';
import { useJobProgress } from '../../lib/useJobProgress';

const SYMBOL: Record<string, string> = { EUR: '€', GBP: '£', USD: '$', CAD: 'CA$', AUD: 'A$', JPY: '¥', SEK: 'kr', PLN: 'zł', AED: 'AED ', SAR: 'SAR ', MXN: 'MX$', TRY: '₺', SGD: 'S$' };
const money = (cents: number, ccy: string) =>
  `${SYMBOL[ccy] ?? `${ccy} `}${(cents / 100).toFixed(ccy === 'JPY' ? 0 : 2)}`;

type Step = 'scope' | 'match' | 'price' | 'review';
const STEPS: { key: Step; label: string }[] = [
  { key: 'scope', label: 'Where it can go' },
  { key: 'match', label: 'Match each listing' },
  { key: 'price', label: 'Price & dispatch' },
  { key: 'review', label: 'Review & list' },
];

/**
 * List this product on every marketplace it can go on, in one pass.
 *
 * Four steps, because the work genuinely has four parts and collapsing them was what stopped the
 * first version working at all: it priced and submitted without ever establishing WHICH Amazon
 * listing each marketplace was, which is the one thing Amazon cannot be asked to guess.
 *
 * The order matters. Scope first, so nobody matches eighteen rows and then learns half were never
 * listable. Match second, one channel at a time and never in bulk — the check is a person reading a
 * title and saying "yes, that one", and there is no honest way to do that for eighteen products at
 * once. Price third. Only then the button that writes.
 */
export function ListEverywhereModal({
  productId, sku, onClose, onDone,
}: {
  productId: string;
  sku: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const confirm = useConfirm();
  const [step, setStep] = useState<Step>('scope');
  const [margin, setMargin] = useState('20');
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [handlingAll, setHandlingAll] = useState('');
  const [handlingBy, setHandlingBy] = useState<Record<string, string>>({});
  const [priceBy, setPriceBy] = useState<Record<string, string>>({});
  const job = useJobProgress(`listing.amazon.listEverywhere.${productId}`);

  const preview = useMutation({
    mutationFn: (pct: number) => amazonListingApi.listEverywherePreview(productId, pct),
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not work out where this can be listed'),
  });
  const p = preview.data;
  const run = () => preview.mutate(Number(margin));

  const rows = useMemo(
    () => sortByChannelCanonical(p?.rows ?? [], (r) => ({ name: r.name, countryIso: r.marketplace, channelType: 'amazon' })),
    [p],
  );

  const wholeDays = (raw: string) => raw.replace(/[^\d]/g, '').slice(0, 2);
  const handlingFor = (r: ListEverywhereRow): string =>
    handlingBy[r.integrationId] || handlingAll || (r.handlingTimeDays != null ? String(r.handlingTimeDays) : '');
  const priceFor = (r: ListEverywhereRow): string =>
    priceBy[r.integrationId] ?? (r.priceCents != null ? (r.priceCents / 100).toFixed(isZeroDecimalCurrency(r.currency) ? 0 : 2) : '');

  // Waiting on a person to say which listing it is.
  const toMatch = rows.filter((r) => r.matchable);
  const matched = rows.filter((r) => r.matched);
  // Ready once matched, priced and given a dispatch time.
  const offerable = (r: ListEverywhereRow) => r.canList || (r.blockedOnlyByHandlingTime && handlingFor(r) !== '');
  const ready = rows.filter(offerable);
  const blocked = rows.filter((r) => !offerable(r) && !r.matchable);
  const selected = ready.filter((r) => chosen.has(r.integrationId));

  const afterMatch = () => {
    // Matching writes to the plan, so the verdicts change. Re-previewed rather than patched on the
    // client: the server decides what is listable and this screen should not hold a second opinion.
    preview.mutate(Number(margin));
  };

  const go = async () => {
    if (!p || selected.length === 0) return;
    const ok = await confirm({
      title: `List on ${selected.length} marketplace${selected.length === 1 ? '' : 's'}?`,
      message:
        `${sku} will be listed on: ${selected.map((r) => `${r.name} at ${priceFor(r) || '?'} ${r.currency} (dispatch ${handlingFor(r) || '?'}d)`).join(', ')}.\n\n` +
        'These become real listings customers can buy. Removing one afterwards is a separate action on each marketplace.',
      confirmLabel: `List on ${selected.length}`,
    });
    if (!ok) return;
    job.start(() =>
      amazonListingApi.listEverywhere(
        productId,
        p.marginPct,
        selected.map((r) => r.integrationId),
        { forAll: handlingAll || null, byChannel: handlingBy },
        // Only the prices actually typed. An untouched row keeps the suggestion the server computed,
        // rather than having it round-tripped back as though somebody had chosen it.
        Object.fromEntries(selected.map((r) => [r.integrationId, priceBy[r.integrationId] ?? null]).filter(([, v]) => v != null)),
      ),
    );
  };

  const result = job.result as { summary?: { submitted: number; failed: number }; results?: Array<{ name: string; ok: boolean; message: string }> } | null;

  return (
    <ModalShell
      open
      title="List on every eligible marketplace"
      subtitle={sku}
      primaryLabel={step === 'review' ? (job.running ? 'Listing…' : `List on ${selected.length || ''}`.trim()) : 'Next'}
      onPrimary={step === 'review' ? go : () => setStep(STEPS[Math.min(STEPS.findIndex((s) => s.key === step) + 1, 3)].key)}
      onClose={onClose}
      initialSize={{ w: 860, h: 700 }}
    >
      <div className="flex flex-col gap-3">
        <Steps step={step} onStep={setStep} disabled={!p} awaitingMatch={toMatch.length} />

        {step === 'scope' && (
          <ScopeStep
            margin={margin} setMargin={setMargin} onRun={run} running={preview.isPending}
            preview={p} blocked={blocked} boundAsin={p?.boundAsin ?? null}
          />
        )}

        {step === 'match' && (
          <MatchStep
            productId={productId} rows={toMatch} matched={matched}
            boundAsin={p?.boundAsin ?? null} onChanged={afterMatch} loaded={!!p}
          />
        )}

        {step === 'price' && (
          <PriceStep
            productId={productId} rows={ready}
            handlingAll={handlingAll} setHandlingAll={(v) => setHandlingAll(wholeDays(v))}
            handlingFor={handlingFor} onHandling={(id, v) => setHandlingBy((prev) => ({ ...prev, [id]: wholeDays(v) }))}
            priceFor={priceFor} onPrice={(id, v, ccy) => setPriceBy((prev) => ({ ...prev, [id]: limitPriceInput(v, ccy) }))}
          />
        )}

        {step === 'review' && (
          <ReviewStep
            rows={ready} chosen={chosen} setChosen={setChosen} selected={selected}
            priceFor={priceFor} handlingFor={handlingFor}
            liveWritesEnabled={p?.liveWritesEnabled ?? false}
            job={job} result={result} onDone={onDone}
          />
        )}
      </div>
    </ModalShell>
  );
}

function Steps({ step, onStep, disabled, awaitingMatch }: { step: Step; onStep: (s: Step) => void; disabled: boolean; awaitingMatch: number }) {
  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-n-100 pb-2.5">
      {STEPS.map((s, i) => {
        const active = s.key === step;
        return (
          <div key={s.key} className="flex items-center gap-1">
            {i > 0 && <ChevronRight size={13} className="text-n-300" />}
            <button
              type="button"
              disabled={disabled && s.key !== 'scope'}
              onClick={() => onStep(s.key)}
              className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-semibold disabled:opacity-40 ${
                active ? 'bg-teal-50 text-teal-800' : 'text-n-600 hover:bg-n-50'
              }`}
            >
              <span className={`grid h-4 w-4 place-items-center rounded-full text-[10px] ${active ? 'bg-teal-600 text-white' : 'bg-n-200 text-n-600'}`}>{i + 1}</span>
              {s.label}
              {/* The count that says step two still has work in it, visible from any step. */}
              {s.key === 'match' && awaitingMatch > 0 && (
                <span className="rounded-full bg-amber-100 px-1.5 text-[10.5px] font-bold text-amber-800">{awaitingMatch}</span>
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// 1. Scope
// ---------------------------------------------------------------------------------------------

function ScopeStep({
  margin, setMargin, onRun, running, preview, blocked, boundAsin,
}: {
  margin: string; setMargin: (v: string) => void; onRun: () => void; running: boolean;
  preview: ListEverywherePreview | undefined; blocked: ListEverywhereRow[]; boundAsin: string | null;
}) {
  return (
    <>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold text-n-600">Profit percentage</span>
          <div className="flex items-center gap-1.5">
            <input
              value={margin}
              onChange={(e) => setMargin(e.target.value.replace(/[^\d.]/g, ''))}
              inputMode="decimal"
              className="mono h-9 w-[90px] rounded-md border border-n-200 px-2.5 text-right text-[13px] outline-none focus:border-teal-400"
            />
            <span className="text-[13px] text-n-500">%</span>
          </div>
        </label>
        <button
          type="button"
          onClick={onRun}
          disabled={running}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-n-200 bg-n-0 px-3 text-[12.5px] font-semibold text-n-700 hover:border-teal-300 hover:text-teal-700 disabled:opacity-50"
        >
          {running ? 'Working it out…' : preview ? 'Recalculate' : 'Show me where this can go'}
        </button>
        <span className="text-[11.5px] text-n-400">Nothing is sent until the last step.</span>
      </div>

      {!preview && !running && (
        <p className="rounded-md border border-n-200 bg-n-25 px-3 py-2 text-[12.5px] text-n-600">
          Each marketplace is priced to earn this percentage on the same cost basis as every other profit figure here —
          landed cost, that marketplace's fees, its VAT and today's rate. The price therefore differs per marketplace,
          because the deductions do.
        </p>
      )}

      {preview && (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-n-200 bg-n-25 px-3 py-2 text-[12.5px]">
            {preview.summary.awaitingMatch > 0 && (
              <span className="text-amber-700"><b>{preview.summary.awaitingMatch}</b> need matching</span>
            )}
            <span className="text-teal-700"><b>{preview.summary.ready}</b> ready to list</span>
            <span className="text-n-500"><b>{blocked.length}</b> cannot be listed</span>
            <span className="text-n-400">at {preview.marginPct}% profit</span>
          </div>

          {boundAsin && (
            <div className="flex items-start gap-2 rounded-md border border-n-200 bg-n-25 px-3 py-2 text-[12px] text-n-600">
              <Link2 size={13} className="mt-0.5 shrink-0 text-n-400" />
              {/* Stated up front because it constrains every match made in the next step. */}
              <span>
                This SKU is already bound to ASIN <b className="mono">{boundAsin}</b> in these accounts. Amazon requires one
                SKU to point at one ASIN across a seller account, so matching a different one will be refused at validation.
              </span>
            </div>
          )}

          {blocked.length > 0 && (
            <div className="rounded-lg border border-n-200">
              <div className="border-b border-n-100 px-3 py-2 text-[12px] font-semibold text-n-500">
                Cannot be listed ({blocked.length})
              </div>
              <div className="max-h-[260px] overflow-y-auto">
                {blocked.map((r) => (
                  <div key={r.integrationId} className="flex items-start gap-2 border-b border-n-50 px-3 py-2 last:border-b-0">
                    <Ban size={13} className="mt-0.5 shrink-0 text-n-300" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[12.5px] font-semibold text-n-600">{r.name}</div>
                      <ul className="mt-0.5 list-disc pl-4 text-[11.5px] text-n-500">
                        {r.blockers.map((b) => <li key={b}>{b}</li>)}
                      </ul>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// 2. Match — one channel at a time, never in bulk
// ---------------------------------------------------------------------------------------------

function MatchStep({
  productId, rows, matched, boundAsin, onChanged, loaded,
}: {
  productId: string;
  rows: ListEverywhereRow[];
  matched: ListEverywhereRow[];
  boundAsin: string | null;
  onChanged: () => void;
  loaded: boolean;
}) {
  if (!loaded) return <Hint>Run step one first.</Hint>;
  if (rows.length === 0 && matched.length === 0) return <Hint>No marketplace here needs matching.</Hint>;

  return (
    <>
      <p className="rounded-md border border-n-200 bg-n-25 px-3 py-2 text-[12.5px] text-n-600">
        Confirm which Amazon listing this product is, on each marketplace. The suggestion below is the first candidate the
        availability check saw — it is a suggestion, not an answer, and there is deliberately no button to accept them all.
        An offer attached to a similar-looking listing sells the wrong thing at our price.
      </p>

      {rows.length > 0 && (
        <div className="rounded-lg border border-n-200">
          <div className="border-b border-n-100 px-3 py-2 text-[12px] font-semibold text-n-700">
            Waiting to be matched ({rows.length})
          </div>
          {rows.map((r) => (
            <MatchRow key={r.integrationId} productId={productId} row={r} boundAsin={boundAsin} onChanged={onChanged} />
          ))}
        </div>
      )}

      {matched.length > 0 && (
        <div className="rounded-lg border border-n-200">
          <div className="border-b border-n-100 px-3 py-2 text-[12px] font-semibold text-n-700">Matched ({matched.length})</div>
          {matched.map((r) => (
            <MatchedRow key={r.integrationId} productId={productId} row={r} onChanged={onChanged} />
          ))}
        </div>
      )}
    </>
  );
}

function MatchRow({ productId, row, boundAsin, onChanged }: { productId: string; row: ListEverywhereRow; boundAsin: string | null; onChanged: () => void }) {
  const [others, setOthers] = useState<AmazonCandidates | null>(null);

  const match = useMutation({
    mutationFn: (v: { asin: string; productType?: string | null }) =>
      amazonListingApi.matchChannel(productId, row.integrationId, v.asin, v.productType),
    onSuccess: (r) => { toast.success(`${r.name} matched to ${r.asin}`); onChanged(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not save the match'),
  });

  const load = useMutation({
    mutationFn: () => amazonListingApi.matchCandidates(productId, row.integrationId),
    onSuccess: setOthers,
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not search Amazon'),
  });

  const c = row.candidate;
  return (
    <div className="border-b border-n-50 px-3 py-2.5 last:border-b-0">
      <div className="flex flex-wrap items-start gap-2">
        <span className="w-[120px] shrink-0 pt-0.5 text-[12.5px] font-semibold text-n-800">{row.name}</span>
        <div className="min-w-[240px] flex-1">
          {c ? (
            <>
              <div className="mono text-[12.5px] font-semibold text-n-900">{c.asin}</div>
              {/* The title is what makes a match judgeable. An ASIN on its own is a string nobody
                  can check, and confirming strings is how the wrong product gets an offer. */}
              <div className="text-[12px] text-n-600">{c.title ?? <span className="text-n-400">no title returned</span>}</div>
              {c.productType && <div className="text-[11px] text-n-400">{c.productType}</div>}
              {c.conflictsWithBound && (
                <div className="mt-1 flex items-start gap-1 text-[11.5px] text-danger">
                  <TriangleAlert size={11} className="mt-0.5 shrink-0" />
                  <span>Different from the ASIN this SKU is bound to ({boundAsin}). Amazon will refuse this.</span>
                </div>
              )}
            </>
          ) : (
            <span className="text-[12px] text-n-500">No suggestion stored — search Amazon to find the listing.</span>
          )}
        </div>
        <div className="flex shrink-0 flex-col gap-1.5">
          <button
            type="button"
            disabled={!c || match.isPending}
            onClick={() => c && match.mutate({ asin: c.asin, productType: c.productType })}
            className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md bg-teal-600 px-3 text-[12.5px] font-semibold text-white hover:bg-teal-700 disabled:opacity-40"
          >
            <Check size={14} /> This is it
          </button>
          <button
            type="button"
            onClick={() => load.mutate()}
            disabled={load.isPending}
            className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md border border-n-200 bg-n-0 px-3 text-[12px] font-semibold text-n-700 hover:border-n-300 disabled:opacity-50"
          >
            <Search size={13} /> {load.isPending ? 'Searching…' : 'Other listings'}
          </button>
        </div>
      </div>

      {others && (
        <div className="mt-2 rounded-md border border-n-200 bg-n-25 p-2">
          {others.candidates.length === 0 && <span className="text-[12px] text-n-500">{others.message ?? 'Amazon returned nothing here.'}</span>}
          {others.candidates.map((o) => (
            <div key={o.asin} className="flex items-center gap-2 border-b border-n-100 py-1.5 last:border-b-0">
              <div className="min-w-0 flex-1">
                <span className="mono text-[12px] font-semibold text-n-800">{o.asin}</span>
                <span className="ml-2 text-[12px] text-n-600">{o.title}</span>
                {o.conflictsWithBound && <span className="ml-2 text-[11px] text-danger">conflicts with the bound ASIN</span>}
              </div>
              <button
                type="button"
                onClick={() => match.mutate({ asin: o.asin, productType: o.productType })}
                className="inline-flex h-7 shrink-0 items-center rounded-md border border-n-200 bg-n-0 px-2.5 text-[12px] font-semibold text-n-700 hover:border-teal-300 hover:text-teal-700"
              >
                Use this
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MatchedRow({ productId, row, onChanged }: { productId: string; row: ListEverywhereRow; onChanged: () => void }) {
  const undo = useMutation({
    mutationFn: () => amazonListingApi.unmatchChannel(productId, row.integrationId),
    onSuccess: () => { toast.success(`${row.name} unmatched`); onChanged(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not undo the match'),
  });
  return (
    <div className="flex items-center gap-2 border-b border-n-50 px-3 py-2 last:border-b-0">
      <Check size={13} className="shrink-0 text-teal-600" />
      <span className="w-[120px] shrink-0 text-[12.5px] font-semibold text-n-800">{row.name}</span>
      <span className="mono flex-1 text-[12.5px] text-n-700">{row.matchedAsin}</span>
      {/* A wrong match should be correctable here rather than somewhere else. */}
      <button
        type="button"
        onClick={() => undo.mutate()}
        disabled={undo.isPending}
        className="inline-flex h-7 items-center gap-1 rounded-md border border-n-200 bg-n-0 px-2 text-[11.5px] font-semibold text-n-600 hover:border-danger-bd hover:text-danger disabled:opacity-50"
      >
        <Link2Off size={12} /> Undo
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// 3. Price & dispatch
// ---------------------------------------------------------------------------------------------

function PriceStep({
  productId, rows, handlingAll, setHandlingAll, handlingFor, onHandling, priceFor, onPrice,
}: {
  productId: string;
  rows: ListEverywhereRow[];
  handlingAll: string;
  setHandlingAll: (v: string) => void;
  handlingFor: (r: ListEverywhereRow) => string;
  onHandling: (id: string, v: string) => void;
  priceFor: (r: ListEverywhereRow) => string;
  onPrice: (id: string, v: string, ccy: string) => void;
}) {
  if (rows.length === 0) return <Hint>Nothing is ready to price yet — match the marketplaces in step two first.</Hint>;
  return (
    <>
      <div className="flex flex-wrap items-end gap-2 rounded-md border border-n-200 bg-n-25 px-3 py-2">
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold text-n-600">Days to dispatch, all marketplaces</span>
          <div className="flex items-center gap-1.5">
            <input
              value={handlingAll}
              onChange={(e) => setHandlingAll(e.target.value)}
              inputMode="numeric"
              placeholder="e.g. 2"
              className="mono h-8 w-[72px] rounded-md border border-n-200 px-2.5 text-right text-[13px] outline-none focus:border-teal-400"
            />
            <span className="text-[12.5px] text-n-500">days</span>
          </div>
        </label>
        <p className="min-w-[220px] flex-1 text-[11.5px] text-n-500">
          Fills in every marketplace that has no figure of its own. Override any single one on its row.
        </p>
      </div>

      <div className="rounded-lg border border-n-200">
        {rows.map((r) => (
          <PriceRow
            key={r.integrationId} productId={productId} row={r}
            price={priceFor(r)} onPrice={(v) => onPrice(r.integrationId, v, r.currency)}
            handling={handlingFor(r)} onHandling={(v) => onHandling(r.integrationId, v)}
          />
        ))}
      </div>
    </>
  );
}

function PriceRow({
  productId, row, price, onPrice, handling, onHandling,
}: {
  productId: string; row: ListEverywhereRow;
  price: string; onPrice: (v: string) => void;
  handling: string; onHandling: (v: string) => void;
}) {
  const [comp, setComp] = useState<null | Awaited<ReturnType<typeof amazonListingApi.competition>>>(null);
  const load = useMutation({
    mutationFn: () => amazonListingApi.competition(productId, row.integrationId),
    onSuccess: setComp,
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not read the competition'),
  });

  const loss = row.profitCents != null && row.profitCents <= 0;
  return (
    <div className="border-b border-n-50 px-3 py-2.5 last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="w-[120px] shrink-0 text-[12.5px] font-semibold text-n-800">{row.name}</span>

        <div className="flex items-center gap-1.5">
          <input
            value={price}
            onChange={(e) => onPrice(e.target.value)}
            inputMode={isZeroDecimalCurrency(row.currency) ? 'numeric' : 'decimal'}
            aria-label={`Price on ${row.name}`}
            className="mono h-8 w-[100px] rounded-md border border-n-200 px-2 text-right text-[12.5px] outline-none focus:border-teal-400"
          />
          <span className="text-[11.5px] text-n-500">{row.currency}</span>
        </div>

        {/* The suggestion is already computed at the chosen margin — no extra call to show it. */}
        {row.priceCents != null && (
          <button
            type="button"
            onClick={() => onPrice((row.priceCents! / 100).toFixed(isZeroDecimalCurrency(row.currency) ? 0 : 2))}
            className="text-[11.5px] font-semibold text-teal-700 hover:underline"
          >
            use {money(row.priceCents, row.currency)}
          </button>
        )}

        {row.profitCents != null && (
          <span className={`text-[11.5px] ${loss ? 'text-danger' : 'text-teal-700'}`}>
            {loss ? 'loses' : 'earns'} {money(Math.abs(row.profitCents), row.currency)}
            {eurAside(row.profitEurCents == null ? null : Math.abs(row.profitEurCents), row.currency) &&
              ` = ${eurAside(Math.abs(row.profitEurCents!), row.currency)}`}
          </span>
        )}

        <div className="flex items-center gap-1.5">
          <input
            value={handling}
            onChange={(e) => onHandling(e.target.value)}
            inputMode="numeric"
            placeholder="—"
            aria-label={`Days to dispatch on ${row.name}`}
            className="mono h-8 w-[52px] rounded-md border border-n-200 px-2 text-right text-[12px] outline-none focus:border-teal-400"
          />
          <span className="text-[11.5px] text-n-500">days</span>
        </div>

        {/* On demand, per row. Amazon allows half a request a second on this endpoint, so eighteen
            of them on open would take a minute and come back partial. */}
        <button
          type="button"
          onClick={() => load.mutate()}
          disabled={load.isPending}
          className="ml-auto inline-flex h-7 shrink-0 items-center rounded-md border border-n-200 bg-n-0 px-2.5 text-[11.5px] font-semibold text-n-700 hover:border-n-300 disabled:opacity-50"
        >
          {load.isPending ? 'Asking…' : comp ? 'Refresh' : 'Competition'}
        </button>
      </div>

      {comp && !comp.ok && (
        <div className="mt-1.5 text-[11.5px] text-amber-700">{comp.reason}</div>
      )}
      {comp?.ok && (
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-n-600">
          {comp.prices.map((pr) => (
            <span key={pr.kind}>
              {pr.label}{' '}
              {pr.priceCents == null ? <span className="text-n-400">none</span> : (
                <button
                  type="button"
                  onClick={() => onPrice((pr.priceCents! / 100).toFixed(isZeroDecimalCurrency(comp.currency) ? 0 : 2))}
                  className="mono font-semibold text-n-800 hover:text-teal-700 hover:underline"
                  title="Use this price — it is a reference, and it does not know our costs"
                >
                  {money(pr.priceCents, comp.currency)}
                </button>
              )}
              {pr.profitCents != null && (
                <span className={pr.profitCents > 0 ? ' text-teal-700' : ' text-danger'}>
                  {' '}({pr.profitCents > 0 ? '+' : '−'}{money(Math.abs(pr.profitCents), comp.currency)})
                </span>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// 4. Review & list
// ---------------------------------------------------------------------------------------------

function ReviewStep({
  rows, chosen, setChosen, selected, priceFor, handlingFor, liveWritesEnabled, job, result, onDone,
}: {
  rows: ListEverywhereRow[];
  chosen: Set<string>;
  setChosen: (s: Set<string>) => void;
  selected: ListEverywhereRow[];
  priceFor: (r: ListEverywhereRow) => string;
  handlingFor: (r: ListEverywhereRow) => string;
  liveWritesEnabled: boolean;
  job: { running: boolean; detail: string; error: unknown };
  result: { summary?: { submitted: number; failed: number }; results?: Array<{ name: string; ok: boolean; message: string }> } | null;
  onDone: () => void;
}) {
  if (rows.length === 0) return <Hint>Nothing is ready to list yet.</Hint>;
  const toggle = (id: string) => {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id); else next.add(id);
    setChosen(next);
  };
  return (
    <>
      {!liveWritesEnabled && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
          <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-600" />
          <span>
            Creating listings is switched off, so this will refuse rather than send. Turn on “Create real marketplace
            listings” in Settings → General first.
          </span>
        </div>
      )}

      <div className="rounded-lg border border-n-200">
        <div className="flex items-center gap-2 border-b border-n-100 px-3 py-2">
          <span className="flex-1 text-[12px] font-semibold text-n-700">
            Ready to list ({selected.length} of {rows.length} selected)
          </span>
          {/* Nothing is ticked for you. Selecting is the last deliberate act before a live write. */}
          <button type="button" onClick={() => setChosen(new Set(rows.map((r) => r.integrationId)))} className="text-[11.5px] font-semibold text-teal-700 hover:underline">Select all</button>
          <button type="button" onClick={() => setChosen(new Set())} className="text-[11.5px] font-semibold text-n-500 hover:underline">Clear</button>
        </div>
        {rows.map((r) => (
          <label key={r.integrationId} className="flex cursor-pointer items-start gap-2 border-b border-n-50 px-3 py-2 last:border-b-0 hover:bg-n-25">
            <input type="checkbox" checked={chosen.has(r.integrationId)} onChange={() => toggle(r.integrationId)} className="mt-0.5 h-4 w-4 accent-teal-600" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-3 text-[12.5px]">
                <span className="font-semibold text-n-800">{r.name}</span>
                <span className="mono text-n-700">{priceFor(r)} {r.currency}</span>
                <span className="text-n-500">dispatch {handlingFor(r)}d</span>
                <span className="mono text-[11.5px] text-n-400">{r.matchedAsin}</span>
              </div>
              {r.warnings.map((w) => (
                <div key={w} className="mt-0.5 flex items-start gap-1 text-[11.5px] text-amber-700">
                  <TriangleAlert size={11} className="mt-0.5 shrink-0" /> <span>{w}</span>
                </div>
              ))}
            </div>
            <Rocket size={13} className="mt-1 shrink-0 text-n-300" />
          </label>
        ))}
      </div>

      {job.running && <div className="rounded-md border border-n-200 bg-n-25 px-3 py-2 text-[12.5px] text-n-600">{job.detail || 'Listing…'}</div>}
      {job.error && !job.running && (
        <div className="flex items-start gap-2 rounded-md border border-danger-bd bg-danger-bg px-3 py-2 text-[12.5px] text-danger">
          <Ban size={13} className="mt-0.5 shrink-0" /><span>{String(job.error)}</span>
        </div>
      )}

      {result?.summary && (
        <div className="rounded-lg border border-n-200">
          <div className="border-b border-n-100 px-3 py-2 text-[12.5px] font-semibold text-n-800">
            {result.summary.submitted} submitted{result.summary.failed > 0 ? `, ${result.summary.failed} failed` : ''}
          </div>
          {(result.results ?? []).map((r) => (
            <div key={r.name} className="flex items-start gap-2 border-b border-n-50 px-3 py-1.5 text-[12px] last:border-b-0">
              {r.ok ? <Check size={13} className="mt-0.5 shrink-0 text-teal-600" /> : <Ban size={13} className="mt-0.5 shrink-0 text-danger" />}
              <span className="w-[130px] shrink-0 font-semibold text-n-700">{r.name}</span>
              <span className={r.ok ? 'text-n-500' : 'text-danger'}>{r.message}</span>
            </div>
          ))}
          <div className="px-3 py-2 text-[11.5px] text-n-400">
            Submitted is not the same as live — Amazon publishes these over the next few minutes and can still reject one.
            The next sync is what confirms them.
          </div>
          <div className="px-3 pb-3">
            <button type="button" onClick={onDone} className="inline-flex h-8 items-center rounded-md border border-n-200 bg-n-0 px-3 text-[12.5px] font-semibold text-n-700 hover:border-teal-300">Done</button>
          </div>
        </div>
      )}
    </>
  );
}

const Hint = ({ children }: { children: React.ReactNode }) => (
  <p className="rounded-md border border-n-200 bg-n-25 px-3 py-2 text-[12.5px] text-n-600">{children}</p>
);
