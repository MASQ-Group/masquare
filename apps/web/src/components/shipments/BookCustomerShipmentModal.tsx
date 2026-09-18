import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { ModalShell, Select } from '@masquare/ui';
import {
  CUSTOMS_LABEL, customerShipmentsApi, shippingServicesApi,
  type CustomerShipment, type CustomerShipmentBookResult, type FedexRateOption,
} from '../../lib/api';
import { useConfirm } from '../ConfirmProvider';
import { CountrySelect } from '../common/CountrySelect';
import { BookingDocuments } from './BookingDocuments';

/**
 * Book a customer's shipment with FedEx from the platform.
 *
 * We are the shipper — our account, our address on the label — and the goods leave from our
 * warehouse or from the collection address the customer gave. The commercial invoice is issued in
 * the customer's name. On a production account this creates a real label and a real charge, and the
 * shipment is marked as sent with FedEx's tracking number; on sandbox it is a test label only.
 *
 * Each box is one customs line. What the customer entered is shown and can be corrected here — the
 * corrections are saved to the shipment before FedEx is asked, so a refusal does not lose them.
 */

interface Line {
  id: string;
  goodsDescription: string;
  quantity: string;
  declaredValue: string;
  hsCode: string;
  countryOfOrigin: string;
}

/** Today, in the browser's own timezone — FedEx refuses a ship date in the past. */
const today = () => new Date().toLocaleDateString('en-CA');

