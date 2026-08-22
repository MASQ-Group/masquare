import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, Trash2, Upload } from 'lucide-react';
import { ModalShell, downloadSheet } from '@masquare/ui';
import { countriesApi, salesChannelsApi, type SalesChannel } from '../../lib/api';
import { CountrySelect } from '../common/CountrySelect';
import { CurrencySelect } from '../common/CurrencySelect';
import { CountryTag } from '../common/Flag';
import { ChannelChip, chipForCountry, NEUTRAL_CHIP } from '../common/ChannelChip';
import { AddButton, RefTable, SectionHeader } from './shared';
import { SalesChannelImportModal } from './SalesChannelImportModal';

const EXPORT_HEADERS = ['Name', 'Description', 'Native Country', 'Native Currency', 'General Sales Fee (%)', 'Fee In Native Currency', 'Fee Currency', 'Email', 'Website', 'Contact Name'];

export function SalesChannelsTab() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<SalesChannel | null | undefined>(undefined);
  const { data = [], isLoading } = useQuery({ queryKey: ['sales-channels'], queryFn: () => salesChannelsApi.list() });
  const { data: countries = [] } = useQuery({ queryKey: ['countries'], queryFn: () => countriesApi.list() });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['sales-channels'] });
  const del = useMutation({ mutationFn: (id: string) => salesChannelsApi.remove(id), onSuccess: () => { toast.success('Removed'); invalidate(); } });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importOpen, setImportOpen] = useState(false);

  const allSelected = data.length > 0 && data.every((c) => selected.has(c.id));
  const toggleAll = () => setSelected((prev) => { const n = new Set(prev); if (data.every((c) => n.has(c.id))) data.forEach((c) => n.delete(c.id)); else data.forEach((c) => n.add(c.id)); return n; });
  const toggleOne = (id: string) => setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const exportSelected = () => {
    const chosen = data.filter((c) => selected.has(c.id));
    if (chosen.length === 0) return;
    const rows = chosen.map((c) => [c.name, c.description ?? '', c.nativeCountry?.name ?? '', c.nativeCurrency ?? '', c.generalSalesFeePct ?? '', c.feeChargedInNativeCurrency ? 'Yes' : 'No', c.feeCurrency ?? '', c.email ?? '', c.website ?? '', c.contactName ?? '']);
    downloadSheet(`sales-channels-${chosen.length}`, [EXPORT_HEADERS, ...rows], 'xlsx');
    toast.success(`Exported ${chosen.length} sales channels`);
  };

  // Resolve a country cell (ISO code or official name) to its id for import.
  const resolveCountryId = (token?: string) => {
    const t = (token ?? '').trim();
    if (!t) return null;
    const c = countries.find((x) => x.isoCode.toLowerCase() === t.toLowerCase() || x.name.toLowerCase() === t.toLowerCase());
    return c?.id ?? null;
  };

  const downloadTemplate = () =>
    downloadSheet('sales-channels-template', [
      ['Name', 'Description', 'Native Country', 'Native Currency', 'Email', 'Website', 'Contact Name'],
      ['Amazon UK', 'Amazon United Kingdom', 'United Kingdom', 'GBP', '15', 'Yes', '', 'seller@example.com', 'https://amazon.co.uk', 'Marketplace Team'],
      ['eBay DE', 'eBay Germany', 'Germany', 'EUR', '11', 'No', 'USD', 'seller@example.de', 'https://ebay.de', 'Sales'],
    ], 'xlsx');

  return (
    <div>
      <SectionHeader title="Sales Channels" description="Marketplaces and channels the companies sell on, with their native country and currency.">
        <button className="btn btn-ghost" onClick={downloadTemplate}><Download size={16} /> Template</button>
        <button className="btn btn-ghost" onClick={() => setImportOpen(true)}><Upload size={16} /> Import</button>
        <AddButton label="Add sales channel" onClick={() => setEditing(null)} />
      </SectionHeader>

      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-teal-200 bg-teal-50 px-3 py-2">
          <span className="text-[13px] font-semibold text-teal-800">{selected.size} selected</span>
          <div className="mx-1 h-5 w-px bg-teal-200" />
          <button className="inline-flex h-8 items-center gap-1.5 rounded-md border border-n-200 bg-n-0 px-2.5 text-[12.5px] font-medium text-n-700 hover:bg-n-50" onClick={exportSelected}><Download size={14} /> Export selected</button>
          <button className="inline-flex h-8 items-center gap-1.5 rounded-md border border-danger-bd bg-n-0 px-2.5 text-[12.5px] font-medium text-danger hover:bg-danger-bg" onClick={() => { if (confirm(`Remove ${selected.size} sales channels?`)) { [...selected].forEach((id) => del.mutate(id)); setSelected(new Set()); } }}><Trash2 size={14} /> Delete</button>
          <button className="ml-auto text-[12.5px] font-medium text-teal-700 hover:underline" onClick={() => setSelected(new Set())}>Clear selection</button>
        </div>
      )}

      <RefTable<SalesChannel>
        loading={isLoading}
        empty="No sales channels yet."
        rows={data}
        selection={{ selected, toggleOne, toggleAll, allSelected }}
        columns={[
          { key: 'name', header: 'Name', render: (r) => <ChannelChip name={r.name} bg={r.chipBgColor} text={r.chipTextColor} /> },
          { key: 'description', header: 'Description', render: (r) => r.description ?? '—' },
          { key: 'country', header: 'Native country', render: (r) => r.nativeCountry ? <CountryTag code={r.nativeCountry.isoCode} name={r.nativeCountry.name} /> : '—' },
          { key: 'currency', header: 'Currency', className: 'mono', render: (r) => r.nativeCurrency ?? '—' },
          { key: 'fee', header: 'Sales fee', className: 'mono', render: (r) => (r.generalSalesFeePct != null ? `${r.generalSalesFeePct}%` : '—') },
          { key: 'email', header: 'Email', render: (r) => r.email ?? '—' },
        ]}
        onEdit={setEditing}
        onDelete={(r) => confirm(`Remove ${r.name}?`) && del.mutate(r.id)}
      />
      {editing !== undefined && (
        <SalesChannelModal channel={editing} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); invalidate(); }} />
      )}
      {importOpen && (
        <SalesChannelImportModal channels={data} resolveCountryId={resolveCountryId} onClose={() => setImportOpen(false)} onDone={() => { setImportOpen(false); setSelected(new Set()); invalidate(); }} />
      )}
    </div>
  );
}

