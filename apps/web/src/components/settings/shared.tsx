import { useState } from 'react';
import { Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { ModalShell, BulkImport, type ImportField } from '@masquare/ui';

export function SectionHeader({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start gap-4">
      <div className="flex-1">
        <h2 className="text-[18px] font-semibold text-n-900">{title}</h2>
        <p className="mt-0.5 text-[13px] text-n-500">{description}</p>
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

export interface Column<T> {
  key: string;
  header: string;
  className?: string;
  render: (row: T) => React.ReactNode;
}

export interface RefTableSelection {
  selected: Set<string>;
  toggleOne: (id: string) => void;
  toggleAll: () => void;
  allSelected: boolean;
}

export function RefTable<T extends { id: string }>({
  columns,
  rows,
  loading,
  empty,
  onEdit,
  onDelete,
  selection,
}: {
  columns: Column<T>[];
  rows: T[];
  loading?: boolean;
  empty: string;
  onEdit: (row: T) => void;
  onDelete: (row: T) => void;
  selection?: RefTableSelection;
}) {
  const span = columns.length + 1 + (selection ? 1 : 0);
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse">
          <thead>
            <tr>
              {selection && (
                <th className="border-b border-n-200 bg-n-25 px-3 py-3">
                  <input type="checkbox" className="h-4 w-4 accent-[var(--teal-500)]" checked={selection.allSelected} onChange={selection.toggleAll} title="Select all" />
                </th>
              )}
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={`border-b border-n-200 bg-n-25 px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-n-500 ${c.className ?? ''}`}
                >
                  {c.header}
                </th>
              ))}
              <th className="border-b border-n-200 bg-n-25 px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={span} className="px-4 py-8 text-center text-[13px] text-n-500">Loading…</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={span} className="px-4 py-10 text-center text-[13px] text-n-500">{empty}</td></tr>
            )}
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-teal-50">
                {selection && (
                  <td className="border-b border-n-100 px-3 py-3">
                    <input type="checkbox" className="h-4 w-4 accent-[var(--teal-500)]" checked={selection.selected.has(row.id)} onChange={() => selection.toggleOne(row.id)} />
                  </td>
                )}
                {columns.map((c) => (
                  <td key={c.key} className={`border-b border-n-100 px-4 py-3 text-[13.5px] text-n-700 ${c.className ?? ''}`}>
                    {c.render(row)}
                  </td>
                ))}
                <td className="border-b border-n-100 px-4 py-3">
                  <div className="flex justify-end gap-1">
                    <button className="grid h-8 w-8 place-items-center rounded-md text-n-500 hover:bg-n-100 hover:text-n-800" onClick={() => onEdit(row)} title="Edit">
                      <Pencil size={15} />
                    </button>
                    <button className="grid h-8 w-8 place-items-center rounded-md text-n-500 hover:bg-danger-bg hover:text-danger" onClick={() => onDelete(row)} title="Remove">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="btn btn-primary" onClick={onClick}>
      <Plus size={17} /> {label}
    </button>
  );
}

/** Import button that opens the shared BulkImport framework in a modal. */
export function ImportButton({
  fields,
  onCommit,
  title,
}: {
  fields: ImportField[];
  onCommit: (rows: Record<string, string>[]) => Promise<void>;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn btn-ghost" onClick={() => setOpen(true)}>
        <Upload size={16} /> Import
      </button>
      {open && (
        <ModalShell
          open
          title={title}
          primaryLabel="Close"
          onPrimary={() => setOpen(false)}
          onClose={() => setOpen(false)}
        >
          <BulkImport
            fields={fields}
            onCommit={async (rows) => {
              await onCommit(rows);
              toast.success(`Imported ${rows.length} rows`);
            }}
            onClose={() => setOpen(false)}
          />
        </ModalShell>
      )}
    </>
  );
}

/** Config-driven create/edit modal for simple name-based reference lists. */
export interface SimpleField {
  key: string;
  label: string;
  type?: 'text' | 'checkbox';
  mono?: boolean;
  required?: boolean;
  placeholder?: string;
}

export function SimpleRefModal({
  title,
  fields,
  initial,
  primaryLabel,
  onSubmit,
  onClose,
}: {
  title: string;
  fields: SimpleField[];
  initial: Record<string, any>;
  primaryLabel: string;
  onSubmit: (values: Record<string, any>) => Promise<void>;
  onClose: () => void;
}) {
  const [values, setValues] = useState<Record<string, any>>(initial);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  const set = (key: string, v: any) => {
    setValues((prev) => ({ ...prev, [key]: v }));
    setDirty(true);
  };

  const canSave = fields.every((f) => !f.required || String(values[f.key] ?? '').trim().length > 0);

  const submit = async () => {
    if (!canSave) {
      toast.error('Please fill the required fields');
      return;
    }
    setBusy(true);
    try {
      await onSubmit(values);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      open
      title={title}
      dirty={dirty}
      primaryLabel={primaryLabel}
      onPrimary={submit}
      primaryDisabled={!canSave}
      busy={busy}
      onClose={onClose}
    >
      <div className="flex flex-col gap-4">
        {fields.map((f) =>
          f.type === 'checkbox' ? (
            <label key={f.key} className="flex cursor-pointer items-center gap-2.5">
              <input type="checkbox" className="h-4 w-4 accent-[var(--teal-500)]" checked={!!values[f.key]} onChange={(e) => set(f.key, e.target.checked)} />
              <span className="text-[13.5px] text-n-700">{f.label}</span>
            </label>
          ) : (
            <div key={f.key}>
              <label className="label">{f.label}{f.required && ' *'}</label>
              <input
                className={`input ${f.mono ? 'mono' : ''}`}
                value={values[f.key] ?? ''}
                placeholder={f.placeholder}
                onChange={(e) => set(f.key, e.target.value)}
              />
            </div>
          ),
        )}
      </div>
    </ModalShell>
  );
}
