import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Plus, Settings2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { DatePicker, Select } from '@masquare/ui';
import {
  countriesApi, productsApi, salesChannelsApi, salesTransactionsApi, shippingServicesApi, vatClassesApi,
  type RefLite, type SalesTransaction,
} from '../lib/api';
import { useAuth } from '../lib/auth';
import { RefField } from '../components/products/RefField';
import { CountrySelect } from '../components/common/CountrySelect';
import { ProductSkuField } from '../components/sales/ProductSkuField';
import { SerialPicker } from '../components/sales/SerialPicker';
import { useConfirm } from '../components/ConfirmProvider';

interface ItemForm {
  productId: string | null;
  sku: string;
  quantity: string;
  /** Chosen units, for serial-tracked products only. */
  serials?: string[];
  netSalesAmount: string;
  vatAmount: string;
  shippingAmount: string;
  shippingAmountVat: string;
  salesChannelSalesFeeAmount: string;
  /** Local sales only: the user types the unit net price; the line total is unit × qty. */
  unitNetPrice: string;
  /** Local sales only: '' means "use the product's class" (the server resolves it). */
  vatClassId: string;
  /** Optional per-line unit cost override (EUR); '' = use the product's stored cost. */
  unitNetCost: string;
  /** UI only — whether this row's advanced panel is expanded. */
  open: boolean;
}

const emptyItem = (): ItemForm => ({
  productId: null, sku: '', quantity: '1', netSalesAmount: '', vatAmount: '', shippingAmount: '',
  shippingAmountVat: '', salesChannelSalesFeeAmount: '', unitNetPrice: '', vatClassId: '', unitNetCost: '', open: false,
});
const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s));
const today = () => new Date().toISOString().slice(0, 10);
const round2 = (v: number) => Number(v.toFixed(2));
const eur = (n: number) => `€${n.toFixed(2)}`;
/** The unit cost (EUR) the profit calc will use for a product: its moving-average landed cost once
 *  received, else the catalogue purchase cost when that's already in EUR. Null when it can't be
 *  resolved in EUR on the client (a non-EUR catalogue cost with no average yet) — the server
 *  converts it at save time. Shown/pre-filled in the per-line cost field so the operator sees it. */
const resolvedUnitCostEur = (p?: { averageCostEur: number | null; purchaseCost: { amount: number | null; currency: string } } | null): number | null => {
  if (!p) return null;
  if (p.averageCostEur != null) return p.averageCostEur;
  if (p.purchaseCost?.amount != null && p.purchaseCost.currency === 'EUR') return p.purchaseCost.amount;
  return null;
};
const CCY_SYM: Record<string, string> = { EUR: '€', GBP: '£', USD: '$', JPY: '¥', AUD: 'A$', CAD: 'C$', NZD: 'NZ$', SGD: 'S$' };
/** Amount in a given currency, e.g. ¥7788.00 / A$795.00 / €50.00 (defaults to €). */
const money = (n: number, ccy?: string) => `${ccy ? CCY_SYM[ccy] ?? `${ccy} ` : '€'}${n.toFixed(2)}`;
/** Short tax label for a transaction's tax regime, e.g. GST / JCT / VAT. */
const taxShortLabel = (taxType?: string | null) =>
  taxType === 'gst' ? 'GST' : taxType === 'jct' ? 'JCT' : taxType === 'sales_tax' ? 'Tax' : 'VAT';

/** Stored line nets are already net of the sale's discount, but the user types the price
 *  BEFORE discount — so scale them back up on load, or re-saving would discount twice.
 *  A percentage scales every line uniformly (same factor for both bases); a fixed amount
 *  is recovered against the net total ('net' base) or the VAT-inclusive total ('gross'). */
function preDiscountRatio(t: SalesTransaction | null): number {
  if (!t?.discountType || !t.discountValue) return 1;
  if (t.discountType === 'percentage') {
    return t.discountValue >= 100 ? 1 : 1 / (1 - t.discountValue / 100);
  }
  const netTotal = t.items.reduce((s, i) => s + (i.netSalesAmount ?? 0), 0);
  if (netTotal <= 0) return 1;
  if ((t.discountBase ?? 'net') === 'gross') {
    const grossTotal = t.items.reduce((s, i) => s + (i.netSalesAmount ?? 0) + (i.vatAmount ?? 0), 0);
    if (grossTotal <= 0) return 1;
    return (grossTotal + t.discountValue) / grossTotal;
  }
  return (netTotal + t.discountValue) / netTotal;
}

/** One form field. The label is a fixed single line so every input in a grid row starts at
 *  the same y, and any supporting text sits BELOW the input — so it never shifts the field
 *  out of alignment with its neighbours. */
function Field({ label, hint, className, children }: { label: ReactNode; hint?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <div className={`flex min-w-0 flex-col ${className ?? ''}`}>
      <label className="mb-1.5 block h-4 truncate text-[12px] font-semibold leading-4 text-n-600">{label}</label>
      {children}
      {hint ? <div className="mt-1 text-[11px] leading-4 text-n-400">{hint}</div> : null}
    </div>
  );
}

