import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ModalShell } from '@masquare/ui';
import { salesChannelsApi, salesTransactionsApi, type RefLite, type SalesTransaction } from '../../lib/api';
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
  const { activeCompanyId } = useAuth();
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const touch = () => setDirty(true);
  const { data: channels = [] } = useQuery({ queryKey: ['sales-channels'], queryFn: () => salesChannelsApi.list() });

  const [date, setDate] = useState(transaction ? transaction.date.slice(0, 10) : today());
  const [channel, setChannel] = useState<RefLite | null>(transaction?.salesChannel ?? null);
  const [transactionRef, setTransactionRef] = useState(transaction?.transactionRef ?? '');
  const [destinationCountryId, setDestinationCountryId] = useState<string | null>(transaction?.destinationCountryId ?? null);
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

  const save = async () => {
    if (!canSave) { toast.error('Transaction ID and at least one SKU are required'); return; }
    setBusy(true);
    try {
      const body = {
        date, transactionRef,
        salesChannelId: channel?.id ?? null,
        destinationCountryId,
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
      toast.success(transaction ? 'Transaction updated' : 'Transaction registered');
      onSaved();
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const ccy = (c: string) => (c ? c : '—');

  return (
    <ModalShell open title={transaction ? 'Edit sales transaction' : 'Register sales transaction'} subtitle={transaction?.transactionRef}
      dirty={dirty} primaryLabel={transaction ? 'Save changes' : 'Register transaction'} onPrimary={save} primaryDisabled={!canSave} busy={busy} onClose={onClose}>
      <div className="flex flex-col gap-5">
        {/* Header */}
        <div className="grid grid-cols-2 gap-4 max-[560px]:grid-cols-1">
          <div><label className="label">Date</label><input type="date" className="input mono" value={date} onChange={(e) => { setDate(e.target.value); touch(); }} /></div>
          <div><label className="label">Sales channel</label><RefField value={channel} placeholder="Sales channel…" list={(q) => salesChannelsApi.list(q)} onChange={(v) => { setChannel(v); touch(); }} /></div>
          <div><label className="label">Transaction ID</label><input className="input mono" value={transactionRef} onChange={(e) => { setTransactionRef(e.target.value); touch(); }} placeholder="e.g. 402-1234567-1234567" /></div>
          <div><label className="label">Destination country</label><CountrySelect value={destinationCountryId} onChange={(v) => { setDestinationCountryId(v); touch(); }} /></div>
        </div>

        {selected && (
          <p className="rounded-md border border-info-bd bg-info-bg px-3 py-2 text-[12.5px] text-info">
            Amounts in <strong className="mono">{ccy(nativeCcy)}</strong> (channel currency); sales fee in <strong className="mono">{ccy(feeCcy)}</strong>.
          </p>
        )}

        {/* Items */}
        <div>
          <label className="label">SKUs in this transaction</label>
          <div className="flex flex-col gap-3">
            {items.map((it, i) => (
              <div key={i} className="rounded-lg border border-n-200 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-[12px] font-semibold text-n-500">SKU {i + 1}</span>
                  {items.length > 1 && (
                    <button className="ml-auto grid h-7 w-7 place-items-center rounded-md text-n-500 hover:bg-danger-bg hover:text-danger" onClick={() => { setItems((r) => r.filter((_, idx) => idx !== i)); touch(); }}><Trash2 size={14} /></button>
                  )}
                </div>
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
            ))}
            <div><button className="btn btn-ghost" onClick={() => { setItems((r) => [...r, emptyItem()]); touch(); }}><Plus size={16} /> Add another SKU</button></div>
          </div>
        </div>
      </div>
    </ModalShell>
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
