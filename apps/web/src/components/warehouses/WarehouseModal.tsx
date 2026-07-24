import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { ModalShell, Select } from '@masquare/ui';
import { warehousesApi, type Warehouse, type WarehouseNode } from '../../lib/api';

interface Props {
  warehouse?: Warehouse;
  /** Pre-selected parent when adding a sub-warehouse from a row action. */
  defaultParentId?: string | null;
  onClose: () => void;
  onSaved: () => void;
}

/** Flatten the tree into indented picker options, minus any branch that would
 *  create a loop (you cannot re-parent a warehouse under its own descendant). */
function parentOptions(nodes: WarehouseNode[], excludeId?: string) {
  const out: { value: string; label: string }[] = [];
  const walk = (list: WarehouseNode[]) => {
    for (const n of list) {
      if (n.id === excludeId) continue; // skips the whole subtree below it too
      out.push({ value: n.id, label: `${'  '.repeat(n.depth)}${n.name}` });
      walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

export function WarehouseModal({ warehouse, defaultParentId, onClose, onSaved }: Props) {
  const editing = !!warehouse;
  const { data: tree = [] } = useQuery({ queryKey: ['warehouses', 'tree', true], queryFn: () => warehousesApi.tree({ includeInactive: true }) });

  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const touch = () => setDirty(true);

  const [name, setName] = useState(warehouse?.name ?? '');
  const [type, setType] = useState<'physical' | 'virtual'>(warehouse?.type ?? 'physical');
  const [parentId, setParentId] = useState<string | null>(warehouse?.parentWarehouseId ?? defaultParentId ?? null);
  const [includeInInventory, setIncludeInInventory] = useState(warehouse?.includeInInventory ?? true);
  const [isActive, setIsActive] = useState(warehouse?.isActive ?? true);
  const [notes, setNotes] = useState(warehouse?.notes ?? '');

  const save = async () => {
    if (!name.trim()) { toast.error('Name is required'); return; }
    setBusy(true);
    try {
      const body = {
        name: name.trim(),
        type,
        parentWarehouseId: parentId,
        includeInInventory,
        isActive,
        notes: notes.trim() || null,
      };
      if (editing) { await warehousesApi.update(warehouse!.id, body); toast.success('Warehouse updated'); }
      else { await warehousesApi.create(body); toast.success('Warehouse created'); }
      onSaved();
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      open
      title={editing ? 'Edit warehouse' : 'New warehouse'}
      subtitle={editing ? warehouse!.name : 'A place stock can be held — a real location or a virtual holding area.'}
      dirty={dirty}
      primaryLabel={editing ? 'Save warehouse' : 'Create warehouse'}
      onPrimary={save}
      busy={busy}
      onClose={onClose}
    >
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 items-start gap-4 max-[560px]:grid-cols-1">
          <div className="col-span-2 max-[560px]:col-span-1">
            <label className="label">Name</label>
            <input className="input" value={name} onChange={(e) => { setName(e.target.value); touch(); }} placeholder="e.g. Main Warehouse" autoFocus />
          </div>
          <div>
            <label className="label">Type</label>
            <Select
              value={type}
              onChange={(v) => { setType(v as any); touch(); }}
              options={[
                { value: 'physical', label: 'Physical — a real location' },
                { value: 'virtual', label: 'Virtual — a holding area' },
              ]}
            />
          </div>
          <div>
            <label className="label">Parent warehouse <span className="font-normal text-n-400">(optional)</span></label>
            <Select
              value={parentId ?? ''}
              onChange={(v) => { setParentId(v || null); touch(); }}
              placeholder="— none (top level)"
              options={parentOptions(tree, warehouse?.id)}
            />
          </div>
        </div>

        <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-n-200 bg-n-25 px-3 py-2.5">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-[var(--teal-500)]"
            checked={includeInInventory}
            onChange={(e) => { setIncludeInInventory(e.target.checked); touch(); }}
          />
          <span className="text-[13px] text-n-700">
            Count this stock as <strong>available to sell</strong>
            <span className="block text-[11.5px] text-n-400">
              Leave unticked for stock you hold but cannot sell — damaged, quarantined or in transit. It stays visible and tracked, but never counts toward availability.
            </span>
          </span>
        </label>

        {editing && (
          <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-n-200 bg-n-25 px-3 py-2.5">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-[var(--teal-500)]"
              checked={isActive}
              onChange={(e) => { setIsActive(e.target.checked); touch(); }}
            />
            <span className="text-[13px] text-n-700">
              Active
              <span className="block text-[11.5px] text-n-400">Inactive warehouses keep their history but cannot receive stock and are hidden from pickers.</span>
            </span>
          </label>
        )}

        <div>
          <label className="label">Notes <span className="font-normal text-n-400">(optional)</span></label>
          <input className="input" value={notes} onChange={(e) => { setNotes(e.target.value); touch(); }} placeholder="What is kept here" />
        </div>

        {editing && warehouse!.includeInInventory && !includeInInventory && (
          <p className="flex items-start gap-2 rounded-md border border-warning-bd bg-warning-bg px-3 py-2 text-[12.5px] text-warning">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            Stock held here will stop counting as available as soon as you save.
          </p>
        )}
      </div>
    </ModalShell>
  );
}
