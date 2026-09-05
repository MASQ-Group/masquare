import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ModalShell, Select } from '@masquare/ui';
import { attributesApi, type Attribute } from '../../lib/api';
import { AddButton, RefTable, SectionHeader, SectionSearch } from './shared';

export function AttributesSection() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Attribute | null | undefined>(undefined);
  const [q, setQ] = useState('');
  const { data = [], isLoading } = useQuery({ queryKey: ['attributes'], queryFn: () => attributesApi.list() });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['attributes'] });
  const del = useMutation({ mutationFn: (id: string) => attributesApi.remove(id), onSuccess: () => { toast.success('Removed'); invalidate(); } });

  // Values are searchable as well as names: you are as likely to be looking for the attribute that
  // holds "Rose Gold" as for one called "Colour".
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return data;
    return data.filter((a) => a.name.toLowerCase().includes(t) || a.values.some((v) => v.value.toLowerCase().includes(t)));
  }, [data, q]);

  return (
    <div>
      <SectionHeader title="Attributes" description="Reusable product characteristics — predefined value sets or free text.">
        <AddButton label="Add attribute" onClick={() => setEditing(null)} />
      </SectionHeader>
      <SectionSearch value={q} onChange={setQ} placeholder="Search attributes or their values…" matched={shown.length} total={data.length} />
      <RefTable<Attribute>
        loading={isLoading}
        empty={q.trim() ? `No attribute matches “${q.trim()}”.` : 'No attributes yet.'}
        rows={shown}
        columns={[
          { key: 'name', header: 'Name', render: (r) => <span className="font-medium text-n-800">{r.name}</span> },
          { key: 'type', header: 'Input', render: (r) => (
            <div className="flex flex-wrap items-center gap-1.5">
              {r.inputType === 'predefined'
                ? <span className="tag border border-info-bd bg-info-bg text-info">Predefined</span>
                : <span className="tag border border-n-200 bg-n-100 text-n-600">Free text</span>}
              {r.allowMultiple && <span className="tag border border-n-200 bg-n-100 text-n-600">Multi-value</span>}
            </div>
          ) },
          { key: 'values', header: 'Values', render: (r) => (
            <div className="flex flex-wrap gap-1.5">
              {r.values.length === 0 && <span className="text-n-400">—</span>}
              {r.values.slice(0, 6).map((v) => (
                <span key={v.id} className="mono rounded bg-n-100 px-2 py-0.5 text-[11px] text-n-600">{v.value}</span>
              ))}
              {r.values.length > 6 && <span className="text-[11px] text-n-400">+{r.values.length - 6}</span>}
            </div>
          ) },
        ]}
        onEdit={setEditing}
        onDelete={(r) => confirm(`Remove ${r.name}?`) && del.mutate(r.id)}
      />
      {editing !== undefined && (
        <AttributeModal attribute={editing} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); invalidate(); }} />
      )}
    </div>
  );
}

function AttributeModal({ attribute, onClose, onSaved }: { attribute: Attribute | null; onClose: () => void; onSaved: () => void }) {
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(attribute?.name ?? '');
  const [inputType, setInputType] = useState<'predefined' | 'free_text'>(attribute?.inputType ?? 'predefined');
  const [allowMultiple, setAllowMultiple] = useState<boolean>(attribute?.allowMultiple ?? false);
  const [values, setValues] = useState<string[]>(attribute?.values.map((v) => v.value) ?? ['']);

  const canSave = name.trim().length > 0;
  const valuesLabel = inputType === 'predefined' ? 'Allowed values *' : 'Suggested values (optional)';

  const save = async () => {
    if (!canSave) { toast.error('Name is required'); return; }
    const cleanValues = values.map((v) => v.trim()).filter(Boolean);
    if (inputType === 'predefined' && cleanValues.length === 0) {
      toast.error('Predefined attributes need at least one value');
      return;
    }
    setBusy(true);
    try {
      const body = { name, inputType, allowMultiple, values: cleanValues };
      if (attribute) await attributesApi.update(attribute.id, body); else await attributesApi.create(body);
      toast.success('Saved');
      onSaved();
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      open title={attribute ? 'Edit attribute' : 'New attribute'} subtitle={attribute?.name}
      dirty={dirty} primaryLabel={attribute ? 'Save changes' : 'Create attribute'} onPrimary={save} primaryDisabled={!canSave} busy={busy} onClose={onClose}
    >
      <div className="flex flex-col gap-4">
        <div>
          <label className="label">Name *</label>
          <input className="input" value={name} onChange={(e) => { setName(e.target.value); setDirty(true); }} placeholder="Plug Type" />
        </div>
        <div>
          <label className="label">Input type *</label>
          <Select
            value={inputType}
            onChange={(v) => { setInputType(v as any); setDirty(true); }}
            options={[
              { value: 'predefined', label: 'Predefined — choose from a fixed set' },
              { value: 'free_text', label: 'Free text — type any value' },
            ]}
          />
        </div>
        <label className="flex cursor-pointer items-start gap-2.5">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 cursor-pointer accent-primary"
            checked={allowMultiple}
            onChange={(e) => { setAllowMultiple(e.target.checked); setDirty(true); }}
          />
          <span className="text-[13px] leading-tight text-n-700">
            Allow multiple values per SKU
            <span className="block text-[12px] text-n-400">A product can carry this attribute more than once (e.g. several materials or compatible models).</span>
          </span>
        </label>
        <div>
          <label className="label">{valuesLabel}</label>
          <div className="flex flex-col gap-2">
            {values.map((v, i) => (
              <div key={i} className="flex items-center gap-2">
                <input className="input mono" value={v} placeholder="e.g. UK" onChange={(e) => { setValues((r) => r.map((x, idx) => idx === i ? e.target.value : x)); setDirty(true); }} />
                <button className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-md text-n-500 hover:bg-danger-bg hover:text-danger" onClick={() => { setValues((r) => r.filter((_, idx) => idx !== i)); setDirty(true); }}><Trash2 size={15} /></button>
              </div>
            ))}
            <div><button className="btn btn-ghost" onClick={() => { setValues((r) => [...r, '']); setDirty(true); }}><Plus size={16} /> Add value</button></div>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}