export function BookCustomerShipmentModal({ shipment, onClose }: { shipment: CustomerShipment; onClose: () => void }) {
  const qc = useQueryClient();
  const confirm = useConfirm();

  const { data: options, isLoading } = useQuery({
    queryKey: ['customer-shipments', 'booking-options', shipment.id],
    queryFn: () => customerShipmentsApi.bookingOptions(shipment.id),
  });
  const { data: services = [] } = useQuery({ queryKey: ['shipping-services'], queryFn: () => shippingServicesApi.list() });

  const [accountId, setAccountId] = useState('');
  const [serviceType, setServiceType] = useState('FEDEX_INTERNATIONAL_PRIORITY');
  const [shipDate, setShipDate] = useState(today());
  // No default: who pays at the border is a decision, and a default is how it gets skipped.
  const [dutiesPaidBy, setDutiesPaidBy] = useState<'' | 'sender' | 'recipient'>('');
  const [labelImageType, setLabelImageType] = useState<'PDF' | 'ZPLII'>('PDF');
  const [invoice, setInvoice] = useState<'fedex' | 'platform'>('fedex');
  const [sectionII, setSectionII] = useState(false);
  const [shippingServiceId, setShippingServiceId] = useState('');
  const [charge, setCharge] = useState(shipment.chargeCents != null ? (shipment.chargeCents / 100).toFixed(2) : '');
  const [chargeCurrency, setChargeCurrency] = useState(shipment.chargeCurrency || 'EUR');
  const [chosenQuote, setChosenQuote] = useState<FedexRateOption | null>(null);
  const [result, setResult] = useState<CustomerShipmentBookResult | null>(null);
  const [lines, setLines] = useState<Line[]>(() => shipment.parcels.map((p) => ({
    id: p.id,
    goodsDescription: p.goodsDescription ?? shipment.goodsDescription ?? '',
    quantity: String(p.quantity ?? 1),
    declaredValue: p.declaredValue != null ? String(Number(p.declaredValue)) : '',
    hsCode: p.hsCode ?? '',
    countryOfOrigin: p.countryOfOrigin ?? '',
  })));

  // The first production account, else the first there is — once the list arrives.
  useEffect(() => {
    if (!accountId && options?.accounts.length) {
      setAccountId((options.accounts.find((a) => a.environment === 'production') ?? options.accounts[0]).id);
    }
  }, [options, accountId]);
  // Our FedEx carrier, which is what gives the customer a working tracking link.
  useEffect(() => {
    if (!shippingServiceId && services.length) {
      const fedex = services.find((s) => /fedex/i.test(`${s.name} ${(s as any).alias ?? ''}`));
      if (fedex) setShippingServiceId(fedex.id);
    }
  }, [services, shippingServiceId]);

  const account = options?.accounts.find((a) => a.id === accountId) ?? null;
  const production = account?.environment === 'production';
  const customs = account?.customs ?? 'none';
  const hasBatteries = shipment.parcels.some((p) => p.dangerousGoods);
  const currency = (shipment.goodsCurrency ?? 'EUR').toUpperCase();

  const setLine = (i: number, patch: Partial<Line>) => { setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l))); setChosenQuote(null); };

  const cents = (v: string) => {
    const n = Number(v.trim().replace(',', '.'));
    return v.trim() === '' || !Number.isFinite(n) ? null : Math.round(n * 100);
  };

  const quote = useMutation({
    mutationFn: () => customerShipmentsApi.quote(shipment.id, accountId),
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not get a quote', { duration: 9000 }),
  });
  const quoteOptions = quote.data?.quote?.options ?? [];

  const book = useMutation({
    mutationFn: () => customerShipmentsApi.book(shipment.id, {
      accountId,
      serviceType,
      shipDate,
      dutiesPaidBy: dutiesPaidBy as 'sender' | 'recipient',
      labelImageType,
      invoice,
      parcels: lines.map((l) => ({
        id: l.id,
        goodsDescription: l.goodsDescription.trim() || null,
        quantity: Number.isInteger(Number(l.quantity)) && Number(l.quantity) >= 1 ? Number(l.quantity) : null,
        declaredValue: l.declaredValue.trim() === '' ? null : Number(l.declaredValue.replace(',', '.')),
        hsCode: l.hsCode.trim() || null,
        countryOfOrigin: l.countryOfOrigin.trim().toUpperCase() || null,
      })),
      batteriesSectionII: sectionII,
      shippingServiceId: shippingServiceId || null,
      chargeCents: cents(charge),
      chargeCurrency,
      // Our cost, from the quote for the service actually booked — never from a different one.
      costCents: chosenQuote && chosenQuote.serviceType === serviceType && chosenQuote.currency === 'EUR'
        ? Math.round(chosenQuote.netCharge * 100) : null,
    }),
    onSuccess: (r) => {
      setResult(r);
      qc.invalidateQueries({ queryKey: ['customer-shipments'] });
      if (r.ok && r.fulfilled) toast.success(`${shipment.reference} booked with FedEx — ${r.booking?.masterTrackingNumber}`);
      else if (r.ok) toast.info(r.message ?? 'Booked');
      else toast.error(`FedEx refused the booking (${r.status})`, { duration: 9000 });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not book', { duration: 12000 }),
  });

  const ready = !!accountId && !!serviceType && !!shipDate && !!dutiesPaidBy && (!production || !!shippingServiceId)
    && (!hasBatteries || sectionII) && !book.isPending;

  const submit = async () => {
    if (production) {
      const ok = await confirm({
        title: `Book ${shipment.reference} with FedEx?`,
        message: `This creates a real label and a real charge on ${account?.name} (${account?.accountNumber}), and marks the shipment as sent. A label can be cancelled afterwards, but FedEx may still charge for it.`,
        confirmLabel: 'Book it',
      });
      if (!ok) return;
    }
    book.mutate();
  };

  const booked = result?.ok ? result.shipment : null;
  const bookings = (booked ?? shipment).bookings ?? [];

  const field = 'input';
  const label = 'label';
  const weight = (p: CustomerShipment['parcels'][number]) => Number(p.weightKg);

  const lineProblems = useMemo(() => {
    if (customs !== 'export') return [];
    const out: string[] = [];
    lines.forEach((l, i) => {
      const which = lines.length === 1 ? 'The package' : `Package ${i + 1}`;
      if (!l.goodsDescription.trim()) out.push(`${which}: description`);
      if (!(Number(l.declaredValue) > 0)) out.push(`${which}: value`);
      if (!/^\d{6,10}$/.test(l.hsCode.replace(/[\s.-]/g, ''))) out.push(`${which}: HS code (6–10 digits)`);
      if (!/^[A-Za-z]{2}$/.test(l.countryOfOrigin.trim())) out.push(`${which}: country of origin`);
    });
    return out;
  }, [lines, customs]);

  return (
    <ModalShell
      open
      title={`Book ${shipment.reference} with FedEx`}
      subtitle={`${shipment.customer.name} · ${shipment.parcels.length} package${shipment.parcels.length === 1 ? '' : 's'} to ${[shipment.toCity, shipment.toCountryIso].filter(Boolean).join(', ') || 'their recipient'}`}
      dirty={!result}
      primaryLabel={result?.ok ? 'Done' : book.isPending ? 'Booking…' : production ? 'Book with FedEx' : 'Make a sandbox booking'}
      primaryDisabled={result?.ok ? false : !ready}
      onPrimary={result?.ok ? onClose : submit}
      onClose={onClose}
      initialSize={{ w: 980, h: 760 }}
    >
      <div className="space-y-5 p-1">
        {isLoading ? (
          <p className="text-[13px] text-n-500">Loading…</p>
        ) : !options?.accounts.length ? (
          <p className="rounded-md border border-orange-200 bg-orange-50 px-3 py-2.5 text-[12.5px] text-orange-900">
            There is no connected FedEx account{' '}
            for this customer’s company. Add one in Setup → Carrier accounts and test the connection, then book here.
          </p>
        ) : (
          <>
            {result && (
              <div className={`rounded-md border px-3 py-2.5 text-[12.5px] ${result.ok ? 'border-teal-100 bg-teal-50 text-teal-900' : 'border-orange-200 bg-orange-50 text-orange-900'}`}>
                <div className="font-semibold">
                  {result.ok
                    ? result.fulfilled ? `Booked — tracking ${result.booking?.masterTrackingNumber}. The shipment is marked as sent.` : 'Booked.'
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
                <BookingDocuments bookings={bookings} reference={shipment.reference} />
              </div>
            )}

            {!result?.ok && (
              <>
                <div className="grid gap-4 sm:grid-cols-3">
                  <label className="block sm:col-span-2">
                    <span className={label}>FedEx account</span>
                    <Select
                      value={accountId}
                      onChange={(v) => { setAccountId(v); quote.reset(); setChosenQuote(null); }}
                      options={options.accounts.map((a) => ({
                        value: a.id,
                        label: `${a.name} · ${a.accountNumber}${a.environment === 'production' ? '' : ' · SANDBOX'}`,
                      }))}
                    />
                    <span className="mt-1 block text-[11.5px] text-n-500">
                      We are the shipper. {options.collection ? 'Collected from the customer’s address, which FedEx is given as the origin.' : 'Leaves from our warehouse.'}{' '}
                      Customs: {CUSTOMS_LABEL[customs]}.
                    </span>
                  </label>
                  <label className="block">
                    <span className={label}>Hand to FedEx on</span>
                    <input type="date" className={field} value={shipDate} min={today()} onChange={(e) => setShipDate(e.target.value)} />
                  </label>
                </div>

                {!production && account && (
                  <p className="flex items-start gap-1.5 rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-[12.5px] text-orange-900">
                    <AlertTriangle size={14} className="mt-[2px] shrink-0" />
                    Sandbox account: a test label with no real shipment. The shipment is not marked as sent. FedEx’s sandbox knows
                    only the lanes in its own samples and may refuse a Cyprus origin.
                  </p>
                )}

                <div className="grid gap-4 sm:grid-cols-3">
                  <label className="block">
                    <span className={label}>Service</span>
                    <Select value={serviceType} onChange={(v) => setServiceType(v)} options={options.services} />
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

                {/* What it costs us, per service, before anything is bought. */}
                <div className="rounded-lg border border-n-100 bg-n-25 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-semibold text-n-800">What FedEx charges us</span>
                    <span className="text-[11.5px] text-n-500">
                      {options.collection ? 'Quoted from our warehouse, not the collection address.' : 'Negotiated account rate, fuel and surcharges included.'}
                    </span>
                    <div className="flex-1" />
                    <button
                      type="button"
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-n-200 bg-n-0 px-3 text-[12.5px] font-semibold text-n-700 hover:bg-n-50 disabled:opacity-50"
                      disabled={!accountId || quote.isPending}
                      onClick={() => quote.mutate()}
                    >
                      {quote.isPending && <Loader2 size={13} className="animate-spin" />}
                      {quote.data ? 'Quote again' : 'Get a quote'}
                    </button>
                  </div>
                  {quote.data && !quote.data.ok && <p className="mt-2 whitespace-pre-line text-[12px] text-orange-800">{quote.data.message}</p>}
                  {quoteOptions.length > 0 && (
                    <div className="mt-2 flex flex-col gap-1">
                      {quoteOptions.map((o) => {
                        const active = o.serviceType === serviceType;
                        return (
                          <button
                            key={o.serviceType}
                            type="button"
                            className={`flex items-center gap-3 rounded-md border px-2.5 py-1.5 text-left text-[12.5px] ${active ? 'border-teal-300 bg-teal-50' : 'border-n-100 bg-n-0 hover:bg-n-50'}`}
                            onClick={() => { setServiceType(o.serviceType); setChosenQuote(o); }}
                          >
                            <span className="flex-1 text-n-800">{o.serviceName}</span>
                            {o.deliveryAt && <span className="text-n-500">by {new Date(o.deliveryAt).toLocaleDateString()}</span>}
                            <span className="mono font-semibold text-n-800">{o.currency} {o.netCharge.toFixed(2)}</span>
                            {o.isListPriceOnly && <span className="text-[11px] text-orange-800">list price</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/*
                  One customs line per box. Its weight is the box's, so the items always weigh what the
                  shipment weighs — FedEx's third rule — and it is shown rather than edited.
                */}
                <div>
                  <div className="mb-1.5 flex flex-wrap items-baseline gap-2">
                    <span className="text-[13px] font-semibold text-n-800">Customs lines</span>
                    <span className="text-[11.5px] text-n-500">
                      {customs === 'export'
                        ? `Required: this leaves the EU. Values in ${currency}. Corrections are saved to the shipment.`
                        : 'Only the description is sent inside the EU. Corrections are saved to the shipment.'}
                    </span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {lines.map((l, i) => {
                      const p = shipment.parcels[i];
                      return (
                        <div key={l.id} className="rounded-md border border-n-100 p-2.5">
                          <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[12px]">
                            <span className="font-semibold text-n-800">Package {i + 1}</span>
                            <span className="mono text-n-500">{weight(p)} kg</span>
                            {p.dangerousGoods && (
                              <span className="tag bg-warning-bg text-warning">Dangerous goods{p.batteryType ? ` · ${p.batteryType.replace(/_/g, ' ')}` : ''}</span>
                            )}
                          </div>
                          <div className="grid grid-cols-12 gap-2">
                            <input className={`${field} col-span-12 sm:col-span-4`} value={l.goodsDescription} placeholder="Description" onChange={(e) => setLine(i, { goodsDescription: e.target.value })} />
                            <input className={`${field} mono col-span-3 sm:col-span-1`} value={l.quantity} inputMode="numeric" title="Quantity" onChange={(e) => setLine(i, { quantity: e.target.value })} />
                            <input className={`${field} mono col-span-4 sm:col-span-2`} value={l.declaredValue} inputMode="decimal" placeholder={`Value ${currency}`} onChange={(e) => setLine(i, { declaredValue: e.target.value })} />
                            <div className="col-span-5 sm:col-span-3">
                              <CountrySelect value={l.countryOfOrigin || null} valueKind="code" placeholder="Made in…" onChange={(v) => setLine(i, { countryOfOrigin: v ?? '' })} />
                            </div>
                            <input className={`${field} mono col-span-12 sm:col-span-2`} value={l.hsCode} placeholder="HS code" onChange={(e) => setLine(i, { hsCode: e.target.value })} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {lineProblems.length > 0 && (
                    <p className="mt-1.5 text-[12px] text-orange-800">Still needed for customs: {lineProblems.join(', ')}.</p>
                  )}
                </div>

                {customs === 'export' && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block">
                      <span className={label}>Commercial invoice</span>
                      <Select
                        value={invoice}
                        onChange={(v) => setInvoice(v as 'fedex' | 'platform')}
                        options={[
                          { value: 'fedex', label: 'FedEx generates it from the lines' },
                          { value: 'platform', label: 'Platform generates it — not set up yet' },
                        ]}
                      />
                      <span className="mt-1 block text-[11.5px] text-n-500">
                        Issued in the name of <span className="font-semibold text-n-700">{options.invoiceIssuer ?? shipment.customer.name}</span>.
                      </span>
                    </label>
                  </div>
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

                <div className="rounded-lg border border-n-100 bg-n-25 p-3">
                  <div className="mb-2 text-[13px] font-semibold text-n-800">When it is booked</div>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <label className="block">
                      <span className={label}>Carrier on their tracking link</span>
                      <Select
                        searchable
                        value={shippingServiceId}
                        onChange={setShippingServiceId}
                        options={[{ value: '', label: '— choose —' }, ...services.map((s) => ({ value: s.id, label: s.name }))]}
                      />
                    </label>
                    <label className="block">
                      <span className={label}>What they pay</span>
                      <input className={`${field} mono`} value={charge} onChange={(e) => setCharge(e.target.value)} placeholder="0.00" inputMode="decimal" />
                      <span className="mt-1 block text-[11.5px] text-n-500">Appears on their screen once booked.</span>
                    </label>
                    <label className="block">
                      <span className={label}>Currency</span>
                      <Select value={chargeCurrency} onChange={setChargeCurrency} options={['EUR', 'GBP', 'USD'].map((c) => ({ value: c, label: c }))} />
                    </label>
                  </div>
                  {chosenQuote && chosenQuote.serviceType === serviceType && (
                    <p className="mt-2 text-[12px] text-n-600">
                      Our cost {chosenQuote.currency} {chosenQuote.netCharge.toFixed(2)} is recorded with it — ours only, never shown to the customer.
                      {cents(charge) != null && chosenQuote.currency === chargeCurrency && (
                        <> Margin {((cents(charge)! - Math.round(chosenQuote.netCharge * 100)) / 100).toFixed(2)}.</>
                      )}
                    </p>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </ModalShell>
  );
}
