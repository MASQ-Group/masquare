import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { complianceOptionsApi, type ComplianceOption } from '../../lib/api';
import { AddButton, RefTable, SectionHeader, SimpleRefModal, type SimpleField } from './shared';

/**
 * The vocabularies a product's compliance answers are chosen from.
 *
 * These exist so the answers are comparable: a rule can act on "220-240V" as a code with a range
 * behind it, and cannot act on whatever someone typed into a text box. Editable here so a value
 * nobody anticipated is a row rather than a deploy.
 */
export function ComplianceSection() {
  const qc = useQueryClient();
  const [kind, setKind] = useState('VOLTAGE_RATING');
  const [editing, setEditing] = useState<ComplianceOption | null | undefined>(undefined);

  const { data: kinds = [] } = useQuery({ queryKey: ['compliance-kinds'], queryFn: complianceOptionsApi.kinds });
  // Inactive entries are shown here — this is where you would come to bring one back.
  const { data = [], isLoading } = useQuery({
    queryKey: ['compliance-options', kind, 'all'],
    queryFn: () => complianceOptionsApi.list(kind, true),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['compliance-options'] });
    qc.invalidateQueries({ queryKey: ['listing'] });
  };

  const del = useMutation({
    mutationFn: (id: string) => complianceOptionsApi.remove(id),
    onSuccess: (r) => {
      // Retiring rather than deleting is the normal outcome, so it is reported as a result, not a
      // failure — the value stays on every product that already carries it.
      toast.success(r.retired ? `Retired — ${r.inUse} product${r.inUse === 1 ? '' : 's'} keep it` : 'Removed');
      invalidate();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not remove'),
  });

  const isVoltage = kind === 'VOLTAGE_RATING';

  const fields: SimpleField[] = [
    { key: 'code', label: 'Code', required: true, mono: true, hint: 'What the rules and the channels see. Changing it on a value already in use re-points those products.' },
    { key: 'label', label: 'Label', required: true, hint: 'What a person picking from the list reads.' },
    ...(isVoltage
      ? ([
          { key: 'numericMin', label: 'Minimum volts', type: 'number', section: 'Mains range',
            hint: 'Give both or neither. Leave both empty for ratings with no mains supply, such as battery powered — those pass every market.' },
          { key: 'numericMax', label: 'Maximum volts', type: 'number' },
        ] as SimpleField[])
      : []),
    { key: 'note', label: 'Note', section: 'Optional' },
    { key: 'sortOrder', label: 'Sort order', type: 'number' },
    { key: 'active', label: 'Offered when filling in a product', type: 'checkbox' },
  ];

  return (
    <div>
      <SectionHeader
        title="Compliance values"
        description="The fixed lists a product's technical facts are chosen from. Voltage ranges here are what decide which marketplaces a product may be sold on."
      >
        <AddButton label="Add value" onClick={() => setEditing(null)} />
      </SectionHeader>

      {/* One list at a time: they are unrelated vocabularies that happen to share a shape. */}
      <div className="mb-4 flex flex-wrap gap-1 rounded-lg border border-n-200 bg-n-0 p-[3px]">
        {kinds.map((k) => (
          <button
            key={k.kind}
            type="button"
            onClick={() => setKind(k.kind)}
            className={`h-[32px] rounded-md px-3 text-[13px] font-semibold transition-colors ${
              kind === k.kind ? 'bg-teal-500 text-white' : 'text-n-600 hover:text-n-900'
            }`}
          >
            {k.label}
          </button>
        ))}
      </div>

      <RefTable<ComplianceOption>
        loading={isLoading}
        empty="No values in this list yet."
        rows={data}
        columns={[
          { key: 'code', header: 'Code', render: (r) => <span className="mono text-[12.5px] text-n-800">{r.code}</span> },
          {
            key: 'label',
            header: 'Label',
            render: (r) => (
              <span className={r.active ? 'text-n-800' : 'text-n-400 line-through'}>{r.label}</span>
            ),
          },
          ...(isVoltage
            ? [{
                key: 'range',
                header: 'Mains range',
                render: (r: ComplianceOption) =>
                  r.numericMin == null
                    ? <span className="text-n-400">No mains supply</span>
                    : <span className="mono text-[12.5px] tabular-nums">{r.numericMin}–{r.numericMax}V</span>,
              }]
            : []),
          { key: 'note', header: 'Note', render: (r) => <span className="text-[12.5px] text-n-500">{r.note ?? '—'}</span> },
          {
            key: 'active',
            header: 'Status',
            render: (r) => (r.active ? <span className="text-teal-700">Offered</span> : <span className="text-n-400">Retired</span>),
          },
        ]}
        onEdit={setEditing}
        onDelete={(r) => confirm(`Remove ${r.label}? Products already using it keep it.`) && del.mutate(r.id)}
      />

      {editing !== undefined && (
        <SimpleRefModal
          title={editing ? `Edit ${editing.label}` : `Add to ${kinds.find((k) => k.kind === kind)?.label ?? kind}`}
          fields={fields}
          initial={
            editing
              ? { ...editing }
              : { code: '', label: '', numericMin: '', numericMax: '', note: '', sortOrder: 999, active: true }
          }
          primaryLabel={editing ? 'Save' : 'Add'}
          onClose={() => setEditing(undefined)}
          onSubmit={async (values) => {
            const payload = {
              ...values,
              kind,
              // Empty is "no mains supply", which is a real answer and must not become 0.
              numericMin: values.numericMin === '' || values.numericMin == null ? null : Number(values.numericMin),
              numericMax: values.numericMax === '' || values.numericMax == null ? null : Number(values.numericMax),
              note: values.note || null,
            };
            if (editing) await complianceOptionsApi.update(editing.id, payload);
            else await complianceOptionsApi.create(payload);
            toast.success(editing ? 'Saved' : 'Added');
            invalidate();
            setEditing(undefined);
          }}
        />
      )}
    </div>
  );
}
