import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ModalShell, Select } from '@masquare/ui';
import { dutyRulesApi, salesChannelsApi, type DutyRule, type DutyRuleInput } from '../../lib/api';
import { useConfirm } from '../ConfirmProvider';
import { AddButton, RefTable, SectionHeader } from './shared';

/**
 * FedEx rules: who pays duties and taxes, pre-filled on every order booked.
 *
 * An ordered list, first match wins. Each rule is a handful of fixed questions — which channel, is
 * the destination the channel's home country, is it outside the EU, will duties be charged there —
 * and one answer, DDP or DAP. Whether duties will be charged comes from each country's import
 * threshold, set under Countries.
 *
 * Logistics customers are not here: their answer is on the customer, under Services.
 */

export const RELATION_LABEL: Record<string, string> = {
  any: 'Any destination',
  channel_home: 'The channel’s own country',
  not_channel_home: 'Not the channel’s own country',
};
export const REGION_LABEL: Record<string, string> = { any: 'Inside or outside the EU', eu: 'Inside the EU', non_eu: 'Outside the EU' };
export const DUE_LABEL: Record<string, string> = { any: 'Whether or not duties are due', yes: 'Duties and taxes are due', no: 'No duties or taxes due' };
export const PAID_BY_LABEL: Record<string, string> = { sender: 'DDP — we pay duties and taxes', recipient: 'DAP — the recipient pays' };

const options = (m: Record<string, string>) => Object.entries(m).map(([value, label]) => ({ value, label }));

export function FedexRulesTab() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data: rules = [], isLoading } = useQuery({ queryKey: ['fedex-duty-rules'], queryFn: dutyRulesApi.list });
  const [editing, setEditing] = useState<DutyRule | null | undefined>(undefined);

  const remove = useMutation({
    mutationFn: (id: string) => dutyRulesApi.remove(id),
    onSuccess: (rows) => { qc.setQueryData(['fedex-duty-rules'], rows); toast.success('Rule removed'); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not remove it'),
  });

  return (
    <div>
      <SectionHeader
        title="FedEx rules"
        description="Who pays duties and taxes, pre-filled when one of our orders is booked with FedEx. Rules are checked in order and the first one that fits is used; the booking screen shows which, and it can still be changed. Whether duties are due comes from each country’s import threshold, under Countries."
      >
        <AddButton label="Add rule" onClick={() => setEditing(null)} />
      </SectionHeader>

      <RefTable<DutyRule>
        rows={rules}
        loading={isLoading}
        empty="No rules yet. Without one, who pays duties is left for the person booking to choose."
        columns={[
          { key: 'order', header: '#', className: 'w-12 mono text-n-500', render: (r) => r.sortOrder },
          {
            key: 'name', header: 'Rule', render: (r) => (
              <span className={r.active ? 'font-medium text-n-800' : 'text-n-400 line-through'} title={r.active ? undefined : 'Switched off'}>{r.name}</span>
            ),
          },
          {
            key: 'when', header: 'When', render: (r) => (
              <span className="text-[12.5px] text-n-600">
                {[r.salesChannel?.name ?? 'Any channel', RELATION_LABEL[r.destinationRelation], REGION_LABEL[r.destinationRegion], DUE_LABEL[r.dutiesDue]].join(' · ')}
              </span>
            ),
          },
          {
            key: 'then', header: 'Pre-fill', render: (r) => (
              <span className={`tag ${r.dutiesPaidBy === 'sender' ? 'bg-teal-50 text-teal-700' : 'bg-info-bg text-info'}`}>{r.dutiesPaidBy === 'sender' ? 'DDP' : 'DAP'}</span>
            ),
          },
        ]}
        onEdit={(r) => setEditing(r)}
        onDelete={async (r) => {
          const ok = await confirm({ title: `Remove “${r.name}”?`, message: 'Orders booked from now on are no longer pre-filled by it.', confirmLabel: 'Remove', tone: 'danger' });
          if (ok) remove.mutate(r.id);
        }}
      />

      {editing !== undefined && <RuleModal rule={editing} onClose={() => setEditing(undefined)} />}
    </div>
  );
}

