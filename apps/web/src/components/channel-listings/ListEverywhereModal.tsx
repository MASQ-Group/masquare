import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, Ban, Check, Rocket, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { ModalShell } from '@masquare/ui';
import { amazonListingApi, type ListEverywherePreview, type ListEverywhereRow } from '../../lib/api';
import { eurAside } from '../../lib/format';
import { useConfirm } from '../ConfirmProvider';
import { useJobProgress } from '../../lib/useJobProgress';

const SYMBOL: Record<string, string> = { EUR: '€', GBP: '£', USD: '$', CAD: 'CA$', AUD: 'A$', JPY: '¥', SEK: 'kr', PLN: 'zł', AED: 'AED ', SAR: 'SAR ', MXN: 'MX$', TRY: '₺', SGD: 'S$' };
const money = (cents: number, ccy: string) =>
  `${SYMBOL[ccy] ?? `${ccy} `}${(cents / 100).toFixed(ccy === 'JPY' ? 0 : 2)}`;

/**
 * List this product on every marketplace it can go on, at one profit percentage.
 *
 * The most consequential button in the platform: one press creates real, customer-visible offers on
 * up to eighteen marketplaces in a dozen currencies, and there is no undo worth the name — taking a
 * listing down is a separate act on each one.
 *
 * So the preview is the feature and the button is the afterthought. Nothing is sent until every
 * marketplace has been shown with the price it would launch at and what that price earns; every
 * marketplace that would be skipped says why; and the selection starts as whatever the server
 * cleared, which the reader can then take away from rather than having to assemble.
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
  const [margin, setMargin] = useState('20');
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  /**
   * Days to dispatch: one figure for all, and per-channel exceptions over the top.
   *
   * Held here rather than sent on every keystroke — the preview costs a live fee estimate per
   * marketplace, and re-running it on each digit would be both slow and expensive. The server is
   * still the authority: it re-evaluates with these values before writing anything, so a channel
   * this screen thinks is ready can still be refused by name.
   */
  const [handlingAll, setHandlingAll] = useState('');
  const [handlingBy, setHandlingBy] = useState<Record<string, string>>({});
  const job = useJobProgress(`listing.amazon.listEverywhere.${productId}`);

  const wholeDays = (raw: string) => raw.replace(/[^\d]/g, '').slice(0, 2);
  /** What this channel would use, in the same order the server resolves it. */
  const handlingFor = (r: ListEverywhereRow): string =>
    handlingBy[r.integrationId] || handlingAll || (r.handlingTimeDays != null ? String(r.handlingTimeDays) : '');

  const preview = useMutation({
    mutationFn: (pct: number) => amazonListingApi.listEverywherePreview(productId, pct),
    onSuccess: (p: ListEverywherePreview) => {
      // Pre-selected to what the server says is ready — the reader edits down from a working set
      // rather than assembling one. Anything blocked is never selectable at all.
      setChosen(new Set(p.rows.filter((r) => r.canList).map((r) => r.integrationId)));
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not work out where this can be listed'),
  });

  const p = preview.data;
  /**
   * Offerable = the server cleared it, OR the only thing missing was a handling time and one is now
   * on screen. The second case is why the box exists: without it, supplying a dispatch time would
   * mean re-running the whole preview to find out it had worked.
   *
   * Nothing else is ever promoted this way. Every other blocker needs a change somewhere the screen
   * cannot reach, and the server refuses the run outright if this optimism turns out to be wrong.
   */
  const offerable = (r: ListEverywhereRow) => r.canList || (r.blockedOnlyByHandlingTime && handlingFor(r) !== '');
  const ready = p?.rows.filter(offerable) ?? [];
  const blocked = p?.rows.filter((r) => !offerable(r)) ?? [];
  const selected = ready.filter((r) => chosen.has(r.integrationId));

  const toggle = (id: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const go = async () => {
    if (!p || selected.length === 0) return;
    const ok = await confirm({
      title: `List on ${selected.length} marketplace${selected.length === 1 ? '' : 's'}?`,
      // Every marketplace named, not a count. A count is agreed to; a list is read.
      message:
        `${sku} will be listed at ${p.marginPct}% profit on: ${selected.map((r) => `${r.name} (dispatch ${handlingFor(r) || '?'}d)`).join(', ')}.\n\n` +
        'These become real listings customers can buy. Removing one afterwards is a separate action on each marketplace.',
      confirmLabel: `List on ${selected.length}`,
    });
    if (!ok) return;
    job.start(() =>
      amazonListingApi.listEverywhere(productId, p.marginPct, selected.map((r) => r.integrationId), {
        forAll: handlingAll || null,
        byChannel: handlingBy,
      }),
    );
  };

  const result = job.result as { summary?: { submitted: number; failed: number }; results?: Array<{ name: string; ok: boolean; message: string }> } | null;

  return (
    <ModalShell
      open
      title="List on every eligible marketplace"
      subtitle={sku}
      primaryLabel={job.running ? 'Listing…' : `List on ${selected.length || ''}`.trim()}
      onPrimary={go}
      onClose={onClose}
      initialSize={{ w: 760, h: 640 }}
    >
      <div className="flex flex-col gap-3">
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
            onClick={() => preview.mutate(Number(margin))}
            disabled={preview.isPending}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-n-200 bg-n-0 px-3 text-[12.5px] font-semibold text-n-700 hover:border-teal-300 hover:text-teal-700 disabled:opacity-50"
          >
            {preview.isPending ? 'Working it out…' : 'Show me what this would do'}
          </button>
          {/* Said before anything is calculated, so nobody reaches the list expecting it to have
              happened already. */}
          <span className="text-[11.5px] text-n-400">Nothing is sent until you confirm.</span>
        </div>

        {p && (
          <div className="flex flex-wrap items-end gap-2 rounded-md border border-n-200 bg-n-25 px-3 py-2">
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-semibold text-n-600">Days to dispatch, all marketplaces</span>
              <div className="flex items-center gap-1.5">
                <input
                  value={handlingAll}
                  onChange={(e) => setHandlingAll(wholeDays(e.target.value))}
                  inputMode="numeric"
                  placeholder="e.g. 2"
                  className="mono h-8 w-[72px] rounded-md border border-n-200 px-2.5 text-right text-[13px] outline-none focus:border-teal-400"
                />
                <span className="text-[12.5px] text-n-500">days</span>
              </div>
            </label>
            {/* Most products dispatch in the same time everywhere. Typing it eighteen times is how
                the eighteenth ends up different from the rest by accident — so one box fills them
                all, and a marketplace that genuinely differs is overridden on its own row. */}
            <p className="min-w-[220px] flex-1 text-[11.5px] text-n-500">
              Fills in every marketplace that has no figure of its own. Override any single one on its row below.
              {handlingAll !== '' && (
                <> Whole days only — this is the dispatch promise shown to the customer.</>
              )}
            </p>
          </div>
        )}

        {!p && !preview.isPending && (
          <p className="rounded-md border border-n-200 bg-n-25 px-3 py-2 text-[12.5px] text-n-600">
            Each marketplace is priced to earn this percentage, using the same cost basis as every other profit
            figure here — landed cost, that marketplace's fees, its VAT and today's rate. The price therefore differs
            per marketplace, because the deductions do.
          </p>
        )}

        {p && (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-n-200 bg-n-25 px-3 py-2 text-[12.5px]">
              <span className="text-teal-700"><b>{p.summary.ready}</b> can be listed</span>
              <span className="text-n-500"><b>{p.summary.blocked}</b> cannot</span>
              {p.summary.warned > 0 && <span className="text-amber-700"><b>{p.summary.warned}</b> with a warning</span>}
              <span className="text-n-400">at {p.marginPct}% profit</span>
            </div>

            {!p.liveWritesEnabled && (
              <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
                <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-600" />
                <span>
                  Creating listings is switched off, so this will refuse rather than send. Turn on “Create real
                  marketplace listings” in Settings → General first.
                </span>
              </div>
            )}

            {ready.length > 0 && (
              <div className="rounded-lg border border-n-200">
                <div className="flex items-center gap-2 border-b border-n-100 px-3 py-2">
                  <span className="flex-1 text-[12px] font-semibold text-n-700">
                    Will be listed ({selected.length} of {ready.length} selected)
                  </span>
                  {/* A marketplace unblocked by a handling time typed a moment ago is NOT ticked for
                      you. Silently adding marketplaces to a destructive action as somebody types is
                      how a listing appears somewhere nobody chose — so it stays an explicit act,
                      with one button rather than eighteen clicks. */}
                  <button
                    type="button"
                    onClick={() => setChosen(new Set(ready.map((r) => r.integrationId)))}
                    className="text-[11.5px] font-semibold text-teal-700 hover:underline"
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    onClick={() => setChosen(new Set())}
                    className="text-[11.5px] font-semibold text-n-500 hover:underline"
                  >
                    Clear
                  </button>
                </div>
                {ready.map((r) => (
                  <Row
                    key={r.integrationId}
                    row={r}
                    checked={chosen.has(r.integrationId)}
                    onToggle={() => toggle(r.integrationId)}
                    handling={handlingFor(r)}
                    onHandling={(v) => setHandlingBy((prev) => ({ ...prev, [r.integrationId]: wholeDays(v) }))}
                    inheritedFromAll={!handlingBy[r.integrationId] && handlingAll !== ''}
                  />
                ))}
              </div>
            )}

            {blocked.length > 0 && (
              <div className="rounded-lg border border-n-200">
                <div className="border-b border-n-100 px-3 py-2 text-[12px] font-semibold text-n-500">
                  Skipped ({blocked.length})
                </div>
                {blocked.map((r) => (
                  <div key={r.integrationId} className="flex items-start gap-2 border-b border-n-50 px-3 py-2 last:border-b-0">
                    <Ban size={13} className="mt-0.5 shrink-0 text-n-300" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[12.5px] font-semibold text-n-600">{r.name}</div>
                      {/* Every reason, not the first. Fixing one at a time and re-running across
                          eighteen marketplaces is a slow way to find four problems. */}
                      <ul className="mt-0.5 list-disc pl-4 text-[11.5px] text-n-500">
                        {r.blockers.map((b) => <li key={b}>{b}</li>)}
                      </ul>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {job.running && (
          <div className="rounded-md border border-n-200 bg-n-25 px-3 py-2 text-[12.5px] text-n-600">
            {job.detail || 'Listing…'}
          </div>
        )}
        {job.error && !job.running && (
          <div className="flex items-start gap-2 rounded-md border border-danger-bd bg-danger-bg px-3 py-2 text-[12.5px] text-danger">
            <Ban size={13} className="mt-0.5 shrink-0" />
            {/* The server refuses the whole run when a chosen marketplace stopped being listable
                between the preview and the press. Shown verbatim, because it names which. */}
            <span>{String(job.error)}</span>
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
            {/* Submitted is not live. Amazon publishes asynchronously and can still reject. */}
            <div className="px-3 py-2 text-[11.5px] text-n-400">
              Submitted is not the same as live — Amazon publishes these over the next few minutes and can still
              reject one. The next sync is what confirms them.
            </div>
            <div className="px-3 pb-3">
              <button
                type="button"
                onClick={onDone}
                className="inline-flex h-8 items-center rounded-md border border-n-200 bg-n-0 px-3 text-[12.5px] font-semibold text-n-700 hover:border-teal-300"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </ModalShell>
  );
}

function Row({
  row, checked, onToggle, handling, onHandling, inheritedFromAll,
}: {
  row: ListEverywhereRow;
  checked: boolean;
  onToggle: () => void;
  handling: string;
  onHandling: (value: string) => void;
  inheritedFromAll: boolean;
}) {
  const loss = row.profitCents != null && row.profitCents <= 0;
  return (
    <div className="flex items-start gap-2 border-b border-n-50 px-3 py-2 last:border-b-0 hover:bg-n-25">
      {/* Not a <label> wrapping the whole row any more: it contains a text input, and clicking that
          would toggle the checkbox. */}
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        aria-label={`List on ${row.name}`}
        className="mt-0.5 h-4 w-4 cursor-pointer accent-teal-600"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <span className="text-[12.5px] font-semibold text-n-800">{row.name}</span>
          {row.priceCents != null && (
            <span className="mono text-[12.5px] font-semibold text-n-900">{money(row.priceCents, row.currency)}</span>
          )}
          {row.profitCents != null && (
            <span className={`text-[12px] ${loss ? 'text-danger' : 'text-teal-700'}`}>
              {loss ? 'loses' : 'earns'} {money(Math.abs(row.profitCents), row.currency)}
              {eurAside(row.profitEurCents == null ? null : Math.abs(row.profitEurCents), row.currency) &&
                ` = ${eurAside(Math.abs(row.profitEurCents!), row.currency)}`}
            </span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <span className="text-[11.5px] text-n-500">Dispatch in</span>
          <input
            value={handling}
            onChange={(e) => onHandling(e.target.value)}
            inputMode="numeric"
            placeholder="—"
            aria-label={`Days to dispatch on ${row.name}`}
            className="mono h-7 w-[54px] rounded-md border border-n-200 px-2 text-right text-[12px] outline-none focus:border-teal-400"
          />
          <span className="text-[11.5px] text-n-500">days</span>
          {/* Where the figure came from, in plain words. A handling time is a promise made to a
              customer, and one arriving from a marketplace nobody was looking at — or from a box at
              the top filling in silently — deserves to be seen before it is agreed to. */}
          {handling !== '' && (
            <span className="text-[11px] text-n-400">
              {inheritedFromAll
                ? 'from the figure above'
                : row.handlingTimeSource === 'borrowed'
                  ? 'copied from another marketplace'
                  : row.handlingTimeSource === 'plan'
                    ? 'already set for this marketplace'
                    : ''}
            </span>
          )}
          {handling === '' && (
            <span className="text-[11px] text-amber-700">needed before this one can be listed</span>
          )}
        </div>
        {row.warnings.map((w) => (
          <div key={w} className="mt-0.5 flex items-start gap-1 text-[11.5px] text-amber-700">
            <TriangleAlert size={11} className="mt-0.5 shrink-0" /> <span>{w}</span>
          </div>
        ))}
      </div>
      <Rocket size={13} className="mt-1 shrink-0 text-n-300" />
    </div>
  );
}
