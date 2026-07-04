import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ModalShell } from '@masquare/ui';
import { countriesApi, salesChannelsApi, salesTransactionsApi, shippingServicesApi, type RefLite, type SalesTransaction } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { RefField } from '../products/RefField';
import { CountrySelect } from '../common/CountrySelect';
import { ProductSkuField } from './ProductSkuField';

interface Props {
  transaction: SalesTransaction | null;
  onClose: () => void;
  onSaved: () => void;
}

interface ItemForm {
  productId: string | null;
  sku: string;
  quantity: string;
  netSalesAmount: string;
  vatAmount: string;
  shippingAmount: string;
  shippingAmountVat: string;
  salesChannelSalesFeeAmount: string;
}

const emptyItem = (): ItemForm => ({ productId: null, sku: '', quantity: '1', netSalesAmount: '', vatAmount: '', shippingAmount: '', shippingAmountVat: '', salesChannelSalesFeeAmount: '' });
const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s));
const today = () => new Date().toISOString().slice(0, 10);

export function SalesTransactionModal({ transaction, onClose, onSaved }: Props) {
  const { activeCompanyId, user } = useAuth();
  const isAdmin = !!user?.isAdmin;
  const locked = !!transaction && transaction.status === 'submitted' && !transaction.unlockedForEdit && !isAdmin;
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const touch = () => setDirty(true);
  const { data: channels = [] } = useQuery({ queryKey: ['sales-channels'], queryFn: () => salesChannelsApi.list() });
  const { data: services = [] } = useQuery({ queryKey: ['shipping-services'], queryFn: () => shippingServicesApi.list() });
  const { data: countries = [] } = useQuery({ queryKey: ['countries'], queryFn: () => countriesApi.list() });

  const [date, setDate] = useState(transaction ? transaction.date.slice(0, 10) : today());
  const [channel, setChannel] = useState<RefLite | null>(transaction?.salesChannel ?? null);
  const [transactionRef, setTransactionRef] = useState(transaction?.transactionRef ?? '');
  const [destinationCountryId, setDestinationCountryId] = useState<string | null>(transaction?.destinationCountryId ?? null);
  const [shippingServiceId, setShippingServiceId] = useState<string | null>(transaction?.shippingServiceId ?? null);
  const [serviceOverridden, setServiceOverridden] = useState(!!transaction);
  const [destinationVatPct, setDestinationVatPct] = useState<string>(transaction?.destinationCountryVatPct != null ? String(transaction.destinationCountryVatPct) : '');
  const [vatOverridden, setVatOverridden] = useState(!!transaction);
  const [items, setItems] = useState<ItemForm[]>(
    transaction?.items.map((i) => ({
      productId: i.productId ?? null, sku: i.sku, quantity: String(i.quantity),
      netSalesAmount: i.netSalesAmount?.toString() ?? '', vatAmount: i.vatAmount?.toString() ?? '',
      shippingAmount: i.shippingAmount?.toString() ?? '', shippingAmountVat: i.shippingAmountVat?.toString() ?? '',
      salesChannelSalesFeeAmount: i.salesChannelSalesFeeAmount?.toString() ?? '',
    })) ?? [emptyItem()],
  );

  const selected = channels.find((c) => c.id === channel?.id);
  const nativeCcy = selected?.nativeCurrency ?? '';
  const feeCcy = selected ? (selected.feeChargedInNativeCurrency ? selected.nativeCurrency : selected.feeCurrency) ?? '' : '';

  const setItem = (i: number, patch: Partial<ItemForm>) => { setItems((r) => r.map((x, idx) => (idx === i ? { ...x, ...patch } : x))); touch(); };
  const canSave = useMemo(() => transactionRef.trim() && items.some((i) => i.sku.trim()), [transactionRef, items]);

  // When the destination changes, default the shipping service to that country's default
  // (unless the user has picked one explicitly).
  const handleDestination = (v: string | null) => {
    setDestinationCountryId(v);
    touch();
    const c = countries.find((x) => x.id === v);
    if (!serviceOverridden) setShippingServiceId(c?.defaultShippingServiceId ?? null);
    if (!vatOverridden) setDestinationVatPct(c && c.vatRate != null ? String(c.vatRate) : '');
  };

  // Live-computed calculated field (server recomputes the rest on save).
  const liveSalesFeePct = useMemo(() => {
    const base = items.reduce((s, i) => s + (Number(i.netSalesAmount) || 0) + (Number(i.vatAmount) || 0) + (Number(i.shippingAmount) || 0) + (Number(i.shippingAmountVat) || 0), 0);
    const fee = items.reduce((s, i) => s + (Number(i.salesChannelSalesFeeAmount) || 0), 0);
    return base > 0 ? (fee / base) * 100 : null;
  }, [items]);

  const saveWith = async (status: 'draft' | 'submitted') => {
    if (!canSave) { toast.error('Transaction ID and at least one SKU are required'); return; }
    setBusy(true);
    try {
      const body = {
        date, transactionRef, status,
        salesChannelId: channel?.id ?? null,
        destinationCountryId,
        shippingServiceId,
        destinationVatPct: destinationVatPct.trim() === '' ? null : Number(destinationVatPct),
        companyId: activeCompanyId,
        items: items.filter((i) => i.sku.trim()).map((i) => ({
          productId: i.productId, sku: i.sku,
          quantity: Number(i.quantity || 1),
          netSalesAmount: numOrNull(i.netSalesAmount),
          vatAmount: numOrNull(i.vatAmount),
          shippingAmount: numOrNull(i.shippingAmount),
          shippingAmountVat: numOrNull(i.shippingAmountVat),
          salesChannelSalesFeeAmount: numOrNull(i.salesChannelSalesFeeAmount),
        })),
      };
      if (transaction) await salesTransactionsApi.update(transaction.id, body); else await salesTransactionsApi.create(body);
      toast.success(status === 'submitted' ? 'Transaction submitted' : 'Draft saved');
      onSaved();
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
      onClose();
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Could not send request');
    } finally {
      setBusy(false);
    }
  };

  const ccy = (c: string) => (c ? c : '—');

  return (
    <ModalShell open title={transaction ? 'Edit sales transaction' : 'Register sales transaction'} subtitle={transaction?.transactionRef}
      dirty={locked ? false : dirty}
      primaryLabel={locked ? 'Request unlock' : 'Submit'}
      onPrimary={locked ? requestUnlock : () => saveWith('submitted')}
      primaryDisabled={locked ? false : !canSave}
      secondaryLabel={locked ? undefined : 'Save as draft'}
      onSecondary={locked ? undefined : () => saveWith('draft')}
      secondaryDisabled={!canSave}
      busy={busy} onClose={onClose}>
      {locked && (
        <div className="mb-4 rounded-md border border-warning-bd bg-warning-bg px-3 py-2.5 text-[13px] text-warning">
          This transaction is <strong>submitted and locked</strong>. Request an unlock from an admin to edit it.
        </div>
      )}
      {!locked && transaction?.status === 'submitted' && (
        <div className="mb-4 rounded-md border border-info-bd bg-info-bg px-3 py-2 text-[12.5px] text-info">
          Submitted transaction — saving as submitted re-locks it for non-admins.
        </div>
      )}
      <fieldset disabled={locked} className="flex flex-col gap-5 border-0 p-0">
        {/* Header */}
        <div className="grid grid-cols-2 gap-4 max-[560px]:grid-cols-1">
          <div><label className="label">Date</label><input type="date" className="input mono" value={date} onChange={(e) => { setDate(e.target.value); touch(); }} /></div>
          <div><label className="label">Sales channel</label><RefField value={channel} placeholder="Sales channel…" list={(q) => salesChannelsApi.list(q)} onChange={(v) => { setChannel(v); touch(); }} /></div>
          <div><label className="label">Transaction ID</label><input className="input mono" value={transactionRef} onChange={(e) => { setTransactionRef(e.target.value); touch(); }} placeholder="e.g. 402-1234567-1234567" /></div>
          <div><label className="label">Destination country</label><CountrySelect value={destinationCountryId} onChange={handleDestination} /></div>
          <div className="col-span-2 max-w-[calc(50%-0.5rem)] max-[560px]:max-w-none">
            <label className="label">Default shipping service <span className="font-normal text-n-400">(from destination — editable)</span></label>
            <select className="input" value={shippingServiceId ?? ''} onChange={(e) => { setShippingServiceId(e.target.value || null); setServiceOverridden(true); touch(); }}>
              <option value="">—</option>
              {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Destination VAT % <span className="font-normal text-n-400">(from country — editable)</span></label>
            <input className="input mono" inputMode="decimal" value={destinationVatPct} onChange={(e) => { setDestinationVatPct(e.target.value); setVatOverridden(true); touch(); }} placeholder="0" />
          </div>
        </div>

        {selected && (
          <p className="rounded-md border border-info-bd bg-info-bg px-3 py-2 text-[12.5px] text-info">
            Amounts in <strong className="mono">{ccy(nativeCcy)}</strong> (channel currency); sales fee in <strong className="mono">{ccy(feeCcy)}</strong>.
          </p>
        )}

        {/* Calculated fields */}
        <div className="rounded-lg border border-n-200 bg-n-25 p-3">
          <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-n-500">Calculated</div>
          <div className="grid grid-cols-3 gap-3 max-[560px]:grid-cols-2">
            <Calc label="Sales Fee %" value={liveSalesFeePct != null ? `${liveSalesFeePct.toFixed(2)}%` : '—'} />
            <Calc label={`Exchange rate (${ccy(nativeCcy)}→EUR)`} value={transaction?.exchangeRate != null ? String(transaction.exchangeRate) : '—'} />
            <Calc label="Package weight (kg)" value={transaction?.overallPackageWeight != null ? String(transaction.overallPackageWeight) : '—'} />
            <Calc label="Est. shipping cost" value={transaction?.estimatedShippingCost != null ? `€${transaction.estimatedShippingCost.toFixed(2)}` : '—'} />
            <Calc label="Profit (€)" value={transaction?.profit != null ? `€${transaction.profit.toFixed(2)}` : '—'} />
          </div>
          <p className="mt-2 text-[11px] text-n-400">
            {transaction ? 'Exchange rate, package weight and shipping cost refresh on save.' : 'Exchange rate, package weight and shipping cost are calculated when you save.'}
          </p>
        </div>

        {/* Items */}
        <div>
          <label className="label">SKUs in this transaction</label>
          <div className="flex flex-col gap-3">
            {items.map((it, i) => (
              <div key={i} className="overflow-hidden rounded-lg border border-n-200">
                <div className="flex items-center gap-2 border-b border-n-200 bg-n-50 px-3 py-2">
                  <span className="text-[13px] font-semibold text-n-800">SKU {i + 1}</span>
                  {items.length > 1 && (
                    <button className="ml-auto grid h-7 w-7 place-items-center rounded-md text-n-500 hover:bg-danger-bg hover:text-danger" onClick={() => { setItems((r) => r.filter((_, idx) => idx !== i)); touch(); }}><Trash2 size={14} /></button>
                  )}
                </div>
                <div className="p-3">
                <div className="grid grid-cols-4 gap-3 max-[700px]:grid-cols-2 max-[420px]:grid-cols-1">
                  <div className="col-span-3 max-[700px]:col-span-2 max-[420px]:col-span-1">
                    <label className="label">SKU</label>
                    <ProductSkuField value={{ productId: it.productId, sku: it.sku }} onChange={(v) => setItem(i, v)} />
                  </div>
                  <div><label className="label">Quantity</label><input className="input mono" inputMode="numeric" value={it.quantity} onChange={(e) => setItem(i, { quantity: e.target.value })} /></div>
                  <AmountField label="Net sales" ccy={nativeCcy} value={it.netSalesAmount} onChange={(v) => setItem(i, { netSalesAmount: v })} />
                  <AmountField label="VAT" ccy={nativeCcy} value={it.vatAmount} onChange={(v) => setItem(i, { vatAmount: v })} />
                  <AmountField label="Shipping" ccy={nativeCcy} value={it.shippingAmount} onChange={(v) => setItem(i, { shippingAmount: v })} />
                  <AmountField label="Shipping VAT" ccy={nativeCcy} value={it.shippingAmountVat} onChange={(v) => setItem(i, { shippingAmountVat: v })} />
                  <AmountField label="Sales fee" ccy={feeCcy} value={it.salesChannelSalesFeeAmount} onChange={(v) => setItem(i, { salesChannelSalesFeeAmount: v })} />
                </div>
                </div>
              </div>
            ))}
            <div><button className="btn btn-ghost" onClick={() => { setItems((r) => [...r, emptyItem()]); touch(); }}><Plus size={16} /> Add another SKU</button></div>
          </div>
        </div>
      </fieldset>
    </ModalShell>
  );
}

function Calc({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] text-n-500">{label}</div>
      <div className="mono text-[14px] font-semibold text-n-800">{value}</div>
    </div>
  );
}

function AmountField({ label, ccy, value, onChange }: { label: string; ccy: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="label">{label} {ccy && <span className="mono font-normal text-n-400">({ccy})</span>}</label>
      <input className="input mono" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} placeholder="0.00" />
    </div>
  );
}
