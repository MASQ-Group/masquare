import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { vatClassesApi, type VatClass } from '../../lib/api';
import { AddButton, RefTable, SectionHeader, SimpleRefModal, type SimpleField } from './shared';

const TREATMENTS = [
  { value: 'standard', label: 'Standard' },
  { value: 'reduced', label: 'Reduced' },
  { value: 'zero', label: 'Zero-rated' },
  { value: 'exempt', label: 'Exempt' },
];
const TREATMENT_LABEL: Record<string, string> = Object.fromEntries(TREATMENTS.map((t) => [t.value, t.label]));

export function VatClassesSection() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<VatClass | null | undefined>(undefined);
  const { data = [], isLoading } = useQuery({ queryKey: ['vat-classes'], queryFn: () => vatClassesApi.list() });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['vat-classes'] });
  const del = useMutation({
    mutationFn: (id: string) => vatClassesApi.remove(id),
    onSuccess: () => { toast.success('Removed'); invalidate(); },
    // The server refuses to delete the default class or one still used by products.
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not remove VAT class'),
  });

  const fields: SimpleField[] = [
    { key: 'name', label: 'Name', required: true, placeholder: 'Standard' },
    { key: 'ratePct', label: 'Rate', required: true, type: 'number', step: '0.01', min: 0, max: 100, suffix: '%' },
    {
      key: 'taxTreatment', label: 'Tax treatment', type: 'select', options: TREATMENTS,
      hint: 'Zero-rated and Exempt both charge 0%, but are reported differently on a VAT return.',
    },
    { key: 'sortOrder', label: 'Sort order', type: 'number', step: '1', hint: 'Controls the order in dropdowns.' },
    { key: 'isDefault', label: 'Default class for new products', type: 'checkbox' },
  ];

  return (
    <div>
      <SectionHeader
        title="VAT Classes"
        description="VAT rates applied to products, and to local sales lines when a sale is registered."
      >
        <AddButton label="Add VAT class" onClick={() => setEditing(null)} />
      </SectionHeader>
      <RefTable<VatClass>
        loading={isLoading}
        empty="No VAT classes yet. Add your first class."
        rows={data}
        columns={[
          {
            key: 'name',
            header: 'Name',
            render: (r) => (
              <span className="font-medium text-n-800">
                {r.name}
                {r.isDefault && (
                  <span className="ml-2 rounded-pill bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-700">default</span>
                )}
              </span>
            ),
          },
          { key: 'ratePct', header: 'Rate', render: (r) => `${r.ratePct}%` },
          { key: 'taxTreatment', header: 'Treatment', render: (r) => TREATMENT_LABEL[r.taxTreatment] ?? r.taxTreatment },
        ]}
        onEdit={setEditing}
        onDelete={(r) => confirm(`Remove VAT class “${r.name}”?`) && del.mutate(r.id)}
      />
      {editing !== undefined && (
        <SimpleRefModal
          title={editing ? 'Edit VAT class' : 'New VAT class'}
          fields={fields}
          initial={{
            name: editing?.name ?? '',
            ratePct: editing?.ratePct ?? 0,
            taxTreatment: editing?.taxTreatment ?? 'standard',
            sortOrder: editing?.sortOrder ?? data.length,
            isDefault: editing?.isDefault ?? false,
          }}
          primaryLabel={editing ? 'Save changes' : 'Create VAT class'}
          onClose={() => setEditing(undefined)}
          onSubmit={async (v) => {
            const body = {
              name: String(v.name).trim(),
              ratePct: Number(v.ratePct),
              taxTreatment: v.taxTreatment,
              sortOrder: Number(v.sortOrder) || 0,
              isDefault: !!v.isDefault,
            };
            try {
              if (editing) await vatClassesApi.update(editing.id, body as any);
              else await vatClassesApi.create(body as any);
              toast.success('Saved');
              setEditing(undefined);
              invalidate();
            } catch (e: any) {
              toast.error(e?.response?.data?.message ?? 'Could not save VAT class');
            }
          }}
        />
      )}
    </div>
  );
}
