import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, GripVertical, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ModalShell, SmartReferenceInput, type ReferenceOption } from '@masquare/ui';
import { categoriesApi, type Category } from '../../lib/api';
import { AddButton, SectionHeader } from './shared';

interface TreeNode extends Category {
  children: TreeNode[];
}

function buildTree(flat: Category[]): TreeNode[] {
  const byId = new Map<string, TreeNode>(flat.map((c) => [c.id, { ...c, children: [] }]));
  const roots: TreeNode[] = [];
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) byId.get(node.parentId)!.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export function CategoriesSection() {
  const qc = useQueryClient();
  const { data = [], isLoading } = useQuery({ queryKey: ['categories'], queryFn: categoriesApi.list });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['categories'] });
  const [modal, setModal] = useState<{ mode: 'create' | 'edit'; category?: Category; parentId?: string | null } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  const tree = useMemo(() => buildTree(data), [data]);

  const move = useMutation({
    mutationFn: ({ id, parentId }: { id: string; parentId: string | null }) => categoriesApi.move(id, { parentId }),
    onSuccess: () => { toast.success('Category moved'); invalidate(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Move failed'),
  });
  const del = useMutation({
    mutationFn: (id: string) => categoriesApi.remove(id),
    onSuccess: () => { toast.success('Category removed'); invalidate(); },
  });

  const onDrop = (targetId: string | null) => {
    if (dragId && dragId !== targetId) move.mutate({ id: dragId, parentId: targetId });
    setDragId(null);
  };

  return (
    <div>
      <SectionHeader title="Categories" description="A multilevel category tree. Drag a category onto another to re-parent it.">
        <AddButton label="Add category" onClick={() => setModal({ mode: 'create', parentId: null })} />
      </SectionHeader>

      <div className="card p-2">
        {isLoading && <div className="px-3 py-8 text-center text-[13px] text-n-500">Loading…</div>}
        {!isLoading && tree.length === 0 && (
          <div className="px-3 py-10 text-center text-[13px] text-n-500">No categories yet. Add your first category.</div>
        )}
        {tree.map((node) => (
          <TreeRow
            key={node.id}
            node={node}
            depth={0}
            dragId={dragId}
            setDragId={setDragId}
            onDrop={onDrop}
            onAddChild={(parentId) => setModal({ mode: 'create', parentId })}
            onEdit={(category) => setModal({ mode: 'edit', category })}
            onDelete={(c) => confirm(`Remove ${c.name}? Its children move up one level.`) && del.mutate(c.id)}
          />
        ))}
        {/* Top-level drop zone */}
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => onDrop(null)}
          className="mt-1 rounded-md border border-dashed border-n-200 px-3 py-2 text-center text-[12px] text-n-400"
        >
          Drop here to move to the top level
        </div>
      </div>

      {modal && (
        <CategoryModal
          mode={modal.mode}
          category={modal.category}
          parentId={modal.parentId ?? null}
          categories={data}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); invalidate(); }}
        />
      )}
    </div>
  );
}

function TreeRow({
  node, depth, dragId, setDragId, onDrop, onAddChild, onEdit, onDelete,
}: {
  node: TreeNode;
  depth: number;
  dragId: string | null;
  setDragId: (id: string | null) => void;
  onDrop: (targetId: string) => void;
  onAddChild: (parentId: string) => void;
  onEdit: (c: Category) => void;
  onDelete: (c: Category) => void;
}) {
  const [open, setOpen] = useState(true);
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <div
        draggable
        onDragStart={() => setDragId(node.id)}
        onDragEnd={() => setDragId(null)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.stopPropagation(); onDrop(node.id); }}
        className={`group flex items-center gap-1.5 rounded-md py-1.5 pr-2 hover:bg-teal-50 ${dragId === node.id ? 'opacity-50' : ''}`}
        style={{ paddingLeft: depth * 20 + 4 }}
      >
        <GripVertical size={14} className="cursor-grab text-n-300" />
        <button className="grid h-5 w-5 place-items-center text-n-500" onClick={() => setOpen((v) => !v)} style={{ visibility: hasChildren ? 'visible' : 'hidden' }}>
          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </button>
        <span className="flex-1 text-[13.5px] text-n-800">{node.name}</span>
        <span className="mono mr-1 text-[11px] text-n-400">L{depth + 1}</span>
        <div className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <button className="grid h-7 w-7 place-items-center rounded text-n-500 hover:bg-n-100 hover:text-n-800" title="Add child" onClick={() => onAddChild(node.id)}><Plus size={14} /></button>
          <button className="grid h-7 w-7 place-items-center rounded text-n-500 hover:bg-n-100 hover:text-n-800" title="Rename" onClick={() => onEdit(node)}><Pencil size={13} /></button>
          <button className="grid h-7 w-7 place-items-center rounded text-n-500 hover:bg-danger-bg hover:text-danger" title="Remove" onClick={() => onDelete(node)}><Trash2 size={13} /></button>
        </div>
      </div>
      {open && node.children.map((child) => (
        <TreeRow key={child.id} node={child} depth={depth + 1} dragId={dragId} setDragId={setDragId} onDrop={onDrop} onAddChild={onAddChild} onEdit={onEdit} onDelete={onDelete} />
      ))}
    </div>
  );
}

function CategoryModal({
  mode, category, parentId, categories, onClose, onSaved,
}: {
  mode: 'create' | 'edit';
  category?: Category;
  parentId: string | null;
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(category?.name ?? '');
  const [selectedParent, setSelectedParent] = useState<ReferenceOption | null>(() => {
    const p = categories.find((c) => c.id === parentId);
    return p ? { id: p.id, label: p.name } : null;
  });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const canSave = name.trim().length > 0;

  const fetchSuggestions = async (q: string): Promise<ReferenceOption[]> =>
    categories
      .filter((c) => c.id !== category?.id && (!q || c.name.toLowerCase().includes(q.toLowerCase())))
      .slice(0, 20)
      .map((c) => ({ id: c.id, label: c.name }));

  const save = async () => {
    if (!canSave) { toast.error('Name is required'); return; }
    setBusy(true);
    try {
      if (mode === 'edit' && category) {
        await categoriesApi.update(category.id, { name });
      } else {
        await categoriesApi.create({ name, parentId: selectedParent?.id ?? null });
      }
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
      open title={mode === 'edit' ? 'Rename category' : 'New category'} dirty={dirty}
      primaryLabel={mode === 'edit' ? 'Save changes' : 'Create category'} onPrimary={save} primaryDisabled={!canSave} busy={busy} onClose={onClose}
    >
      <div className="flex flex-col gap-4">
        <div>
          <label className="label">Name *</label>
          <input className="input" value={name} onChange={(e) => { setName(e.target.value); setDirty(true); }} />
        </div>
        {mode === 'create' && (
          <div>
            <label className="label">Parent category</label>
            <SmartReferenceInput
              value={selectedParent}
              placeholder="Top level (no parent)"
              fetchSuggestions={fetchSuggestions}
              onSelect={(o) => { setSelectedParent(o); setDirty(true); }}
            />
            <p className="mt-1.5 text-[12px] text-n-400">No parent = Level 1. Levels are derived from depth.</p>
          </div>
        )}
      </div>
    </ModalShell>
  );
}
