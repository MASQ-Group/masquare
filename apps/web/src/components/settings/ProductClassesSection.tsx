import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { productClassesApi, type ProductClass } from '../../lib/api';
import { AddButton, RefTable, SectionHeader, SimpleRefModal, type SimpleField } from './shared';

export function ProductClassesSection() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<ProductClass | null | undefined>(undefined);
  const { data = [], isLoading } = useQuery({ queryKey: ['product-classes'], queryFn: () => productClassesApi.list() });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['product-classes'] });
  const del = useMutation({
    mutationFn: (id: string) => productClassesApi.remove(id),
    onSuccess: () => { toast.success('Removed'); invalidate(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not remove product class'),
  });

  const fields: SimpleField[] = [
    { key: 'name', label: 'Name', required: true, placeholder: 'Equipment' },
    { key: 'sortOrder', label: 'Sort order', type: 'number', step: '1', hint: 'Controls the order in dropdowns.' },
    { key: 'isDefault', label: 'Default class for new products', type: 'checkbox' },
  ];

  return (
    <div>
      <SectionHeader
        title="Product Classes"
        description="Top-level classification (Equipment / Service) that governs whether a product physically ships."
      >
        <AddButton label="Add product class" onClick={() => setEditing(null)} />
      </SectionHeader>
      <RefTable<ProductClass>
        loading={isLoading}
        empty="No product classes yet. Add your first class."
        rows={data}
        columns={[
          {
            key: 'name',
            header: 'Name',
            render: (r) => (
              <span className="font-medium text-n-800">
                {r.name}
                {r.isDefault && <span className="ml-2 rounded-pill bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-700">default</span>}
              </span>
            ),
          },
        ]}
        onEdit={setEditing}
        onDelete={(r) => confirm(`Remove product class “${r.name}”?`) && del.mutate(r.id)}
      />
      {editing !== undefined && (
        <SimpleRefModal
          title={editing ? 'Edit product class' : 'New product class'}
          fields={fields}
          initial={{
            name: editing?.name ?? '',
            sortOrder: editing?.sortOrder ?? data.length,
            isDefault: editing?.isDefault ?? false,
          }}
          primaryLabel={editing ? 'Save changes' : 'Create product class'}
          onClose={() => setEditing(undefined)}
          onSubmit={async (v) => {
            const body = { name: String(v.name).trim(), sortOrder: Number(v.sortOrder) || 0, isDefault: !!v.isDefault };
            try {
              if (editing) await productClassesApi.update(editing.id, body as any);
              else await productClassesApi.create(body as any);
              toast.success('Saved');
              setEditing(undefined);
              invalidate();
            } catch (e: any) {
              toast.error(e?.response?.data?.message ?? 'Could not save product class');
            }
          }}
        />
      )}
    </div>
  );
}