/** Money input with a currency prefix inside the field. */
function MoneyInput({ ccy, value, onChange, placeholder = '0.00' }: { ccy?: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  const sym = ccy ? CCY_SYM[ccy] ?? ccy : '';
  return (
    <div className="relative">
      {ccy && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[12.5px] text-n-400">{sym}</span>}
      <input
        className={`input mono ${ccy ? (sym.length <= 1 ? 'pl-7' : 'pl-12') : ''}`}
        inputMode="decimal"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export function SalesTransactionFormPage() {
  const { id } = useParams();
  const { data: transaction, isLoading } = useQuery({
    queryKey: ['sales-transaction', id],
    queryFn: () => salesTransactionsApi.get(id!),
    enabled: !!id,
  });
  if (id && isLoading) {
    return <div className="card px-4 py-16 text-center text-[13px] text-n-500">Loading transaction…</div>;
  }
  // Key on the id so the form state initialises once from the loaded transaction.
  return <TransactionForm key={id ?? 'new'} transaction={transaction ?? null} />;
}

function TransactionForm({ transaction }: { transaction: SalesTransaction | null }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { activeCompanyId, user } = useAuth();
  const isAdmin = !!user?.isAdmin;
  const locked = !!transaction && transaction.status === 'submitted' && !transaction.unlockedForEdit && !isAdmin;
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const touch = () => setDirty(true);

  const { data: channels = [] } = useQuery({ queryKey: ['sales-channels'], queryFn: () => salesChannelsApi.list() });
  const { data: services = [] } = useQuery({ queryKey: ['shipping-services'], queryFn: () => shippingServicesApi.list() });
  const { data: countries = [] } = useQuery({ queryKey: ['countries'], queryFn: () => countriesApi.list() });
  const { data: vatClasses = [] } = useQuery({ queryKey: ['vat-classes'], queryFn: () => vatClassesApi.list() });

  const [date, setDate] = useState(transaction ? transaction.date.slice(0, 10) : today());
  const [channel, setChannel] = useState<RefLite | null>(transaction?.salesChannel ?? null);
  const [transactionRef, setTransactionRef] = useState(transaction?.transactionRef ?? '');
  const [destinationCountryId, setDestinationCountryId] = useState<string | null>(transaction?.destinationCountryId ?? null);
  const [shippingServiceId, setShippingServiceId] = useState<string | null>(transaction?.shippingServiceId ?? null);
  const [serviceOverridden, setServiceOverridden] = useState(!!transaction);
  const [destinationVatPct, setDestinationVatPct] = useState<string>(transaction?.destinationCountryVatPct != null ? String(transaction.destinationCountryVatPct) : '');
  const [vatOverridden, setVatOverridden] = useState(transaction?.vatOverridden ?? false);
  const [deliveryMethod, setDeliveryMethod] = useState<string>(transaction?.deliveryMethod ?? 'pickup');
  const [localShippingCost, setLocalShippingCost] = useState<string>(transaction?.localShippingCostEur?.toString() ?? '');
  const [discountType, setDiscountType] = useState<string>(transaction?.discountType ?? '');
  const [discountValue, setDiscountValue] = useState<string>(transaction?.discountValue?.toString() ?? '');
  const [discountBase, setDiscountBase] = useState<'net' | 'gross'>(transaction?.discountBase ?? 'net');
  const [items, setItems] = useState<ItemForm[]>(
    transaction?.items.map((i) => ({
      productId: i.productId ?? null, sku: i.sku, quantity: String(i.quantity), serials: (i as any).serials ?? [],
      netSalesAmount: i.netSalesAmount?.toString() ?? '', vatAmount: i.vatAmount?.toString() ?? '',
      shippingAmount: i.shippingAmount?.toString() ?? '', shippingAmountVat: i.shippingAmountVat?.toString() ?? '',
      salesChannelSalesFeeAmount: i.salesChannelSalesFeeAmount?.toString() ?? '',
      unitNetPrice: i.netSalesAmount != null && i.quantity
        ? String(round2((i.netSalesAmount * preDiscountRatio(transaction)) / i.quantity))
        : '',
      vatClassId: i.vatClassId ?? '',
      unitNetCost: i.unitNetCostEur?.toString() ?? '',
      open: false,
    })) ?? [emptyItem()],
  );

  const selected = channels.find((c) => c.id === channel?.id);
  // The mode is derived from the channel — the server branches on exactly this, so the
  // toggle below sets the channel rather than a separate flag the server can't see.
  const isLocal = selected?.kind === 'local';
  const localChannel = channels.find((c) => c.kind === 'local');
  // A transaction pulled from a sales-channel API is inherently a channel sale (integrationId is
  // set only on imported records) — it can never be converted to a local sale, so the Local option
  // is removed from the mode toggle when editing one.
  const channelApiSourced = transaction?.integrationId != null;
  const nativeCcy = isLocal ? 'EUR' : selected?.nativeCurrency ?? '';
  const feeCcy = selected ? (selected.feeChargedInNativeCurrency ? selected.nativeCurrency : selected.feeCurrency) ?? '' : '';

  const setMode = (m: 'marketplace' | 'local') => {
    if (m === 'local') {
      if (localChannel) setChannel({ id: localChannel.id, name: localChannel.name });
    } else if (isLocal) {
      setChannel(null); // back to a marketplace: let the user pick which one
    }
    touch();
  };

  const lineProductIds = useMemo(() => [...new Set(items.map((i) => i.productId).filter(Boolean) as string[])], [items]);
  const { data: lineProducts = [] } = useQuery({
    queryKey: ['products-by-ids', lineProductIds],
    queryFn: () => productsApi.byIds(lineProductIds),
    // Needed for serial tracking on every channel, not just local VAT resolution.
    enabled: lineProductIds.length > 0,
  });
  const serialTracked = useMemo(
    () => new Set(lineProducts.filter((p) => p.serialTracked).map((p) => p.id)),
    [lineProducts],
  );
  const productVatClassId = useMemo(() => new Map(lineProducts.map((p) => [p.id, p.vatClassId])), [lineProducts]);
  // Product id → the EUR unit cost the profit calc will use (formatted). Feeds the cost field's
  // placeholder for already-saved lines with no override, so the operator can see the cost in play.
  const productCostEur = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of lineProducts) { const c = resolvedUnitCostEur(p); if (c != null) m.set(p.id, round2(c).toFixed(2)); }
    return m;
  }, [lineProducts]);
  const effectiveVatClass = (it: ItemForm) => {
    const id = it.vatClassId || (it.productId ? productVatClassId.get(it.productId) ?? null : null);
    return id ? vatClasses.find((v) => v.id === id) ?? null : null;
  };

  const setItem = (i: number, patch: Partial<ItemForm>) => { setItems((r) => r.map((x, idx) => (idx === i ? { ...x, ...patch } : x))); touch(); };
  const canSave = useMemo(() => transactionRef.trim() && items.some((i) => i.sku.trim()), [transactionRef, items]);

  const handleDestination = (v: string | null) => {
    setDestinationCountryId(v);
    touch();
    const c = countries.find((x) => x.id === v);
    if (!serviceOverridden) setShippingServiceId(c?.defaultShippingServiceId ?? null);
  };

  const overallValue = useMemo(() =>
    items.reduce((s, i) => s + (Number(i.netSalesAmount) || 0) + (Number(i.vatAmount) || 0) + (Number(i.shippingAmount) || 0) + (Number(i.shippingAmountVat) || 0), 0),
    [items],
  );
  const ruleVat = useMemo(() => {
    if (selected?.vatThresholdEnabled && selected.vatThresholdAmount != null) {
      return overallValue <= selected.vatThresholdAmount ? selected.vatBelowThresholdPct ?? null : selected.vatAboveThresholdPct ?? null;
    }
    return null;
  }, [selected, overallValue]);
  const effectiveVat = useMemo(() => {
    if (ruleVat != null) return ruleVat;
    return countries.find((c) => c.id === destinationCountryId)?.vatRate ?? null;
  }, [ruleVat, countries, destinationCountryId]);

  useEffect(() => { if (!vatOverridden) setDestinationVatPct(effectiveVat != null ? String(effectiveVat) : ''); }, [effectiveVat, vatOverridden]);
  useEffect(() => {
    if (isLocal && !destinationCountryId && selected?.nativeCountryId) setDestinationCountryId(selected.nativeCountryId);
  }, [isLocal, destinationCountryId, selected?.nativeCountryId]);

  /** Live totals. Local mirrors the server's resolveLocalVat exactly (unit × qty, discount
   *  spread by net share, VAT = round2(lineNet × rate)); marketplace simply sums the amounts
   *  the channel reported. Profit stays server-side — see the Profit & costs card. */
  const totals = useMemo(() => {
    const rows = items.filter((it) => it.sku.trim());
    if (isLocal) {
      // Mirrors the server's resolveLocalVat: a 'net'-base discount comes off the line net
      // (VAT then charged on the discounted net); a 'gross'-base discount comes off the
      // VAT-inclusive line, and net/VAT are backed out from what remains.
      const onGross = discountBase === 'gross';
      const lines = rows.map((it) => {
        const cls = effectiveVatClass(it);
        const rate = cls ? cls.ratePct : 0;
        const lineNet = round2((Number(it.unitNetPrice) || 0) * (Number(it.quantity) || 0));
        return { net: lineNet, gross: round2(lineNet * (1 + rate / 100)), cls, rate };
      });
      const netTotal = round2(lines.reduce((s, l) => s + l.net, 0));
      const grossTotal = round2(lines.reduce((s, l) => s + l.gross, 0));
      const base = onGross ? grossTotal : netTotal;
      const value = Number(discountValue) || 0;
      let discount = 0;
      if (discountType && value > 0 && base > 0) {
        discount = discountType === 'percentage' ? round2(base * (Math.min(value, 100) / 100)) : round2(Math.min(value, base));
      }
      const tooBig = !!discountType && value > 0 && (discountType === 'percentage' ? value > 100 : value > base);
      const byRate = new Map<number, number>();
      let net = 0, allocated = 0, missingClass = false;
      lines.forEach((l, idx) => {
        const weight = onGross ? l.gross : l.net;
        let share = 0;
        if (discount > 0 && base > 0) {
          share = idx === lines.length - 1 ? round2(discount - allocated) : round2((weight / base) * discount);
          allocated = round2(allocated + share);
        }
        let lineNet: number, lineVat: number;
        if (onGross) {
          const discountedGross = round2(l.gross - share);
          lineNet = round2(discountedGross / (1 + l.rate / 100));
          lineVat = round2(discountedGross - lineNet);
        } else {
          lineNet = round2(l.net - share);
          lineVat = round2(lineNet * (l.rate / 100));
        }
        net = round2(net + lineNet);
        if (!l.cls) { missingClass = true; return; }
        byRate.set(l.rate, round2((byRate.get(l.rate) ?? 0) + lineVat));
      });
      const vat = round2([...byRate.values()].reduce((s, v) => s + v, 0));
      return { subtotal: base, discount, net, vat, shipping: 0, gross: round2(net + vat), byRate: [...byRate.entries()].sort((a, b) => b[0] - a[0]), missingClass, tooBig };
    }
    const net = round2(rows.reduce((s, i) => s + (Number(i.netSalesAmount) || 0), 0));
    const vat = round2(rows.reduce((s, i) => s + (Number(i.vatAmount) || 0), 0));
    const shipping = round2(rows.reduce((s, i) => s + (Number(i.shippingAmount) || 0) + (Number(i.shippingAmountVat) || 0), 0));
    return { subtotal: net, discount: 0, net, vat, shipping, gross: round2(net + vat + shipping), byRate: [] as [number, number][], missingClass: false, tooBig: false };
  }, [items, isLocal, vatClasses, productVatClassId, discountType, discountValue, discountBase]);

  const saveWith = async (status: 'draft' | 'submitted') => {
    if (!canSave) { toast.error(`${isLocal ? 'Accounting ref' : 'Transaction ID'} and at least one SKU are required`); return; }
    // Submitting is the committing step — confirm it. Saving a draft is freely reversible.
    if (status === 'submitted' && !(await confirm({
      title: 'Submit this sales transaction?',
      message: 'It will be finalised. If stock deduction is on, its items come off stock now.',
      confirmLabel: 'Submit',
    }))) return;
    setBusy(true);
    try {
      const body = isLocal
        ? {
            date, transactionRef, status,
            salesChannelId: channel?.id ?? null,
            destinationCountryId,
            shippingServiceId: null,
            vatOverridden: false,
            destinationVatPct: null,
            deliveryMethod,
            localShippingCostEur: numOrNull(localShippingCost),
            discountType: discountType ? discountType : null,
            discountValue: discountType ? numOrNull(discountValue) : null,
            discountBase: discountType ? discountBase : null,
            companyId: activeCompanyId,
            items: items.filter((i) => i.sku.trim()).map((i) => ({
              productId: i.productId, sku: i.sku,
              quantity: Number(i.quantity || 1),
              ...(i.serials?.length ? { serials: i.serials } : {}),
              netSalesAmount: round2((Number(i.unitNetPrice) || 0) * (Number(i.quantity) || 0)),
              vatClassId: i.vatClassId || (i.productId ? productVatClassId.get(i.productId) ?? null : null),
              unitNetCostEur: numOrNull(i.unitNetCost),
            })),
          }
        : {
            date, transactionRef, status,
            salesChannelId: channel?.id ?? null,
            destinationCountryId,
            shippingServiceId,
            vatOverridden,
            destinationVatPct: vatOverridden ? (destinationVatPct.trim() === '' ? null : Number(destinationVatPct)) : null,
            companyId: activeCompanyId,
            items: items.filter((i) => i.sku.trim()).map((i) => ({
              productId: i.productId, sku: i.sku,
              quantity: Number(i.quantity || 1),
              ...(i.serials?.length ? { serials: i.serials } : {}),
              netSalesAmount: numOrNull(i.netSalesAmount),
              vatAmount: numOrNull(i.vatAmount),
              shippingAmount: numOrNull(i.shippingAmount),
              shippingAmountVat: numOrNull(i.shippingAmountVat),
              salesChannelSalesFeeAmount: numOrNull(i.salesChannelSalesFeeAmount),
              unitNetCostEur: numOrNull(i.unitNetCost),
            })),
          };
      if (transaction) await salesTransactionsApi.update(transaction.id, body);
      else await salesTransactionsApi.create(body);
      toast.success(status === 'submitted' ? 'Transaction submitted' : 'Draft saved');
      qc.invalidateQueries({ queryKey: ['sales-transactions'] });
      navigate('/sales-transactions');
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const requestUnlock = async () => {
    if (!transaction) return;
    setBusy(true);
    try {
      const res: any = await salesTransactionsApi.requestUnlock(transaction.id);
      toast.success(res?.alreadyRequested ? 'An unlock request is already pending' : 'Unlock request sent to an admin');
      navigate('/sales-transactions');
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Could not send request');
    } finally {
      setBusy(false);
    }
  };

  const profit = transaction?.profit ?? null;
  const profitPct = transaction?.profitPct ?? null;
  const profitColor = profit == null ? undefined : profit >= 0 ? '#0F857D' : 'var(--danger)';
  // FX for showing the EUR equivalent of any native-currency figure in Profit & costs. Sale amounts
  // use the transaction rate; fees/points use the fee rate (falls back to the transaction rate).
  const fx = transaction?.exchangeRate ?? null;
  const feeFx = transaction?.feeExchangeRate ?? fx;
  const showEur = !!nativeCcy && nativeCcy !== 'EUR'; // sale amounts in a non-EUR currency
  const showEurFee = !!feeCcy && feeCcy !== 'EUR'; // fees charged in a non-EUR currency
  // Native → EUR. When there's no rate (local sale, already EUR) the amount is its own EUR value.
  const toEur = (n: number | null | undefined) => (n == null ? null : fx != null ? round2(n * fx) : n);
  const toEurFee = (n: number | null | undefined) => (n == null ? null : feeFx != null ? round2(n * feeFx) : n);
  // `= €x` sub-line, only when the amount was in a non-EUR currency.
  const eurSub = (n: number | null | undefined, fee = false) => {
    if (!(fee ? showEurFee : showEur)) return undefined;
    const v = fee ? toEurFee(n) : toEur(n);
    return v != null ? `= ${eur(v)}` : undefined;
  };
  // Line table columns — same shape in both modes, but the middle three differ by what the
  // channel actually reports (local: unit price + VAT class; marketplace: the reported amounts).
  const cols = 'minmax(200px,1fr) 74px 120px 150px 108px 34px 34px';

  return (
    <div className="-mx-8 -my-7 flex min-h-full flex-col max-[760px]:-mx-4 max-[760px]:-my-5">
      {/* Sticky action bar. The scroll container (AppShell's <main>) has py-7, and a sticky
          offset is measured from its padding box — so top-0 would pin the bar 28px below the
          app's top bar. Offsetting by that padding keeps it flush, at rest and when stuck. */}
      <div className="sticky -top-7 z-30 flex flex-wrap items-center gap-4 border-b border-n-200 bg-n-0 px-8 py-4 max-[760px]:-top-5 max-[760px]:px-4">
        <div className="min-w-0 flex-1">
          <button
            type="button"
            className="mb-0.5 inline-flex items-center gap-1 text-[12.5px] font-semibold text-n-500 hover:text-teal-700"
            onClick={() => navigate('/sales-transactions')}
          >
            <ChevronLeft size={14} /> Sales Transactions
          </button>
          <h1 className="text-[22px] font-bold tracking-tight text-n-900">
            {transaction ? 'Edit sales transaction' : 'New sales transaction'}
          </h1>
        </div>

        {/* Mode toggle — selects the sales channel, which is what actually drives the mode. Channel
            API-sourced transactions can't become local sales, so the Local option is dropped. */}
        <div className="flex rounded-[11px] bg-n-100 p-[3px]">
          {([['marketplace', 'Marketplace'], ['local', 'Local sale']] as const)
            .filter(([m]) => m !== 'local' || !channelApiSourced)
            .map(([m, label]) => {
            const active = m === 'local' ? isLocal : !isLocal;
            return (
              <button
                key={m}
                type="button"
                disabled={locked || (m === 'local' && !localChannel)}
                onClick={() => setMode(m)}
                className={`rounded-[9px] px-4 py-2 text-[13px] font-semibold transition-colors disabled:opacity-50 ${active ? 'bg-n-0 text-n-900 shadow-xs' : 'text-n-500 hover:text-n-700'}`}
              >
                {label}
              </button>
            );
          })}
        </div>

        <div className="h-[30px] w-px bg-n-200" />
        {locked ? (
          <button className="btn btn-primary" disabled={busy} onClick={requestUnlock}>Request unlock</button>
        ) : (
          <>
            <button className="btn btn-ghost" disabled={busy || !canSave} onClick={() => saveWith('draft')}>Save as draft</button>
            <button className="btn btn-primary" disabled={busy || !canSave} onClick={() => saveWith('submitted')}>
              {busy ? 'Submitting…' : 'Submit'}
            </button>
          </>
        )}
      </div>

      <div className="flex-1 overflow-visible px-8 pb-16 pt-6 max-[760px]:px-4">
        <div className="flex max-w-[1240px] items-start gap-6 max-[1100px]:flex-col">
          {/* ===== FORM COLUMN ===== */}
          <fieldset disabled={locked} className="flex min-w-0 flex-1 flex-col gap-5 border-0 p-0">
            {locked && (
              <div className="rounded-md border border-warning-bd bg-warning-bg px-3 py-2.5 text-[13px] text-warning">
                This transaction is <strong>submitted and locked</strong>. Request an unlock from an admin to edit it.
              </div>
            )}
            {!locked && transaction?.status === 'submitted' && (
              <div className="rounded-md border border-info-bd bg-info-bg px-3 py-2 text-[12.5px] text-info">
                Submitted transaction — saving as submitted re-locks it for non-admins.
              </div>
            )}

            {/* Card 1 — transaction details */}
            <div className="card p-6">
              <div className="text-[15px] font-bold text-n-900">Transaction Details</div>
              <p className="mb-5 mt-0.5 text-[12.5px] text-n-500">
                {isLocal
                  ? 'A local sale is invoiced by us in EUR — no exchange rate, no carrier and no marketplace fee.'
                  : 'Shipping service and destination VAT pre-fill from the destination — override either.'}
              </p>
              <div className="grid grid-cols-3 items-start gap-x-[18px] gap-y-4 max-[760px]:grid-cols-2 max-[520px]:grid-cols-1">
                <Field label="Date">
                  <DatePicker value={date} onChange={(v) => { setDate(v); touch(); }} />
                </Field>

                {!isLocal && (
                  <Field label="Sales channel">
                    <RefField
                      value={channel}
                      placeholder="Sales channel…"
                      list={async (q) => (await salesChannelsApi.list(q)).filter((c) => c.kind !== 'local')}
                      onChange={(v) => { setChannel(v); touch(); }}
                    />
                  </Field>
                )}

                <Field label={isLocal ? 'Accounting ref' : 'Transaction ID'}>
                  <input
                    className="input mono"
                    value={transactionRef}
                    onChange={(e) => { setTransactionRef(e.target.value); touch(); }}
                    placeholder={isLocal ? 'e.g. INV-2026-014' : 'e.g. 402-1234567-1234567'}
                  />
                </Field>

                <Field label="Destination country">
                  <CountrySelect value={destinationCountryId} onChange={handleDestination} />
                </Field>

                {isLocal ? (
                  <>
                    <Field label="Delivery method">
                      <Select
                        value={deliveryMethod}
                        onChange={(v) => { setDeliveryMethod(v); touch(); }}
                        options={[{ value: 'pickup', label: 'Pickup' }, { value: 'own_delivery', label: 'Own delivery' }]}
                      />
                    </Field>
                    <Field label="Delivery cost to us" hint="Our cost, not charged to the buyer.">
                      <MoneyInput ccy="EUR" value={localShippingCost} onChange={(v) => { setLocalShippingCost(v); touch(); }} />
                    </Field>
                  </>
                ) : (
                  <>
                    <Field label="Shipping service" hint="From the destination — editable.">
                      <Select
                        value={shippingServiceId ?? ''}
                        onChange={(v) => { setShippingServiceId(v || null); setServiceOverridden(true); touch(); }}
                        placeholder="—"
                        options={services.map((s) => ({ value: s.id, label: s.name }))}
                      />
                    </Field>
                    <Field
                      label="Destination VAT %"
                      hint={
                        vatOverridden ? (
                          <button type="button" className="text-[11px] text-teal-700 hover:underline" onClick={() => { setVatOverridden(false); touch(); }}>
                            Overridden — reset to auto
                          </button>
                        ) : ruleVat != null ? (
                          <>Marketplace rule: order {overallValue <= (selected?.vatThresholdAmount ?? 0) ? '≤' : '>'} {selected?.vatThresholdCurrency ?? ''}{selected?.vatThresholdAmount} → {ruleVat}%.</>
                        ) : (
                          'From the destination country — editable.'
                        )
                      }
                    >
                      <input
                        className="input mono"
                        inputMode="decimal"
                        value={destinationVatPct}
                        onChange={(e) => { setDestinationVatPct(e.target.value); setVatOverridden(true); touch(); }}
                        placeholder="0"
                      />
                    </Field>
                  </>
                )}
              </div>
            </div>

            {/* Card 2 — line items */}
            <div className="card p-6">
              <div className="mb-4 flex items-baseline justify-between">
                <div>
                  <span className="text-[15px] font-bold text-n-900">Line Items</span>
                  <span className="ml-2 text-[12.5px] text-n-500">{items.length === 1 ? '1 item' : `${items.length} items`}</span>
                </div>
                <span className="text-[12px] text-n-500">
                  Amounts in <span className="mono">{nativeCcy || '—'}</span>
                  {!isLocal && feeCcy && feeCcy !== nativeCcy && <> · fee in <span className="mono">{feeCcy}</span></>}
                </span>
              </div>

              <div className="overflow-x-auto">
                <div className="min-w-[760px]">
                  {/* header */}
                  <div className="grid gap-2.5 border-b border-n-100 px-1 pb-2" style={{ gridTemplateColumns: cols }}>
                    {['Product / SKU', 'Qty', isLocal ? 'Unit net' : 'Net sales', isLocal ? 'VAT class' : taxShortLabel(transaction?.taxType), isLocal ? 'Line net' : 'Line total'].map((h, i) => (
                      <div key={h} className={`text-[11px] font-bold uppercase tracking-wide text-n-500 ${i === 4 ? 'text-right' : ''}`}>{h}</div>
                    ))}
                    <div /><div />
                  </div>

                  {items.map((it, i) => {
                    const lineNet = round2((Number(it.unitNetPrice) || 0) * (Number(it.quantity) || 0));
                    const lineTotal = round2((Number(it.netSalesAmount) || 0) + (Number(it.vatAmount) || 0));
                    return (
                      <div key={i} className="border-b border-n-50">
                        <div className="grid items-center gap-2.5 px-1 py-2.5" style={{ gridTemplateColumns: cols }}>
                          <ProductSkuField
                            value={{ productId: it.productId, sku: it.sku }}
                            onChange={(v) => setItem(i, v)}
                            onPick={(product) => { const c = resolvedUnitCostEur(product); if (c != null) setItem(i, { unitNetCost: round2(c).toFixed(2) }); }}
                          />
                          <input
                            className="input mono text-center"
                            inputMode="numeric"
                            value={it.quantity}
                            onChange={(e) => setItem(i, { quantity: e.target.value })}
                          />
                          {isLocal ? (
                            <>
                              <MoneyInput ccy="EUR" value={it.unitNetPrice} onChange={(v) => setItem(i, { unitNetPrice: v })} />
                              <Select
                                value={it.vatClassId}
                                onChange={(v) => setItem(i, { vatClassId: v })}
                                placeholder={it.productId ? `${effectiveVatClass(it)?.name ?? 'from product'}${effectiveVatClass(it) ? ` (${effectiveVatClass(it)!.ratePct}%)` : ''}` : 'Choose…'}
                                options={vatClasses.map((v) => ({ value: v.id, label: `${v.name} (${v.ratePct}%)` }))}
                              />
                              <div className="mono text-right text-[14px] font-bold text-n-900">{money(lineNet, nativeCcy)}</div>
                            </>
                          ) : (
                            <>
                              <MoneyInput ccy={nativeCcy} value={it.netSalesAmount} onChange={(v) => setItem(i, { netSalesAmount: v })} />
                              <MoneyInput ccy={nativeCcy} value={it.vatAmount} onChange={(v) => setItem(i, { vatAmount: v })} />
                              <div className="mono text-right text-[14px] font-bold text-n-900">{money(lineTotal, nativeCcy)}</div>
                            </>
                          )}
                          <button
                            type="button"
                            title="Advanced"
                            onClick={() => setItem(i, { open: !it.open })}
                            className={`grid h-[34px] w-[34px] place-items-center rounded-[9px] border ${it.open ? 'border-teal-200 bg-teal-50 text-teal-700' : 'border-n-200 bg-n-0 text-n-500 hover:bg-n-50'}`}
                          >
                            <Settings2 size={15} />
                          </button>
                          <button
                            type="button"
                            title="Remove"
                            disabled={items.length === 1}
                            onClick={() => { setItems((r) => r.filter((_, idx) => idx !== i)); touch(); }}
                            className="grid h-[34px] w-[34px] place-items-center rounded-[9px] border border-n-200 bg-n-0 text-n-500 hover:border-danger-bd hover:bg-danger-bg hover:text-danger disabled:opacity-40"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>

                        {/* Serial-tracked lines must name the units before this can be submitted. */}
                        {it.productId && serialTracked.has(it.productId) && (
                          <div className="px-1 pb-2.5">
                            <SerialPicker
                              productId={it.productId}
                              sku={it.sku}
                              quantity={Number(it.quantity) || 0}
                              selected={it.serials ?? []}
                              onChange={(serials) => setItem(i, { serials })}
                            />
                          </div>
                        )}

                        {it.open && (
                          <div className="mx-1 mb-3 grid grid-cols-3 items-start gap-3.5 rounded-[11px] border border-n-100 bg-n-25 p-4 max-[760px]:grid-cols-2">
                            {!isLocal && (
                              <Field label="Shipping charged">
                                <MoneyInput ccy={nativeCcy} value={it.shippingAmount} onChange={(v) => setItem(i, { shippingAmount: v })} />
                              </Field>
                            )}
                            {!isLocal && (
                              <Field label="Shipping VAT">
                                <MoneyInput ccy={nativeCcy} value={it.shippingAmountVat} onChange={(v) => setItem(i, { shippingAmountVat: v })} />
                              </Field>
                            )}
                            {!isLocal && (
                              <Field label="Sales fee" hint="Blank = the channel's estimate.">
                                <MoneyInput ccy={feeCcy} value={it.salesChannelSalesFeeAmount} onChange={(v) => setItem(i, { salesChannelSalesFeeAmount: v })} placeholder="auto" />
                              </Field>
                            )}
                            <Field label="Unit cost" hint="Pre-filled from the product's saved cost — edit to override. Blank uses the product's cost.">
                              <MoneyInput ccy="EUR" value={it.unitNetCost} placeholder={(it.productId && productCostEur.get(it.productId)) || '0.00'} onChange={(v) => setItem(i, { unitNetCost: v })} />
                            </Field>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <button
                type="button"
                onClick={() => { setItems((r) => [...r, emptyItem()]); touch(); }}
                className="mt-4 inline-flex h-10 items-center gap-2 rounded-[10px] border border-dashed border-n-300 bg-n-25 px-4 text-[13.5px] font-semibold text-teal-700 hover:border-teal-400 hover:bg-teal-50"
              >
                <Plus size={16} /> Add line
              </button>
            </div>

            {/* Card 3 — sale-level discount (local only; spread across lines by the server) */}
            {isLocal && (
              <div className="card p-6">
                <div className="text-[15px] font-bold text-n-900">Discount</div>
                <p className="mb-4 mt-0.5 text-[12.5px] text-n-500">
                  Spread across the lines in proportion to their value. Choose whether it comes off the net total or the VAT-inclusive total.
                </p>
                <div className="grid grid-cols-3 items-start gap-x-[18px] gap-y-4 max-[760px]:grid-cols-2 max-[520px]:grid-cols-1">
                  <Field label="Type">
                    <Select
                      value={discountType}
                      onChange={(v) => { setDiscountType(v); if (!v) setDiscountValue(''); touch(); }}
                      placeholder="— no discount —"
                      options={[{ value: 'percentage', label: 'Percentage of total' }, { value: 'fixed', label: 'Fixed amount' }]}
                    />
                  </Field>
                  {discountType && (
                    <Field label={discountType === 'percentage' ? 'Percentage' : 'Amount'}>
                      <div className="relative">
                        <input
                          className="input mono pr-8"
                          inputMode="decimal"
                          value={discountValue}
                          onChange={(e) => { setDiscountValue(e.target.value); touch(); }}
                          placeholder={discountType === 'percentage' ? '10' : '0.00'}
                        />
                        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12.5px] text-n-500">
                          {discountType === 'percentage' ? '%' : '€'}
                        </span>
                      </div>
                    </Field>
                  )}
                  {discountType && (
                    <Field
                      label="Applied on"
                      hint={discountType === 'percentage'
                        ? 'Same final total either way for a percentage.'
                        : discountBase === 'gross' ? 'Total drops by exactly the amount.' : 'VAT drops with the net too.'}
                    >
                      <Select
                        value={discountBase}
                        onChange={(v) => { setDiscountBase(v as 'net' | 'gross'); touch(); }}
                        options={[{ value: 'net', label: 'Net amount' }, { value: 'gross', label: 'Amount incl. VAT' }]}
                      />
                    </Field>
                  )}
                </div>
              </div>
            )}
          </fieldset>

          {/* ===== SUMMARY COLUMN ===== */}
          {/* Sticks just under the action bar. Offsets are in scrollport coords, so this is
              the bar's height minus main's 28px padding, plus a small gap. */}
          <div className="sticky top-[64px] flex w-[340px] flex-none flex-col gap-4 max-[1100px]:static max-[1100px]:w-full">
            <div className="card overflow-hidden p-0">
              <div className="border-b border-n-100 px-5 py-4 text-[12px] font-bold uppercase tracking-wide text-n-500">Totals</div>
              <div className="px-5 py-4">
                {totals.discount > 0 && (
                  <>
                    <Row label={discountBase === 'gross' ? 'Subtotal (incl. VAT)' : 'Subtotal'} value={money(totals.subtotal, nativeCcy)} />
                    <Row label={`Discount${discountType === 'percentage' ? ` (${Number(discountValue) || 0}%)` : ''}`} value={`−${money(totals.discount, nativeCcy)}`} valueColor="var(--danger)" />
                  </>
                )}
                <Row label="Net" value={money(totals.net, nativeCcy)} big />
                <Row label={isLocal ? 'VAT' : taxShortLabel(transaction?.taxType)} value={money(totals.vat, nativeCcy)} />
                {totals.byRate.map(([rate, amount]) => (
                  <div key={rate} className="mt-1 flex justify-between">
                    <span className="text-[12px] text-n-400">{rate}%</span>
                    <span className="mono text-[12px] text-n-400">{money(amount, nativeCcy)}</span>
                  </div>
                ))}
                {totals.shipping > 0 && <Row label="Shipping" value={money(totals.shipping, nativeCcy)} />}
                <div className="mt-4 flex items-baseline justify-between border-t border-n-100 pt-4">
                  <span className="text-[15px] font-bold text-n-900">Gross</span>
                  <span className="code text-[24px] font-bold tracking-tight text-teal-600">{money(totals.gross, nativeCcy)}</span>
                </div>
                {totals.missingClass && (
                  <p className="mt-3 text-[11px] text-warning">
                    A line has no VAT class and no product to inherit one from — choose a class, or the save will be rejected.
                  </p>
                )}
                {totals.tooBig && (
                  <p className="mt-3 text-[11px] text-danger">
                    {discountType === 'percentage' ? 'A percentage discount cannot exceed 100%.' : `Discount is more than the ${eur(totals.subtotal)} subtotal.`}
                  </p>
                )}
              </div>
            </div>

            <div className="card overflow-hidden p-0">
              <div className="border-b border-n-100 px-5 py-4 text-[12px] font-bold uppercase tracking-wide text-n-500">Profit &amp; costs</div>
              <div className="flex flex-col gap-4 px-5 py-4">
                {!transaction ? (
                  <p className="text-[11px] leading-4 text-n-400">Profit and costs are calculated by the server when you save.</p>
                ) : (() => {
                  const t = transaction;
                  const net = t.totals.netSales;
                  const buyerShip = t.totals.shipping;
                  const taxColl = t.totals.vat;
                  const actual = t.shippingCostSource === 'actual';
                  const shipVal = actual ? t.actualShippingCost : t.estimatedShippingCost;
                  const shipLabel = isLocal ? 'Delivery cost' : actual ? 'Actual shipping cost' : 'Est. shipping cost';
                  const productCost = round2((t.items ?? []).reduce((s, it) => s + (it.unitCostEur ?? 0) * (it.quantity ?? 0), 0));
                  return (
                    <>
                      {/* Incoming — money the sale brings in, in its own currency (+ EUR). */}
                      <div>
                        <div className="mb-2 text-[10.5px] font-bold uppercase tracking-wide text-teal-600">Revenue (incoming)</div>
                        <div className="flex flex-col gap-2">
                          <Row label="Net amount" value={money(net, nativeCcy)} sub={eurSub(net)} small />
                          {buyerShip > 0 && <Row label="Buyer-paid shipping" value={money(buyerShip, nativeCcy)} sub={eurSub(buyerShip)} small />}
                          {taxColl > 0 && <Row label={`${t.taxLabel || 'Tax'} collected`} value={money(taxColl, nativeCcy)} sub={eurSub(taxColl)} small />}
                        </div>
                      </div>

                      {/* Outgoing — everything we pay out (shown in EUR; native fees also in their currency). */}
                      <div>
                        <div className="mb-2 text-[10.5px] font-bold uppercase tracking-wide text-orange-600">Costs (outgoing)</div>
                        <div className="flex flex-col gap-2">
                          <Row label="Product cost" value={eur(productCost)} small />
                          <Row label={shipLabel} value={shipVal != null ? eur(shipVal) : '—'} small />
                          {!isLocal && <Row label="Sales fee" value={t.effectiveSalesFee != null ? money(t.effectiveSalesFee, feeCcy) : '—'} sub={eurSub(t.effectiveSalesFee, true)} small />}
                          {!isLocal && t.amazonPoints > 0 && <Row label="Amazon points" value={money(t.amazonPoints, feeCcy)} sub={eurSub(t.amazonPoints, true)} small />}
                          {t.dutyImportCost > 0 && <Row label="Import tax / duty" value={eur(t.dutyImportCost)} small />}
                          {t.returnShippingCost > 0 && <Row label="Return shipping" value={eur(t.returnShippingCost)} small />}
                          {t.refundAmount != null && t.refundAmount > 0 && <Row label="Refund to buyer" value={money(t.refundAmount, nativeCcy)} sub={eurSub(t.refundAmount)} small />}
                        </div>
                      </div>

                      <div className="flex items-baseline justify-between border-t border-n-100 pt-3.5">
                        <span className="text-[14px] font-bold text-n-900">Est. profit</span>
                        <div className="text-right">
                          <div className="mono text-[19px] font-bold" style={{ color: profitColor }}>{profit != null ? eur(profit) : '—'}</div>
                          <div className="text-[12px] font-semibold" style={{ color: profitColor }}>
                            {profitPct != null ? `${profitPct >= 0 ? '+' : ''}${profitPct.toFixed(1)}%` : ''}
                          </div>
                        </div>
                      </div>

                      {!isLocal && (
                        <div className="flex flex-col gap-1 border-t border-n-100 pt-2.5 text-[11px] text-n-400">
                          <div className="flex justify-between"><span>Exchange rate ({nativeCcy || '—'}→EUR)</span><span className="mono">{t.exchangeRate != null ? `${t.exchangeRate}${t.exchangeRateEstimated ? ' (est.)' : ''}` : '—'}</span></div>
                          {showEurFee && feeCcy !== nativeCcy && <div className="flex justify-between"><span>Fee rate ({feeCcy}→EUR)</span><span className="mono">{t.feeExchangeRate ?? '—'}</span></div>}
                          <div className="flex justify-between"><span>Package weight</span><span className="mono">{t.overallPackageWeight != null ? `${t.overallPackageWeight} kg` : '—'}</span></div>
                        </div>
                      )}
                      <p className="text-[11px] leading-4 text-n-400">Profit and costs are calculated by the server; they refresh when you save.</p>
                    </>
                  );
                })()}
              </div>
            </div>

            <div
              className="rounded-xl border px-4 py-3 text-[12.5px] leading-relaxed"
              style={isLocal
                ? { background: '#EEF9F7', borderColor: '#CDEBE6', color: '#0E6B63' }
                : { background: '#FFF6F0', borderColor: '#FAD9C6', color: '#9A5A38' }}
            >
              {isLocal
                ? 'Local sale — amounts in EUR, no exchange rate and no sales fee. VAT is derived from each line’s VAT class when you save.'
                : 'Marketplace sale — the channel’s sales fee and exchange rate apply. Enter the amounts the channel reported.'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, sub, big, small, valueColor }: { label: string; value: string; sub?: string; big?: boolean; small?: boolean; valueColor?: string }) {
  return (
    <div className={`flex items-baseline justify-between ${big || small ? '' : 'mt-3'}`}>
      <span className={`text-n-600 ${small ? 'text-[13.5px]' : 'text-[14px]'}`}>{label}</span>
      <span className="text-right">
        <span
          className={`mono block font-semibold text-n-900 ${big ? 'text-[16px]' : small ? 'text-[13.5px]' : 'text-[15px]'}`}
          style={valueColor ? { color: valueColor } : undefined}
        >
          {value}
        </span>
        {sub && <span className="mono block text-[11px] font-medium text-n-400">{sub}</span>}
      </span>
    </div>
  );
}
