import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  brandsApi, productTypesApi, fulfilmentTypesApi,
  type Brand, type ProductType, type FulfilmentType,
} from '../../lib/api';
import { AddButton, ImportButton, RefTable, SectionHeader, SimpleRefModal, type SimpleField } from './shared';

// --- Brands ---------------------------------------------------------------
export function BrandsSection() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Brand | null | undefined>(undefined);
  const { data = [], isLoading } = useQuery({ queryKey: ['brands'], queryFn: () => brandsApi.list() });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['brands'] });
  const del = useMutation({ mutationFn: (id: string) => brandsApi.remove(id), onSuccess: () => { toast.success('Removed'); invalidate(); } });

  const fields: SimpleField[] = [
    { key: 'name', label: 'Name', required: true },
    { key: 'website', label: 'Website' },

    { key: 'manufacturerName', label: 'Legal name', section: 'Manufacturer',
      hint: 'Used for GPSR. No channel requires it of us today; EU listings would.' },
    { key: 'manufacturerAddress', label: 'Address' },
    { key: 'manufacturerEmail', label: 'Email' },
    { key: 'manufacturerPhone', label: 'Phone' },
    { key: 'manufacturerContactUrl', label: 'Contact URL' },

    { key: 'euRpName', label: 'Legal name', section: 'EU responsible person',
      hint: 'Required by GPSR only when the manufacturer sits outside the EU.' },
    { key: 'euRpAddress', label: 'Address' },
    { key: 'euRpEmail', label: 'Email' },
    { key: 'euRpPhone', label: 'Phone' },
    { key: 'euRpContactUrl', label: 'Contact URL' },
  ];

  return (
    <div>
      <SectionHeader title="Brands / Manufacturers" description="Brand and manufacturer names used across products.">
        <ImportButton title="Import Brands" fields={[{ key: 'name', label: 'Name', required: true }, { key: 'website', label: 'Website' }]}
          onCommit={async (rows) => { for (const r of rows) await brandsApi.create(r as any); invalidate(); }} />
        <AddButton label="Add brand" onClick={() => setEditing(null)} />
      </SectionHeader>
      <RefTable<Brand>
        loading={isLoading}
        empty="No brands yet. Add your first brand."
        rows={data}
        columns={[
          { key: 'name', header: 'Name', render: (r) => <span className="font-medium text-n-800">{r.name}</span> },
          { key: 'website', header: 'Website', render: (r) => r.website ?? '—' },
          {
            key: 'gpsr',
            header: 'GPSR contacts',
            render: (r) =>
              r.manufacturerName
                ? <span className="text-teal-700">{r.euRpName ? 'Manufacturer + EU RP' : 'Manufacturer'}</span>
                : <span className="text-n-400">Not set</span>,
          },
        ]}
        onEdit={setEditing}
        onDelete={(r) => confirm(`Remove ${r.name}?`) && del.mutate(r.id)}
      />
      {editing !== undefined && (
        <SimpleRefModal
          title={editing ? 'Edit brand' : 'New brand'}
          fields={fields}
          initial={{ name: editing?.name ?? '', website: editing?.website ?? '' }}
          primaryLabel={editing ? 'Save changes' : 'Create brand'}
          onClose={() => setEditing(undefined)}
          onSubmit={async (v) => {
            if (editing) await brandsApi.update(editing.id, v); else await brandsApi.create(v);
            toast.success('Saved'); setEditing(undefined); invalidate();
          }}
        />
      )}
    </div>
  );
}

