import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { ModalShell, Select } from '@masquare/ui';
import { brandsApi, brandRestrictionsApi, channelListingsApi, type BrandRestriction } from '../../lib/api';
import { AddButton, RefTable, SectionHeader, SectionSearch } from './shared';
import { sortChannelsCanonical } from '../../lib/channelGroups';

/**
 * Channels a brand has told us not to sell them on.
 *
 * Nothing to do with Amazon's own gating. Amazon may take the listing quite happily and the
 * restriction still stands, because it arrived as a letter. Recorded here so that whoever lists a
 * product months later sees it — the letter itself lives in somebody's inbox.
 *
 * It warns; it never blocks. The person listing may know the letter was withdrawn or does not
 * cover this line, and the platform is not in a position to overrule them.
 */
export function BrandRestrictionsSection() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);

  const { data = [], isLoading } = useQuery({ queryKey: ['brand-restrictions'], queryFn: () => brandRestrictionsApi.list() });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['brand-restrictions'] });
  const del = useMutation({
    mutationFn: (id: string) => brandRestrictionsApi.remove(id),
    onSuccess: () => { toast.success('Restriction removed'); invalidate(); },
  });

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return data;
    return data.filter((r) =>
      [r.brand?.name, r.channelType, r.marketplace, r.note].some((f) => (f ?? '').toLowerCase().includes(t)));
  }, [data, q]);

  return (
    <div>
      <SectionHeader
        title="Brand Restrictions"
        description="Channels a brand has told us not to sell them on. Warns when listing — it never blocks."
      >
        <AddButton label="Add restriction" onClick={() => setAdding(true)} />
      </SectionHeader>

      <SectionSearch value={q} onChange={setQ} placeholder="Search brand, channel or note…" matched={shown.length} total={data.length} />

      <RefTable<BrandRestriction>
        loading={isLoading}
        empty={q.trim() ? `No restriction matches “${q.trim()}”.` : 'No brand restrictions. Add one when a brand writes to us.'}
        rows={shown}
        columns={[
          { key: 'brand', header: 'Brand', render: (r) => <span className="font-medium text-n-800">{r.brand?.name ?? '—'}</span> },
          {
            key: 'channel',
            header: 'Restricted on',
            render: (r) => (
              <span className="inline-flex items-center gap-1.5">
                <Ban size={12} className="text-danger" />
                <span className="font-medium text-n-800">
                  {titleCase(r.channelType)}{r.marketplace ? ` ${r.marketplace}` : ''}
                </span>
                {/* A blank marketplace is the whole channel, which is a bigger claim and should read
                    as one rather than looking like a missing value. */}
                {!r.marketplace && <span className="text-[11.5px] text-n-500">all marketplaces</span>}
              </span>
            ),
          },
          { key: 'note', header: 'Reason / reference', render: (r) => r.note || <span className="text-n-400">—</span> },
        ]}
        onEdit={() => toast.info('Remove and re-add to change a restriction')}
        onDelete={(r) => confirm(`Remove the restriction on ${r.brand?.name ?? 'this brand'}?`) && del.mutate(r.id)}
      />

      {adding && <AddRestrictionModal onClose={() => setAdding(false)} onSaved={() => { setAdding(false); invalidate(); }} />}
    </div>
  );
}