function SalesChannelModal({ channel, onClose, onSaved }: { channel: SalesChannel | null; onClose: () => void; onSaved: () => void }) {
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const touch = () => setDirty(true);
  const [form, setForm] = useState({
    name: channel?.name ?? '',
    description: channel?.description ?? '',
    nativeCountryId: channel?.nativeCountryId ?? null as string | null,
    nativeCurrency: channel?.nativeCurrency ?? null as string | null,
    generalSalesFeePct: channel?.generalSalesFeePct?.toString() ?? '',
    feeChargedInNativeCurrency: channel?.feeChargedInNativeCurrency ?? true,
    feeCurrency: channel?.feeCurrency ?? null as string | null,
    showTransactionTotal: channel?.showTransactionTotal ?? false,
    chipBgColor: channel?.chipBgColor ?? '#F1F3F5',
    chipTextColor: channel?.chipTextColor ?? '#495057',
    vatThresholdEnabled: channel?.vatThresholdEnabled ?? false,
    pricesIncludeTax: channel?.pricesIncludeTax ?? true,
    fxSpreadPct: channel?.fxSpreadPct != null ? String(channel.fxSpreadPct) : '',
    fxSpreadNote: channel?.fxSpreadNote ?? '',
    vatThresholdAmount: channel?.vatThresholdAmount?.toString() ?? '',
    vatThresholdCurrency: channel?.vatThresholdCurrency ?? null as string | null,
    vatBelowThresholdPct: channel?.vatBelowThresholdPct?.toString() ?? '',
    vatAboveThresholdPct: channel?.vatAboveThresholdPct?.toString() ?? '',
    email: channel?.email ?? '',
    website: channel?.website ?? '',
    contactName: channel?.contactName ?? '',
  });
  const set = (patch: Partial<typeof form>) => { setForm((f) => ({ ...f, ...patch })); touch(); };
  const { data: allCountries = [] } = useQuery({ queryKey: ['countries'], queryFn: () => countriesApi.list() });
  // Sibling channels of the chosen country, so a new chip takes a variant none of them use.
  const { data: allChannels = [] } = useQuery({ queryKey: ['sales-channels'], queryFn: () => salesChannelsApi.list() });
  const onNativeCountry = (v: string | null) => {
    const iso = allCountries.find((c) => c.id === v)?.isoCode;
    setForm((f) => {
      const next = { ...f, nativeCountryId: v };
      // New channel → pre-fill the chip colours from that country's flag (editable afterwards).
      // Only while they're still untouched defaults, so a chosen colour is never overwritten.
      const current = channel ? { bg: channel.chipBgColor, text: channel.chipTextColor } : { bg: null, text: null };
      const untouched = f.chipBgColor === (current.bg ?? NEUTRAL_CHIP.bg) && f.chipTextColor === (current.text ?? NEUTRAL_CHIP.text);
      if (untouched) {
        const siblings = allChannels
          .filter((c) => c.nativeCountryId === v && c.id !== channel?.id)
          .map((c) => ({ bg: c.chipBgColor, text: c.chipTextColor }));
        const palette = chipForCountry(iso, siblings);
        next.chipBgColor = palette.bg;
        next.chipTextColor = palette.text;
      }
      // UK native country → default the £135 marketplace VAT rule (editable afterwards).
      if (iso === 'GB' && !f.vatThresholdEnabled) {
        next.vatThresholdEnabled = true;
        if (!f.vatThresholdAmount) next.vatThresholdAmount = '135';
        if (!f.vatThresholdCurrency) next.vatThresholdCurrency = 'GBP';
        if (!f.vatBelowThresholdPct) next.vatBelowThresholdPct = '20';
        if (!f.vatAboveThresholdPct) next.vatAboveThresholdPct = '0';
      }
      return next;
    });
    touch();
  };
  const canSave = form.name.trim().length > 0;

  const save = async () => {
    if (!canSave) { toast.error('Name is required'); return; }
    setBusy(true);
    try {
      const body = {
        ...form,
        description: form.description || undefined,
        generalSalesFeePct: form.generalSalesFeePct.trim() === '' ? null : Number(form.generalSalesFeePct),
        feeChargedInNativeCurrency: form.feeChargedInNativeCurrency,
        feeCurrency: form.feeChargedInNativeCurrency ? null : form.feeCurrency,
        pricesIncludeTax: form.pricesIncludeTax,
        fxSpreadPct: form.fxSpreadPct.trim() === '' ? null : Number(form.fxSpreadPct),
        fxSpreadNote: form.fxSpreadNote.trim() || null,
        vatThresholdEnabled: form.vatThresholdEnabled,
        vatThresholdAmount: form.vatThresholdEnabled && form.vatThresholdAmount.trim() !== '' ? Number(form.vatThresholdAmount) : null,
        vatThresholdCurrency: form.vatThresholdEnabled ? form.vatThresholdCurrency : null,
        vatBelowThresholdPct: form.vatThresholdEnabled && form.vatBelowThresholdPct.trim() !== '' ? Number(form.vatBelowThresholdPct) : null,
        vatAboveThresholdPct: form.vatThresholdEnabled && form.vatAboveThresholdPct.trim() !== '' ? Number(form.vatAboveThresholdPct) : null,
        email: form.email || undefined,
        website: form.website || undefined,
        contactName: form.contactName || undefined,
      };
      if (channel) await salesChannelsApi.update(channel.id, body as any); else await salesChannelsApi.create(body as any);
      toast.success('Saved');
      onSaved();
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell open title={channel ? 'Edit sales channel' : 'New sales channel'} subtitle={channel?.name} dirty={dirty}
      primaryLabel={channel ? 'Save changes' : 'Create channel'} onPrimary={save} primaryDisabled={!canSave} busy={busy} onClose={onClose}>
      <div className="grid grid-cols-2 gap-4 max-[560px]:grid-cols-1">
        <div><label className="label">Name *</label><input className="input" value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Amazon UK" /></div>
        <div><label className="label">Description</label><input className="input" value={form.description} onChange={(e) => set({ description: e.target.value })} placeholder="Amazon United Kingdom" /></div>
        <div><label className="label">Native country</label><CountrySelect value={form.nativeCountryId} onChange={onNativeCountry} /></div>
        <div><label className="label">Native currency</label><CurrencySelect value={form.nativeCurrency} onChange={(v) => set({ nativeCurrency: v })} /></div>
        <div className="col-span-2 rounded-md border border-n-200 bg-n-25 p-3 max-[560px]:col-span-1">
          <label className="label">Currency conversion spread</label>
          <p className="mb-2 text-[11.5px] text-n-500">
            For channels that convert the order themselves and pay out in EUR. They rarely use the market
            rate — eBay runs about 3% below it, which overstates profit on every non-EUR sale. Enter how far
            below, and the market rate for the day is discounted by it. Leave empty for channels that pay out
            in the currency they collected, where our own rate is the right one.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-[150px]">
              <label className="label">Below market rate</label>
              <div className="relative">
                <input
                  className="input mono h-9 pr-6 text-right"
                  inputMode="decimal"
                  placeholder="0"
                  value={form.fxSpreadPct}
                  onChange={(e) => set({ fxSpreadPct: e.target.value })}
                />
                <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[12px] text-n-400">%</span>
              </div>
            </div>
            <div className="min-w-[200px] flex-1">
              <label className="label">Where it came from</label>
              <input
                className="input"
                placeholder="e.g. average of 5 payout statements, Jul–Aug 2026"
                value={form.fxSpreadNote}
                onChange={(e) => set({ fxSpreadNote: e.target.value })}
              />
            </div>
          </div>
          {channel?.fxSpreadSetAt && form.fxSpreadPct.trim() !== '' && (
            <div className="mt-1.5 text-[11.5px] text-n-400">
              Last set {new Date(channel.fxSpreadSetAt).toLocaleDateString('en-GB')} — worth re-checking against a
              payout statement now and then, since a marketplace can change its markup.
            </div>
          )}
        </div>
        <div><label className="label">General Sales Fee (%)</label><input className="input mono" inputMode="decimal" value={form.generalSalesFeePct} onChange={(e) => set({ generalSalesFeePct: e.target.value })} placeholder="15" /></div>
        <div className="col-span-2 flex flex-col gap-2 rounded-md border border-n-200 bg-n-25 p-3">
          <label className="flex cursor-pointer items-center gap-2.5">
            <input type="checkbox" className="h-4 w-4 accent-[var(--teal-500)]" checked={form.feeChargedInNativeCurrency} onChange={(e) => set({ feeChargedInNativeCurrency: e.target.checked })} />
            <span className="text-[13.5px] text-n-700">Sales fees are charged in the channel's native currency</span>
          </label>
          {!form.feeChargedInNativeCurrency && (
            <div className="max-w-xs pl-6">
              <label className="label">Fee currency</label>
              <CurrencySelect value={form.feeCurrency} onChange={(v) => set({ feeCurrency: v })} />
            </div>
          )}
        </div>
        <div className="col-span-2 flex flex-col gap-2 rounded-md border border-n-200 bg-n-25 p-3">
          <span className="text-[13.5px] font-medium text-n-800">Chip colours</span>
          <p className="text-[11.5px] text-n-500">
            How this channel's name appears across the platform. Defaults come from the native country's flag.
          </p>
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="label">Background</label>
              <input type="color" className="h-9 w-20 cursor-pointer rounded-md border border-n-200 bg-n-0 p-1" value={form.chipBgColor} onChange={(e) => set({ chipBgColor: e.target.value })} title="Chip background colour" />
            </div>
            <div>
              <label className="label">Text</label>
              <input type="color" className="h-9 w-20 cursor-pointer rounded-md border border-n-200 bg-n-0 p-1" value={form.chipTextColor} onChange={(e) => set({ chipTextColor: e.target.value })} title="Chip text colour" />
            </div>
            <div className="pb-1.5">
              <div className="mb-1 text-[11px] text-n-500">Preview</div>
              <ChannelChip name={form.name.trim() || 'Channel name'} bg={form.chipBgColor} text={form.chipTextColor} />
            </div>
          </div>
        </div>
        <div className="col-span-2 flex flex-col gap-2 rounded-md border border-n-200 bg-n-25 p-3">
          <label className="flex cursor-pointer items-center gap-2.5">
            <input type="checkbox" className="h-4 w-4 accent-[var(--teal-500)]" checked={form.showTransactionTotal} onChange={(e) => set({ showTransactionTotal: e.target.checked })} />
            <span className="text-[13.5px] text-n-700">Calculate and show a transaction Total for this channel</span>
          </label>
          <p className="pl-6 text-[11.5px] text-n-500">
            Total = net sales + VAT + shipping paid by the customer + its VAT, in the channel's currency.
            Leave off for marketplaces that report tax their own way, where a single total would mislead.
          </p>
        </div>
        <div className="col-span-2 flex flex-col gap-1.5 rounded-md border border-n-200 bg-n-25 p-3">
          <label className="flex cursor-pointer items-center gap-2.5">
            <input type="checkbox" className="h-4 w-4 accent-[var(--teal-500)]" checked={form.pricesIncludeTax} onChange={(e) => set({ pricesIncludeTax: e.target.checked })} />
            <span className="text-[13.5px] text-n-700">The price we list already includes the destination tax</span>
          </label>
          <p className="pl-6 text-[11.5px] text-n-500">
            {form.pricesIncludeTax
              ? 'Standard for EU marketplaces: the listed price is VAT-inclusive, so profit is calculated from the price less VAT.'
              : 'The marketplace adds the tax at checkout and remits it (e.g. Amazon AU adding GST for an overseas seller). The listed price is treated as our revenue in full — turning this off raises calculated profit and lowers the breakeven and floor.'}
          </p>
        </div>
        <div className="col-span-2 flex flex-col gap-3 rounded-md border border-n-200 bg-n-25 p-3">
          <label className="flex cursor-pointer items-center gap-2.5">
            <input type="checkbox" className="h-4 w-4 accent-[var(--teal-500)]" checked={form.vatThresholdEnabled} onChange={(e) => set({ vatThresholdEnabled: e.target.checked })} />
            <span className="text-[13.5px] text-n-700">Marketplace collects VAT below a value threshold (e.g. UK £135)</span>
          </label>
          {form.vatThresholdEnabled && (
            <div className="grid grid-cols-4 gap-3 pl-6 max-[560px]:grid-cols-2">
              <div><label className="label">Threshold amount</label><input className="input mono" inputMode="decimal" value={form.vatThresholdAmount} onChange={(e) => set({ vatThresholdAmount: e.target.value })} placeholder="135" /></div>
              <div><label className="label">Threshold currency</label><CurrencySelect value={form.vatThresholdCurrency} onChange={(v) => set({ vatThresholdCurrency: v })} /></div>
              <div><label className="label">VAT % ≤ threshold</label><input className="input mono" inputMode="decimal" value={form.vatBelowThresholdPct} onChange={(e) => set({ vatBelowThresholdPct: e.target.value })} placeholder="20" /></div>
              <div><label className="label">VAT % &gt; threshold</label><input className="input mono" inputMode="decimal" value={form.vatAboveThresholdPct} onChange={(e) => set({ vatAboveThresholdPct: e.target.value })} placeholder="0" /></div>
            </div>
          )}
          <p className="text-[11px] text-n-400">When on, a transaction's destination VAT % is set automatically: order value (net + VAT + shipping + shipping VAT) ≤ threshold uses the first rate; above it uses the second.</p>
        </div>
        <div><label className="label">Email</label><input className="input" value={form.email} onChange={(e) => set({ email: e.target.value })} /></div>
        <div><label className="label">Website</label><input className="input" value={form.website} onChange={(e) => set({ website: e.target.value })} /></div>
        <div className="col-span-2"><label className="label">Contact name</label><input className="input" value={form.contactName} onChange={(e) => set({ contactName: e.target.value })} /></div>
      </div>
    </ModalShell>
  );
}