function RuleModal({ rule, onClose }: { rule: DutyRule | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: channels = [] } = useQuery({ queryKey: ['sales-channels'], queryFn: () => salesChannelsApi.list() });
  const [dirty, setDirty] = useState(false);
  // Plain strings while editing; the API checks each condition against its list on save.
  const [form, setForm] = useState<{
    name: string; sortOrder: string; active: boolean; salesChannelId: string;
    destinationRelation: string; destinationRegion: string; dutiesDue: string; dutiesPaidBy: string;
  }>({
    name: rule?.name ?? '',
    sortOrder: rule?.sortOrder != null ? String(rule.sortOrder) : '',
    active: rule?.active ?? true,
    salesChannelId: rule?.salesChannelId ?? '',
    destinationRelation: rule?.destinationRelation ?? 'any',
    destinationRegion: rule?.destinationRegion ?? 'any',
    dutiesDue: rule?.dutiesDue ?? 'any',
    dutiesPaidBy: rule?.dutiesPaidBy ?? '',
  });
  const set = (patch: Partial<typeof form>) => { setForm((f) => ({ ...f, ...patch })); setDirty(true); };

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name.trim(),
        ...(form.sortOrder.trim() !== '' ? { sortOrder: Number(form.sortOrder) } : {}),
        active: form.active,
        salesChannelId: form.salesChannelId || null,
        destinationRelation: form.destinationRelation,
        destinationRegion: form.destinationRegion,
        dutiesDue: form.dutiesDue,
        dutiesPaidBy: form.dutiesPaidBy,
      } as DutyRuleInput;
      return rule ? dutyRulesApi.update(rule.id, body) : dutyRulesApi.create(body);
    },
    onSuccess: (rows) => { qc.setQueryData(['fedex-duty-rules'], rows); toast.success(rule ? 'Rule saved' : 'Rule added'); onClose(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not save the rule', { duration: 9000 }),
  });

  const canSave = !!form.name.trim() && !!form.dutiesPaidBy && !save.isPending;

  return (
    <ModalShell
      open
      title={rule ? 'Edit FedEx rule' : 'New FedEx rule'}
      subtitle={rule?.name}
      dirty={dirty}
      primaryLabel={rule ? 'Save rule' : 'Add rule'}
      primaryDisabled={!canSave}
      onPrimary={() => save.mutate()}
      busy={save.isPending}
      onClose={onClose}
      initialSize={{ w: 640, h: 560 }}
    >
      <div className="grid grid-cols-2 gap-4 max-[560px]:grid-cols-1">
        <div className="col-span-2 max-[560px]:col-span-1">
          <label className="label">Name *</label>
          <input className="input" value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Home market exports — DDP" />
        </div>
        <div>
          <label className="label">Order</label>
          <input className="input mono" inputMode="numeric" value={form.sortOrder} onChange={(e) => set({ sortOrder: e.target.value.replace(/[^\d-]/g, '') })} placeholder="At the end" />
          <p className="mt-1 text-[11.5px] text-n-500">Lower is checked first.</p>
        </div>
        <div>
          <label className="label">Status</label>
          <Select value={form.active ? 'on' : 'off'} onChange={(v) => set({ active: v === 'on' })} options={[{ value: 'on', label: 'In use' }, { value: 'off', label: 'Switched off' }]} />
        </div>

        <div className="col-span-2 max-[560px]:col-span-1 border-t border-n-100 pt-3 text-[12px] font-semibold uppercase tracking-wide text-n-500">When</div>
        <div>
          <label className="label">Sales channel</label>
          <Select
            searchable
            value={form.salesChannelId}
            onChange={(v) => set({ salesChannelId: v })}
            options={[{ value: '', label: 'Any channel' }, ...channels.map((c) => ({ value: c.id, label: c.name }))]}
          />
        </div>
        <div>
          <label className="label">Destination</label>
          <Select value={form.destinationRelation} onChange={(v) => set({ destinationRelation: v })} options={options(RELATION_LABEL)} />
        </div>
        <div>
          <label className="label">Region</label>
          <Select value={form.destinationRegion} onChange={(v) => set({ destinationRegion: v })} options={options(REGION_LABEL)} />
        </div>
        <div>
          <label className="label">Duties and taxes on arrival</label>
          <Select value={form.dutiesDue} onChange={(v) => set({ dutiesDue: v })} options={options(DUE_LABEL)} />
        </div>

        <div className="col-span-2 max-[560px]:col-span-1 border-t border-n-100 pt-3 text-[12px] font-semibold uppercase tracking-wide text-n-500">Then pre-fill</div>
        <div className="col-span-2 max-[560px]:col-span-1">
          <label className="label">Duties and taxes paid by *</label>
          <Select value={form.dutiesPaidBy} onChange={(v) => set({ dutiesPaidBy: v })} options={[{ value: '', label: '— choose —' }, ...options(PAID_BY_LABEL)]} />
          <p className="mt-1.5 text-[11.5px] text-n-500">
            “The channel’s own country” uses the channel’s native country, under Sales channels. A channel without one never matches it, and nor does a
            destination whose import threshold is not set, when the rule asks whether duties are due.
          </p>
        </div>
      </div>
    </ModalShell>
  );
}