// --- Product types --------------------------------------------------------
export function ProductTypesSection() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<ProductType | null | undefined>(undefined);
  const { data = [], isLoading } = useQuery({ queryKey: ['product-types'], queryFn: () => productTypesApi.list() });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['product-types'] });
  const del = useMutation({ mutationFn: (id: string) => productTypesApi.remove(id), onSuccess: () => { toast.success('Removed'); invalidate(); } });

  return (
    <div>
      <SectionHeader title="Product Types" description="Types selected on a product (e.g. Hair Straightener, Shaver).">
        <ImportButton title="Import Product Types" fields={[{ key: 'name', label: 'Name', required: true }]}
          onCommit={async (rows) => { for (const r of rows) await productTypesApi.create(r as any); invalidate(); }} />
        <AddButton label="Add type" onClick={() => setEditing(null)} />
      </SectionHeader>
      <RefTable<ProductType>
        loading={isLoading}
        empty="No product types yet."
        rows={data}
        columns={[{ key: 'name', header: 'Name', render: (r) => <span className="font-medium text-n-800">{r.name}</span> }]}
        onEdit={setEditing}
        onDelete={(r) => confirm(`Remove ${r.name}?`) && del.mutate(r.id)}
      />
      {editing !== undefined && (
        <SimpleRefModal
          title={editing ? 'Edit product type' : 'New product type'}
          fields={[{ key: 'name', label: 'Name', required: true }]}
          initial={{ name: editing?.name ?? '' }}
          primaryLabel={editing ? 'Save changes' : 'Create type'}
          onClose={() => setEditing(undefined)}
          onSubmit={async (v) => {
            if (editing) await productTypesApi.update(editing.id, v); else await productTypesApi.create(v);
            toast.success('Saved'); setEditing(undefined); invalidate();
          }}
        />
      )}
    </div>
  );
}

// --- Fulfilment types -----------------------------------------------------
export function FulfilmentTypesSection() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<FulfilmentType | null | undefined>(undefined);
  const { data = [], isLoading } = useQuery({ queryKey: ['fulfilment-types'], queryFn: () => fulfilmentTypesApi.list() });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['fulfilment-types'] });
  const del = useMutation({ mutationFn: (id: string) => fulfilmentTypesApi.remove(id), onSuccess: () => { toast.success('Removed'); invalidate(); } });

  const fields: SimpleField[] = [
    { key: 'name', label: 'Name', required: true, placeholder: 'Fulfilled by Amazon' },
    { key: 'code', label: 'Code', mono: true, placeholder: 'FBA' },
    { key: 'active', label: 'Available for selection', type: 'checkbox' },
  ];

  return (
    <div>
      <SectionHeader title="Fulfilment Types" description="Fulfilment methods — a managed list, not hard-coded. Seeded with FBA and FBM.">
        <AddButton label="Add fulfilment type" onClick={() => setEditing(null)} />
      </SectionHeader>
      <RefTable<FulfilmentType>
        loading={isLoading}
        empty="No fulfilment types yet."
        rows={data}
        columns={[
          { key: 'name', header: 'Name', render: (r) => <span className="font-medium text-n-800">{r.name}</span> },
          { key: 'code', header: 'Code', className: 'mono', render: (r) => r.code ?? '—' },
          { key: 'active', header: 'Status', render: (r) => r.active
            ? <span className="tag border border-success-bd bg-success-bg text-success">Active</span>
            : <span className="tag border border-n-200 bg-n-100 text-n-500">Inactive</span> },
        ]}
        onEdit={setEditing}
        onDelete={(r) => confirm(`Remove ${r.name}?`) && del.mutate(r.id)}
      />
      {editing !== undefined && (
        <SimpleRefModal
          title={editing ? 'Edit fulfilment type' : 'New fulfilment type'}
          fields={fields}
          initial={{ name: editing?.name ?? '', code: editing?.code ?? '', active: editing?.active ?? true }}
          primaryLabel={editing ? 'Save changes' : 'Create fulfilment type'}
          onClose={() => setEditing(undefined)}
          onSubmit={async (v) => {
            if (editing) await fulfilmentTypesApi.update(editing.id, v); else await fulfilmentTypesApi.create(v);
            toast.success('Saved'); setEditing(undefined); invalidate();
          }}
        />
      )}
    </div>
  );
}
