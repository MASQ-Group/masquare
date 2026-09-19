import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Loader2, Plus, Trash2 } from 'lucide-react';
import { ModalShell, Select } from '@masquare/ui';
import {
  CUSTOMS_LABEL, shipmentsApi, shippingServicesApi,
  type FedexRateOption, type OrderBookResult, type OrderCustomsItem,
} from '../../lib/api';
import { useConfirm } from '../ConfirmProvider';
import { CountrySelect } from '../common/CountrySelect';
import { DeliveryAddressCard } from '../sales/DeliveryAddressCard';
import { BookingDocuments } from './BookingDocuments';

/**
 * Book one of our own orders with FedEx, and record the shipment it becomes.
 *
 * We are the shipper and the seller, so the commercial invoice is ours and FedEx writes it from the
 * customs lines. The lines are the order's products, prefilled from the order and the catalogue and
 * correctable here; the parcels are what was actually packed. FedEx wants the two to weigh the same,
 * and the screen shows both totals side by side so a difference is seen before FedEx refuses it.
 *
 * On production the label is real and billable, and the shipment is recorded with FedEx's tracking
 * number and the quoted cost — which is the same row "Record shipment" would have written by hand.
 */

interface Line { sku?: string; description: string; quantity: string; value: string; currency: string; weightKg: string; countryOfOrigin: string; hsCode: string; weightKnown?: boolean }
interface Parcel { weightKg: string; lengthCm: string; widthCm: string; heightCm: string; batteryType: string; sku?: string | null }

/** The battery cases the platform can declare — Section II, packed in or with equipment. */
const BATTERY_OPTIONS = [
  { value: '', label: 'No batteries' },
  { value: 'li_ion_in_equipment', label: 'Lithium ion contained in equipment (PI 967)' },
  { value: 'li_ion_with_equipment', label: 'Lithium ion packed with equipment (PI 966)' },
  { value: 'li_metal_in_equipment', label: 'Lithium metal contained in equipment (PI 970)' },
  { value: 'li_metal_with_equipment', label: 'Lithium metal packed with equipment (PI 969)' },
];

const today = () => new Date().toLocaleDateString('en-CA');

/** The facts the FedEx rules were tested against, in one line. */
function dutiesFacts(f: NonNullable<import('../../lib/api').OrderFedexOptions['duties']>['facts']): string {
  const where = f.destinationIso
    ? `${f.destinationIso}${f.destinationInEu == null ? '' : f.destinationInEu ? ', in the EU' : ', outside the EU'}`
    : 'no destination';
  const home = f.channelHomeIso ? (f.destinationIso === f.channelHomeIso ? 'the channel’s own country' : `channel home ${f.channelHomeIso}`) : 'channel has no home country set';
  return `${where} · ${home} · ${f.dutiesReason}`;
}
const n = (v: string) => { const x = Number(String(v).trim().replace(',', '.')); return Number.isFinite(x) ? x : 0; };
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const opt = (v: string) => (v.trim() === '' ? null : n(v) || null);

