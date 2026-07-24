import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, FolderTree, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ModalShell, Select } from '@masquare/ui';
import { expenseCategoriesApi, type ExpenseCategoryNode } from '../../lib/api';

/** Indented options for the parent picker, excluding a subtree (when editing, so a
 *  category can't be reparented under itself). */
function flatten(tree: ExpenseCategoryNode[], excludeId?: string): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const walk = (nodes: ExpenseCategoryNode[]) => {
    for (const n of nodes) {
      if (n.id === excludeId) continue; // skips the node and its whole subtree
      out.push({ value: n.id, label: `${'  '.repeat(n.depth)}${n.name}` });
      walk(n.children);
    }
  };
  walk(tree);
  return out;
}

export function ExpenseCategoriesPage() {
  const qc = useQueryClient();
  const [modal, setModal] = useState<{ node?: ExpenseCategoryNode; defaultParentId?: string | null } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ExpenseCategoryNode | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const { data: tree = [], isLoading } = useQuery({ queryKey: ['expense-categories', 'tree'], queryFn: () => expenseCategoriesApi.tree() });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['expense-categories'] });

  const del = useMutation({
    mutationFn: (id: string) => expenseCategoriesApi.remove(id),
    onSuccess: () => { toast.success('Category deleted'); setConfirmDelete(null); invalidate(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not delete category'),
  });

  const toggle = (id: string) => setCollapsed((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const rows: ExpenseCategoryNode[] = [];
  const walk = (list: ExpenseCategoryNode[]) => { for (const n of list) { rows.push(n); if (!collapsed.has(n.id)) walk(n.children); } };
  walk(tree);

  const th = 'border-b border-n-200 bg-n-25 px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-n-500 whitespace-nowrap';
  const td = 'border-b border-n-100 px-4 py-2.5 text-[13px] text-n-700';

  return (
    <div className="w-full">
      <div className="mb-5 flex items-start gap-4">
        <div className="flex-1">
          <h1 className="text-[22px] font-bold tracking-tight text-n-900">Expense Categories</h1>
          <p className="mt-1 text-[13px] text-n-500">Organise expenses into a tree of categories and sub-categories.</p>
        </div>
        <button onClick={() => setModal({})} className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md bg-teal-500 px-3.5 text-[13px] font-semibold text-white hover:bg-teal-600">
          <Plus size={15} /> New category
        </button>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-n-100 px-4 py-2.5 text-[12px] text-n-500">{rows.length} categor{rows.length === 1 ? 'y' : 'ies'}</div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={`${th} text-left`}>Category</th>
                <th className={`${th} text-right`}>Expense names</th>
                <th className={`${th} text-right`}>Incl. sub-categories</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td className={td} colSpan={4}>Loading…</td></tr>}
              {!isLoading && rows.length === 0 && <tr><td className={`${td} py-10 text-center text-n-400`} colSpan={4}>No categories yet. Create your first one.</td></tr>}
              {rows.map((n) => (
                <tr key={n.id} className="group hover:bg-n-25">
                  <td className={td}>
                    <div className="flex items-center gap-1.5" style={{ paddingLeft: n.depth * 20 }}>
                      {n.children.length > 0 ? (
                        <button onClick={() => toggle(n.id)} className="grid h-5 w-5 place-items-center rounded text-n-400 hover:bg-n-100 hover:text-n-700">
                          {collapsed.has(n.id) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                        </button>
                      ) : <span className="inline-block w-5" />}
                      <FolderTree size={14} className="shrink-0 text-n-400" />
                      <span className="font-semibold text-n-800">{n.name}</span>
                    </div>
                  </td>
                  <td className={`${td} mono text-right`}>{n.definitionCount || <span className="text-n-300">—</span>}</td>
                  <td className={`${td} mono text-right`}>{n.children.length > 0 && n.rollupDefinitionCount > 0 ? n.rollupDefinitionCount : <span className="text-n-300">—</span>}</td>
                  <td className={`${td} text-right`}>
                    <div className="flex justify-end gap-1 opacity-0 transition group-hover:opacity-100">
                      <IconBtn title="Add sub-category" onClick={() => setModal({ defaultParentId: n.id })}><Plus size={14} /></IconBtn>
                      <IconBtn title="Edit" onClick={() => setModal({ node: n })}><Pencil size={14} /></IconBtn>
                      <IconBtn title="Delete" danger onClick={() => setConfirmDelete(n)}><Trash2 size={14} /></IconBtn>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <CategoryModal
          node={modal.node}
          defaultParentId={modal.defaultParentId}
          parentOptions={flatten(tree, modal.node?.id)}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); invalidate(); }}
        />
      )}
      {confirmDelete && (
        <ModalShell open title="Delete category" subtitle={confirmDelete.name} primaryLabel={del.isPending ? 'Deleting…' : 'Delete'} busy={del.isPending}
          onPrimary={() => del.mutate(confirmDelete.id)} onClose={() => setConfirmDelete(null)}>
          <p className="text-[13px] text-n-700">Delete “{confirmDelete.name}”? Categories with sub-categories or expense names filed under them can't be deleted until those are moved.</p>
        </ModalShell>
      )}
    </div>
  );
}

function CategoryModal({ node, defaultParentId, parentOptions, onClose, onSaved }: {
  node?: ExpenseCategoryNode; defaultParentId?: string | null; parentOptions: { value: string; label: string }[]; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(node?.name ?? '');
  const [parentId, setParentId] = useState<string>(node?.parentId ?? defaultParentId ?? '');
  const options = useMemo(() => [{ value: '', label: 'None (top level)' }, ...parentOptions], [parentOptions]);

  const save = useMutation({
    mutationFn: () => node
      ? expenseCategoriesApi.update(node.id, { name: name.trim(), parentId: parentId || null })
      : expenseCategoriesApi.create({ name: name.trim(), parentId: parentId || null }),
    onSuccess: () => { toast.success(node ? 'Category updated' : 'Category created'); onSaved(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not save category'),
  });

  return (
    <ModalShell open title={node ? 'Edit category' : 'New category'} primaryLabel={save.isPending ? 'Saving…' : 'Save'} busy={save.isPending}
      primaryDisabled={!name.trim()} onPrimary={() => save.mutate()} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div>
          <label className="label">Name</label>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && save.mutate()}
            placeholder="e.g. Utilities" className="input" />
        </div>
        <div>
          <label className="label">Parent category</label>
          <Select value={parentId} onChange={setParentId} options={options} />
        </div>
      </div>
    </ModalShell>
  );
}

function IconBtn({ title, onClick, danger, children }: { title: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button title={title} onClick={onClick}
      className={`grid h-7 w-7 place-items-center rounded-md border border-n-200 bg-n-0 transition hover:bg-n-50 ${danger ? 'text-danger hover:border-danger-bd' : 'text-n-500 hover:text-n-700'}`}>
      {children}
    </button>
  );
}