const titleCase = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function AddRestrictionModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [brandId, setBrandId] = useState('');
  /**
   * Several channels, because that is how a brand letter arrives.
   *
   * One letter naming four marketplaces used to mean filling this form four times — and retyping
   * the note each time. The note is what makes the warning actionable months later, so four
   * slightly different versions of it was a worse outcome than one.
   */
  const [channelKeys, setChannelKeys] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const { data: brands = [] } = useQuery({ queryKey: ['brands'], queryFn: () => brandsApi.list() });
  const { data: channels = [] } = useQuery({ queryKey: ['channel-listings-channels'], queryFn: () => channelListingsApi.channels() });

  /**
   * The connected channels, plus a whole-channel option for each type.
   *
   * Offering the connected channels means the marketplace codes match the ones the rest of the
   * platform uses; typing them by hand is how "UK" becomes "GB" and the rule silently never fires.
   */
  const options = useMemo(() => {
    const types = [...new Set(channels.map((c) => c.channelType))].sort();
    const whole = types.map((t) => ({ value: `${t}|`, label: `${titleCase(t)} — all marketplaces` }));
    // Canonical order, not alphabetical: this list is read alongside the same channels everywhere
    // else, and two orders for one set of things is how somebody ticks the wrong row.
    const each = sortChannelsCanonical(
      channels.map((c) => ({
        value: `${c.channelType}|${c.marketplace ?? ''}`,
        label: c.name,
        name: c.name,
        countryIso: c.countryIso ?? c.marketplace ?? null,
        channelType: c.channelType,
      })),
    ).map(({ value, label }) => ({ value, label }));
    return [...whole, ...each];
  }, [channels]);

  /**
   * The options grouped under their channel, so a long list of marketplaces reads as three short
   * lists rather than one of twenty-six. "eBay — all marketplaces" sits inside the eBay group with
   * the rest, where it can be compared against them.
   */
  const byType = useMemo(() => {
    const groups = new Map<string, typeof options>();
    for (const o of options) {
      const type = o.value.split('|')[0];
      groups.set(type, [...(groups.get(type) ?? []), o]);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [options]);

  const save = async () => {
    if (!brandId || channelKeys.size === 0) { toast.error('Pick a brand and at least one channel'); return; }
    const channels = [...channelKeys].map((key) => {
      const [channelType, marketplace] = key.split('|');
      return { channelType, marketplace };
    });
    setBusy(true);
    try {
      // One call, one transaction. Half a brand letter recorded is worse than none: the screen
      // would show a partial rule that reads as complete.
      await brandRestrictionsApi.create({ brandId, channels, note: note.trim() || null });
      toast.success(channels.length === 1 ? 'Restriction added' : `${channels.length} restrictions added`);
      onSaved();
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Could not save');
    } finally { setBusy(false); }
  };

  const toggle = (value: string) =>
    setChannelKeys((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value); else next.add(value);
      return next;
    });

  /** Every marketplace of one channel type, for the "all of these" shortcut. */
  const typeOf = (value: string) => value.split('|')[0];
  const selectType = (channelType: string) =>
    setChannelKeys((prev) => {
      const next = new Set(prev);
      const marketplaces = options.filter((o) => typeOf(o.value) === channelType && o.value !== `${channelType}|`);
      const allOn = marketplaces.every((o) => next.has(o.value));
      marketplaces.forEach((o) => (allOn ? next.delete(o.value) : next.add(o.value)));
      return next;
    });

  return (
    <ModalShell open title="Add brand restriction" primaryLabel={busy ? 'Saving…' : 'Add restriction'} onPrimary={save} onClose={onClose} initialSize={{ w: 560, h: 420 }}>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold text-n-600">Brand *</span>
          <Select value={brandId} onChange={setBrandId} placeholder="Pick a brand"
            options={brands.map((b) => ({ value: b.id, label: b.name }))} />
        </label>

        <div className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold text-n-600">
            Restricted channels * <span className="font-normal text-n-400">— pick as many as the letter names</span>
          </span>
          <div className="max-h-[210px] overflow-y-auto rounded-md border border-n-200">
            {byType.map(([channelType, entries]) => (
              <div key={channelType} className="border-b border-n-100 last:border-b-0">
                <div className="flex items-center gap-2 bg-n-25 px-2.5 py-1.5">
                  <span className="flex-1 text-[11.5px] font-bold uppercase tracking-wide text-n-500">
                    {titleCase(channelType)}
                  </span>
                  {/* One click for "the whole of Amazon", which is the common case for a brand
                      that has withdrawn from a channel entirely. */}
                  <button
                    type="button"
                    onClick={() => selectType(channelType)}
                    className="text-[11px] font-semibold text-teal-700 hover:underline"
                  >
                    All marketplaces
                  </button>
                </div>
                {entries.map((o) => (
                  <label key={o.value} className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 hover:bg-n-25">
                    <input
                      type="checkbox"
                      checked={channelKeys.has(o.value)}
                      onChange={() => toggle(o.value)}
                      className="h-3.5 w-3.5 accent-teal-600"
                    />
                    <span className="text-[12.5px] text-n-700">{o.label}</span>
                  </label>
                ))}
              </div>
            ))}
          </div>
          <span className="text-[11.5px] text-n-400">
            {channelKeys.size === 0
              ? 'None selected yet.'
              : `${channelKeys.size} selected — one restriction will be recorded for each, sharing this note.`}
          </span>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold text-n-600">Reason / reference</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. letter of 4 Aug 2026"
            className="h-9 rounded-md border border-n-200 px-2.5 text-[13px] outline-none focus:border-teal-400"
          />
          {/* The note is what makes the warning actionable months later — without it nobody can
              tell whether the restriction still applies. */}
          <span className="text-[11.5px] text-n-400">
            Shown to whoever hits this warning while listing, so name the letter or the person who sent it.
          </span>
        </label>

        <div className="flex items-start gap-1.5 rounded-md border border-n-200 bg-n-25 px-2.5 py-2 text-[12px] text-n-600">
          <Plus size={12} className="mt-0.5 shrink-0 rotate-45 text-n-400" />
          <span>
            This warns when listing; it does not prevent it. Amazon's own approval gating is separate and
            reported separately.
          </span>
        </div>
      </div>
    </ModalShell>
  );
}