export function BookOrderModal({ transactionId, transactionRef, contextLine, onClose, onDone }: {
  transactionId: string;
  transactionRef: string;
  contextLine?: string;
  onClose: () => void;
  /** After a booking that recorded a shipment, so the worklist can refresh. */
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const confirm = useConfirm();

  const { data: options, isLoading } = useQuery({
    queryKey: ['order-fedex-options', transactionId],
    queryFn: () => shipmentsApi.fedexOptions(transactionId),
  });
  const { data: services = [] } = useQuery({ queryKey: ['shipping-services'], queryFn: () => shippingServicesApi.list() });

  const [accountId, setAccountId] = useState('');
  const [serviceType, setServiceType] = useState('FEDEX_INTERNATIONAL_PRIORITY');
  const [shipDate, setShipDate] = useState(today());
  // No default: a marketplace that forbids charging the buyer at delivery needs DDP, and a default is how that gets missed.
  const [dutiesPaidBy, setDutiesPaidBy] = useState<'' | 'sender' | 'recipient'>('');
  const [labelImageType, setLabelImageType] = useState<'PDF' | 'ZPLII'>('PDF');
  const [invoice, setInvoice] = useState<'fedex' | 'platform'>('fedex');
  const [sectionII, setSectionII] = useState(false);
  const [shippingServiceId, setShippingServiceId] = useState('');
  const [markShipped, setMarkShipped] = useState(true);
  const [chosenQuote, setChosenQuote] = useState<FedexRateOption | null>(null);
  const [result, setResult] = useState<OrderBookResult | null>(null);
  const [lines, setLines] = useState<Line[] | null>(null);
  const [parcels, setParcels] = useState<Parcel[] | null>(null);

  // Prefilled once, when the options arrive — not again, or a re-fetch would undo someone's edits.
  useEffect(() => {
    if (!options) return;
    if (!accountId && options.accounts.length) setAccountId((options.accounts.find((a) => a.environment === 'production') ?? options.accounts[0]).id);
    // The FedEx rules' answer, pre-filled once. A person can still change it.
    if (!dutiesPaidBy && options.duties?.dutiesPaidBy) setDutiesPaidBy(options.duties.dutiesPaidBy);
    if (!lines) {
      setLines(options.items.map((i) => ({
        sku: i.sku, description: i.description, quantity: String(i.quantity), value: String(i.value), currency: i.currency,
        weightKg: String(i.weightKg), countryOfOrigin: i.countryOfOrigin ?? '', hsCode: i.hsCode ?? '', weightKnown: i.weightKnown,
      })));
    }
    if (!parcels) {
      // The catalogue's own boxes: weight AND dimensions, one per unit. Empty where it has none.
      const str = (v: number | null) => (v != null ? String(v) : '');
      setParcels(options.suggestedParcels.map((p) => ({
        weightKg: str(p.weightKg), lengthCm: str(p.lengthCm), widthCm: str(p.widthCm), heightCm: str(p.heightCm), batteryType: '', sku: p.sku,
      })));
    }
  }, [options]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!shippingServiceId && services.length) {
      const fedex = services.find((s) => /fedex/i.test(`${s.name} ${(s as any).alias ?? ''}`));
      if (fedex) setShippingServiceId(fedex.id);
    }
  }, [services, shippingServiceId]);

  const account = options?.accounts.find((a) => a.id === accountId) ?? null;
  const production = account?.environment === 'production';
  const customs = account?.customs ?? 'none';
  const ls = lines ?? [];
  const ps = parcels ?? [];

  const setLine = (i: number, patch: Partial<Line>) => { setLines((cur) => (cur ?? []).map((l, idx) => (idx === i ? { ...l, ...patch } : l))); };
  const setParcel = (i: number, patch: Partial<Parcel>) => { setParcels((cur) => (cur ?? []).map((p, idx) => (idx === i ? { ...p, ...patch } : p))); setChosenQuote(null); };

  const itemsKg = r3(ls.reduce((t, l) => t + n(l.weightKg), 0));
  const parcelsKg = r3(ps.reduce((t, p) => t + n(p.weightKg), 0));
  const weightsAgree = Math.abs(itemsKg - parcelsKg) <= 0.01;
  const hasBatteries = ps.some((p) => p.batteryType);

  const parcelBody = () => ps.map((p) => ({
    weightKg: n(p.weightKg), lengthCm: opt(p.lengthCm), widthCm: opt(p.widthCm), heightCm: opt(p.heightCm), batteryType: p.batteryType || null,
  }));
  const itemBody = (): OrderCustomsItem[] => ls.map((l) => ({
    description: l.description.trim(), quantity: n(l.quantity), value: n(l.value), currency: l.currency.trim().toUpperCase(),
    weightKg: n(l.weightKg), countryOfOrigin: l.countryOfOrigin.trim().toUpperCase() || null, hsCode: l.hsCode.trim() || null,
  }));

  /**
   * Spread the parcels' weight over the lines, in proportion to what the catalogue says each weighs
   * — or evenly where it says nothing. The packed weight is the measured one; the catalogue's is a
   * guess that leaves out the box, and FedEx wants the two to agree.
   */
  const matchLinesToParcels = () => {
    const base = ls.map((l) => n(l.weightKg));
    const sum = base.reduce((t, w) => t + w, 0);
    let running = 0;
    setLines(ls.map((l, i) => {
      const share = i === ls.length - 1 ? r3(parcelsKg - running) : r3(sum > 0 ? parcelsKg * (base[i] / sum) : parcelsKg / ls.length);
      running = r3(running + share);
      return { ...l, weightKg: String(share) };
    }));
  };

  const quote = useMutation({
    mutationFn: () => shipmentsApi.fedexQuote(transactionId, { accountId, parcels: parcelBody() }),
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not get a quote', { duration: 9000 }),
  });
  const quoteOptions = quote.data?.quote?.options ?? [];
  const costEur = chosenQuote && chosenQuote.serviceType === serviceType && chosenQuote.currency === 'EUR' ? chosenQuote.netCharge : null;

  const book = useMutation({
    mutationFn: (another: boolean) => shipmentsApi.fedexBook(transactionId, {
      accountId, serviceType, shipDate, dutiesPaidBy: dutiesPaidBy as 'sender' | 'recipient', labelImageType, invoice,
      parcels: parcelBody(), items: itemBody(), batteriesSectionII: sectionII,
      shippingServiceId: shippingServiceId || null, costEur, markShipped, another,
    }),
    onSuccess: (r) => {
      setResult(r);
      qc.invalidateQueries({ queryKey: ['order-fedex-options', transactionId] });
      if (r.ok && r.shipmentId) { toast.success(`${transactionRef} booked with FedEx — ${r.booking?.masterTrackingNumber}`); onDone(); }
      else if (r.ok) toast.info(r.message ?? 'Booked');
      else toast.error(`FedEx refused the booking (${r.status})`, { duration: 9000 });
    },
    onError: async (e: any) => {
      const data = e?.response?.data;
      // A live label already exists: ask, and send again only on a yes.
      if (data?.code === 'ALREADY_BOOKED') {
        const ok = await confirm({ title: 'Book another label?', message: data.message, confirmLabel: 'Book another' });
        if (ok) book.mutate(true);
        return;
      }
      toast.error(data?.message ?? 'Could not book', { duration: 12000 });
    },
  });

  const ready = !!accountId && !!serviceType && !!shipDate && !!dutiesPaidBy && ps.length > 0 && ps.every((p) => n(p.weightKg) > 0)
    && (!production || !!shippingServiceId) && (!hasBatteries || sectionII) && !book.isPending;

  const submit = async () => {
    if (production) {
      const ok = await confirm({
        title: `Book ${transactionRef} with FedEx?`,
        message: `This creates a real label and a real charge on ${account?.name} (${account?.accountNumber}), and records the shipment${markShipped ? ', marking the order shipped' : ''}. A label can be cancelled afterwards, but FedEx may still charge for it.`,
        confirmLabel: 'Book it',
      });
      if (!ok) return;
    }
    book.mutate(false);
  };

  const lineProblems = useMemo(() => {
    if (customs !== 'export') return [];
    const out: string[] = [];
    ls.forEach((l, i) => {
      const which = ls.length === 1 ? 'The line' : `Line ${i + 1}`;
      if (!l.description.trim()) out.push(`${which}: description`);
      if (!(Number.isInteger(n(l.quantity)) && n(l.quantity) >= 1)) out.push(`${which}: whole-number quantity`);
      if (!(n(l.value) > 0)) out.push(`${which}: value`);
      if (!(n(l.weightKg) > 0)) out.push(`${which}: weight`);
      if (!/^\d{6,10}$/.test(l.hsCode.replace(/[\s.-]/g, ''))) out.push(`${which}: HS code (6–10 digits)`);
      if (!/^[A-Za-z]{2}$/.test(l.countryOfOrigin.trim())) out.push(`${which}: country of origin`);
    });
    return out;
  }, [ls, customs]);

  const bookings = result?.bookings ?? options?.bookings ?? [];
  const field = 'input';
  const label = 'label';

  return (
    <ModalShell
      open
      title={`Book ${transactionRef} with FedEx`}
      subtitle={contextLine}
      dirty={!result}
      primaryLabel={result?.ok ? 'Done' : book.isPending ? 'Booking…' : production ? 'Book with FedEx' : 'Make a sandbox booking'}
      primaryDisabled={result?.ok ? false : !ready}
      onPrimary={result?.ok ? onClose : submit}
      onClose={onClose}
      initialSize={{ w: 1040, h: 800 }}
    >
      <div className="space-y-5 p-1">
        {isLoading || !options ? (
          <p className="text-[13px] text-n-500">Loading…</p>
        ) : !options.accounts.length ? (
          <p className="rounded-md border border-orange-200 bg-orange-50 px-3 py-2.5 text-[12.5px] text-orange-900">
            There is no connected FedEx account for this order’s company. Add one in Setup → Carrier accounts and test the connection, then book here.
          </p>
        ) : (
          <>
            {result && (
              <div className={`rounded-md border px-3 py-2.5 text-[12.5px] ${result.ok ? 'border-teal-100 bg-teal-50 text-teal-900' : 'border-orange-200 bg-orange-50 text-orange-900'}`}>
                <div className="font-semibold">
                  {result.ok
                    ? result.shipmentId ? `Booked — tracking ${result.booking?.masterTrackingNumber}. The shipment is recorded.` : 'Booked.'
                    : `FedEx refused the booking (HTTP ${result.status}).`}
                </div>
                {result.message && <p className="mt-1 whitespace-pre-line">{result.message}</p>}
                {!result.ok && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[12px] font-semibold">What we sent and what FedEx replied</summary>
                    <pre className="mt-1 max-h-[200px] overflow-auto rounded border border-n-200 bg-n-0 p-2 text-[11px] text-n-700">{JSON.stringify(result.request, null, 2)}</pre>
                    <pre className="mt-1 max-h-[200px] overflow-auto rounded border border-n-200 bg-n-0 p-2 text-[11px] text-n-700">{typeof result.response === 'string' ? result.response : JSON.stringify(result.response, null, 2)}</pre>
                  </details>
                )}
              </div>
            )}

            {bookings.length > 0 && (
              <div>
                <div className="mb-1.5 text-[13px] font-semibold text-n-800">Labels and invoices</div>
                <BookingDocuments bookings={bookings} reference={transactionRef} />
              </div>
            )}

            {!result?.ok && (
              <>
                {/* Where it is going — editable here, because a label cannot be made without it and
                    most orders reach this screen with the address still to be typed. */}
                <DeliveryAddressCard transactionId={transactionId} />

                <div className="grid gap-4 sm:grid-cols-3">
                  <label className="block sm:col-span-2">
                    <span className={label}>FedEx account</span>
                    <Select
                      value={accountId}
                      onChange={(v) => { setAccountId(v); quote.reset(); setChosenQuote(null); }}
                      options={options.accounts.map((a) => ({ value: a.id, label: `${a.name} · ${a.accountNumber}${a.environment === 'production' ? '' : ' · SANDBOX'}` }))}
                    />
                    <span className="mt-1 block text-[11.5px] text-n-500">Customs: {CUSTOMS_LABEL[customs]}.</span>
                  </label>
                  <label className="block">
                    <span className={label}>Hand to FedEx on</span>
                    <input type="date" className={field} value={shipDate} min={today()} onChange={(e) => setShipDate(e.target.value)} />
                  </label>
                </div>

                {!production && account && (
                  <p className="flex items-start gap-1.5 rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-[12.5px] text-orange-900">
                    <AlertTriangle size={14} className="mt-[2px] shrink-0" />
                    Sandbox account: a test label, nothing recorded against the order. FedEx’s sandbox knows only the lanes in its own samples and may refuse a Cyprus origin.
                  </p>
                )}

                <div className="grid gap-4 sm:grid-cols-3">
                  <label className="block">
                    <span className={label}>Service</span>
                    <Select value={serviceType} onChange={setServiceType} options={options.services} />
                  </label>
                  <label className="block">
                    <span className={label}>Duties and taxes paid by</span>
                    <Select
                      value={dutiesPaidBy}
                      onChange={(v) => setDutiesPaidBy(v as 'sender' | 'recipient')}
                      options={[
                        { value: '', label: '— choose —' },
                        { value: 'recipient', label: 'Recipient — billed at delivery (DAP)' },
                        { value: 'sender', label: 'Us — duty paid (DDP)' },
                      ]}
                    />
                    {/* Where the pre-fill came from, and what decided it — or why there is none. */}
                    {options.duties && (
                      <span className="mt-1 block text-[11.5px] text-n-500" title={dutiesFacts(options.duties.facts)}>
                        {options.duties.rule
                          ? <>
                              {dutiesPaidBy && dutiesPaidBy !== options.duties.dutiesPaidBy
                                ? <span className="text-orange-800">Changed from {options.duties.dutiesPaidBy === 'sender' ? 'DDP' : 'DAP'}, set by rule “{options.duties.rule.name}”.</span>
                                : <>Pre-filled by rule “{options.duties.rule.name}”.</>}
                              {' '}{dutiesFacts(options.duties.facts)}.
                            </>
                          : <>No FedEx rule applies — {dutiesFacts(options.duties.facts)}.</>}
                      </span>
                    )}
                  </label>
                  <label className="block">
                    <span className={label}>Label format</span>
                    <Select
                      value={labelImageType}
                      onChange={(v) => setLabelImageType(v as 'PDF' | 'ZPLII')}
                      options={[{ value: 'PDF', label: 'PDF (laser printer)' }, { value: 'ZPLII', label: 'ZPL II (thermal printer)' }]}
                    />
                  </label>
                </div>

                {/* The boxes as packed. */}
                <div>
                  <div className="mb-1.5 flex flex-wrap items-baseline gap-2">
                    <span className="text-[13px] font-semibold text-n-800">Parcels</span>
                    <span className="text-[11.5px] text-n-500">As packed — weight in kg, sides in cm.</span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {ps.map((p, i) => (
                      <div key={i} className="grid grid-cols-12 items-center gap-2">
                        <span className="col-span-12 truncate text-[12px] font-semibold text-n-700 sm:col-span-1" title={p.sku ? `${p.sku}’s package, from the catalogue` : undefined}>
                          #{i + 1}{p.sku && <span className="mono block truncate text-[10.5px] font-normal text-n-500">{p.sku}</span>}
                        </span>
                        <input className={`${field} mono col-span-3 sm:col-span-2`} value={p.weightKg} inputMode="decimal" placeholder="kg" onChange={(e) => setParcel(i, { weightKg: e.target.value })} />
                        <input className={`${field} mono col-span-3 sm:col-span-1`} value={p.lengthCm} inputMode="decimal" placeholder="L" onChange={(e) => setParcel(i, { lengthCm: e.target.value })} />
                        <input className={`${field} mono col-span-3 sm:col-span-1`} value={p.widthCm} inputMode="decimal" placeholder="W" onChange={(e) => setParcel(i, { widthCm: e.target.value })} />
                        <input className={`${field} mono col-span-3 sm:col-span-1`} value={p.heightCm} inputMode="decimal" placeholder="H" onChange={(e) => setParcel(i, { heightCm: e.target.value })} />
                        <div className="col-span-10 sm:col-span-5">
                          <Select value={p.batteryType} onChange={(v) => setParcel(i, { batteryType: v })} options={BATTERY_OPTIONS} />
                        </div>
                        <button
                          type="button"
                          className="col-span-2 grid h-9 w-9 place-items-center rounded-md border border-n-200 text-n-500 hover:bg-danger-bg hover:text-danger disabled:opacity-40 sm:col-span-1"
                          disabled={ps.length === 1}
                          title="Remove parcel"
                          onClick={() => { setParcels(ps.filter((_, idx) => idx !== i)); setChosenQuote(null); }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-md border border-dashed border-n-300 px-3 text-[12.5px] font-semibold text-teal-700 hover:bg-teal-50"
                    onClick={() => setParcels([...ps, { weightKg: '', lengthCm: '', widthCm: '', heightCm: '', batteryType: '' }])}
                  >
                    <Plus size={14} /> Add parcel
                  </button>
                  {/* Several products in one carton: their weights add up, but the carton's size is not
                      anything the catalogue knows, so the sides are left for whoever packed it. */}
                  {ps.length > 1 && (
                    <button
                      type="button"
                      className="ml-2 mt-2 inline-flex h-8 items-center gap-1.5 rounded-md border border-n-200 px-3 text-[12.5px] font-semibold text-n-700 hover:bg-n-50"
                      title="Merge these parcels into one box: weights added, dimensions to type"
                      onClick={() => {
                        setParcels([{
                          weightKg: String(r3(parcelsKg)), lengthCm: '', widthCm: '', heightCm: '',
                          batteryType: ps.find((p) => p.batteryType)?.batteryType ?? '', sku: null,
                        }]);
                        setChosenQuote(null);
                      }}
                    >
                      Pack into one box
                    </button>
                  )}
                  {ps.some((p) => !p.lengthCm || !p.widthCm || !p.heightCm) && (
                    <p className="mt-1.5 text-[11.5px] text-n-500">A parcel without its size is rated on weight alone; FedEx may re-bill it by size after it is measured.</p>
                  )}
                  {options.batteryProducts.length > 0 && !hasBatteries && (
                    <p className="mt-2 text-[12px] text-warning">
                      The catalogue says {options.batteryProducts.map((b) => `${b.sku} (${b.battery})`).join(', ')} carries batteries. Declare them on the parcel they are in.
                    </p>
                  )}
                </div>

                {/* What it costs us, per service, before anything is bought. */}
                <div className="rounded-lg border border-n-100 bg-n-25 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-semibold text-n-800">What FedEx charges us</span>
                    <span className="text-[11.5px] text-n-500">For these parcels, at our negotiated rate.</span>
                    <div className="flex-1" />
                    <button
                      type="button"
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-n-200 bg-n-0 px-3 text-[12.5px] font-semibold text-n-700 hover:bg-n-50 disabled:opacity-50"
                      disabled={!accountId || quote.isPending || !ps.every((p) => n(p.weightKg) > 0)}
                      onClick={() => quote.mutate()}
                    >
                      {quote.isPending && <Loader2 size={13} className="animate-spin" />}
                      {quote.data ? 'Quote again' : 'Get a quote'}
                    </button>
                  </div>
                  {quote.data && !quote.data.ok && <p className="mt-2 whitespace-pre-line text-[12px] text-orange-800">{quote.data.message}</p>}
                  {quoteOptions.length > 0 && (
                    <div className="mt-2 flex flex-col gap-1">
                      {quoteOptions.map((o) => (
                        <button
                          key={o.serviceType}
                          type="button"
                          className={`flex items-center gap-3 rounded-md border px-2.5 py-1.5 text-left text-[12.5px] ${o.serviceType === serviceType ? 'border-teal-300 bg-teal-50' : 'border-n-100 bg-n-0 hover:bg-n-50'}`}
                          onClick={() => { setServiceType(o.serviceType); setChosenQuote(o); }}
                        >
                          <span className="flex-1 text-n-800">{o.serviceName}</span>
                          {o.deliveryAt && <span className="text-n-500">by {new Date(o.deliveryAt).toLocaleDateString()}</span>}
                          <span className="mono font-semibold text-n-800">{o.currency} {o.netCharge.toFixed(2)}</span>
                          {o.isListPriceOnly && <span className="text-[11px] text-orange-800">list price</span>}
                        </button>
                      ))}
                    </div>
                  )}
                  {costEur != null && (
                    <p className="mt-2 text-[12px] text-n-600">€{costEur.toFixed(2)} is recorded as the shipment’s cost — still a quote until accounting checks it against the invoice.</p>
                  )}
                </div>

                {/* The order's products as customs lines. */}
                <div>
                  <div className="mb-1.5 flex flex-wrap items-baseline gap-2">
                    <span className="text-[13px] font-semibold text-n-800">Customs lines</span>
                    <span className="text-[11.5px] text-n-500">
                      {customs === 'export' ? 'Required: this leaves the EU. Value is the line total, excluding VAT.' : 'Only the description is sent inside the EU.'}
                    </span>
                    <div className="flex-1" />
                    <span className={`mono text-[12px] ${weightsAgree ? 'text-n-500' : 'text-orange-800'}`}>
                      lines {itemsKg} kg · parcels {parcelsKg} kg
                    </span>
                    {!weightsAgree && parcelsKg > 0 && (
                      <button type="button" className="text-[12px] font-semibold text-teal-700 hover:underline" onClick={matchLinesToParcels}>
                        Match lines to parcels
                      </button>
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    {ls.map((l, i) => (
                      <div key={i} className="rounded-md border border-n-100 p-2.5">
                        <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[12px]">
                          <span className="mono font-semibold text-n-700">{l.sku}</span>
                          {l.weightKnown === false && <span className="text-orange-800">no weight in the catalogue</span>}
                        </div>
                        <div className="grid grid-cols-12 gap-2">
                          <input className={`${field} col-span-12 sm:col-span-4`} value={l.description} placeholder="Description" onChange={(e) => setLine(i, { description: e.target.value })} />
                          <input className={`${field} mono col-span-3 sm:col-span-1`} value={l.quantity} inputMode="numeric" title="Quantity" onChange={(e) => setLine(i, { quantity: e.target.value })} />
                          <input className={`${field} mono col-span-5 sm:col-span-2`} value={l.value} inputMode="decimal" title={`Value, ${l.currency}`} placeholder={`Value ${l.currency}`} onChange={(e) => setLine(i, { value: e.target.value })} />
                          <input className={`${field} mono col-span-4 sm:col-span-1`} value={l.weightKg} inputMode="decimal" title="Weight, kg" onChange={(e) => setLine(i, { weightKg: e.target.value })} />
                          <div className="col-span-7 sm:col-span-2">
                            <CountrySelect value={l.countryOfOrigin || null} valueKind="code" placeholder="Made in…" onChange={(v) => setLine(i, { countryOfOrigin: v ?? '' })} />
                          </div>
                          <input className={`${field} mono col-span-5 sm:col-span-2`} value={l.hsCode} placeholder="HS code" onChange={(e) => setLine(i, { hsCode: e.target.value })} />
                        </div>
                      </div>
                    ))}
                  </div>
                  {lineProblems.length > 0 && <p className="mt-1.5 text-[12px] text-orange-800">Still needed for customs: {lineProblems.join(', ')}.</p>}
                  {customs === 'export' && !weightsAgree && (
                    <p className="mt-1 text-[12px] text-orange-800">FedEx refuses an export whose lines do not weigh what the parcels weigh.</p>
                  )}
                </div>

                {customs === 'export' && (
                  <label className="block max-w-[420px]">
                    <span className={label}>Commercial invoice</span>
                    <Select
                      value={invoice}
                      onChange={(v) => setInvoice(v as 'fedex' | 'platform')}
                      options={[
                        { value: 'fedex', label: 'FedEx generates it from the lines' },
                        { value: 'platform', label: 'Platform generates it — not set up yet' },
                      ]}
                    />
                  </label>
                )}

                {hasBatteries && (
                  <label className="flex items-start gap-2 rounded-md border border-warning-bd bg-warning-bg px-3 py-2 text-[12.5px] text-warning">
                    <input type="checkbox" className="mt-0.5 h-4 w-4" checked={sectionII} onChange={(e) => setSectionII(e.target.checked)} />
                    <span>
                      These lithium batteries are within IATA Section II — small consumer batteries, packed in or with equipment.
                      FedEx is told so on the label. Batteries on their own, or larger ones, must be booked with FedEx directly.
                    </span>
                  </label>
                )}

                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className={label}>Record it under</span>
                    <Select
                      searchable
                      value={shippingServiceId}
                      onChange={setShippingServiceId}
                      options={[{ value: '', label: '— choose —' }, ...services.map((s) => ({ value: s.id, label: s.name }))]}
                    />
                    <span className="mt-1 block text-[11.5px] text-n-500">Our carrier for the shipment row — its tracking link and the tracking sweep.</span>
                  </label>
                  <label className="flex cursor-pointer items-start gap-2.5 self-end rounded-md border border-n-200 bg-n-25 px-3 py-2.5">
                    <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--teal-500)]" checked={markShipped} onChange={(e) => setMarkShipped(e.target.checked)} />
                    <span className="text-[12.5px] text-n-700">
                      Mark the order <strong>fully shipped</strong>
                      <span className="block text-[11.5px] text-n-400">Untick if more of it will follow.</span>
                    </span>
                  </label>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </ModalShell>
  );
}
