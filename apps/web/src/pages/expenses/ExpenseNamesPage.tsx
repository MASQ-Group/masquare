import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ModalShell, Select } from '@masquare/ui';
import { expenseCategoriesApi, expenseDefinitionsApi, type ExpenseCategoryNode, type ExpenseDefinition, type ExpenseOccurrence } from '../../lib/api';
import { PageHeader } from '../../components/common/PageHeader';
import { usePersistentState } from '../../lib/usePersistentState';

const OCCURRENCE_LABEL: Record<ExpenseOccurrence, string> = { monthly: 'Monthly', annual: 'Annual', once_off: 'Once-off' };
const OCCURRENCE_TONE: Record<ExpenseOccurrence, string> = {
  monthly: 'border-teal-100 bg-teal-50 text-teal-700',
  annual: 'border-info-bd bg-info-bg text-info',
  once_off: 'border-n-200 bg-n-50 text-n-500',
};

function flattenCats(tree: ExpenseCategoryNode[]): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const walk = (nodes: ExpenseCategoryNode[]) => { for (const n of nodes) { out.push({ value: n.id, label: `${'  '.repeat(n.depth)}${n.name}` }); walk(n.children); } };
  walk(tree);
  return out;
}

export function ExpenseNamesPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [showInactive, setShowInactive] = usePersistentState('expenseNames.showInactive', false);
  const [modal, setModal] = useState<{ def?: ExpenseDefinition } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ExpenseDefinition | null>(null);

  const { data: defs = [], isLoading } = useQuery({ queryKey: ['expense-definitions', showInactive], queryFn: () => expenseDefinitionsApi.list({ includeInactive: showInactive }) });
  const { data: catTree = [] } = useQuery({ queryKey: ['expense-categories', 'tree'], queryFn: () => expenseCategoriesApi.tree() });
  const catOptions = useMemo(() => flattenCats(catTree), [catTree]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['expense-definitions'] });

  const del = useMutation({
    mutationFn: (id: string) => expenseDefinitionsApi.remove(id),
    onSuccess: (res) => { toast.success(res.deactivated ? 'Expense name deactivated — it is used by registered expenses' : 'Expense name deleted'); setConfirmDelete(null); invalidate(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not remove expense name'),
  });

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return defs.filter((d) =>
      (!categoryId || d.categoryId === categoryId) &&
      (!term || d.name.toLowerCase().includes(term) || d.code.toLowerCase().includes(term)),
    );
  }, [defs, q, categoryId]);

  const th = 'border-b border-n-200 bg-n-25 px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-n-500 whitespace-nowrap';
  const td = 'border-b border-n-100 px-4 py-2.5 text-[13px] text-n-700';

  return (
    <div className="w-full">
      <PageHeader
        module="Expenses"
        title="Expense Names"
        info="The reusable expenses (Salary, Office Cleaning…) you pick from when registering."
        primary={<button onClick={() => setModal({})} className="hbtn-primary"><Plus size={15} /> New expense name</button>}
        toolbar={
          <>
            <div className="flex h-8 min-w-[220px] max-w-[320px] flex-1 items-center gap-2 rounded-lg border border-n-200 bg-n-0 px-3">
              <Search size={15} className="text-n-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or ID…" className="flex-1 bg-transparent text-[13px] text-n-900 outline-none placeholder:text-n-400" />
            </div>
            <Select dense className="w-56" value={categoryId} onChange={setCategoryId} options={[{ value: '', label: 'All categories' }, ...catOptions]} />
            <label className="ml-auto flex cursor-pointer items-center gap-2 text-[12.5px] text-n-600">
              <input type="checkbox" className="h-3.5 w-3.5 accent-[var(--teal-500)]" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show inactive
            </label>
          </>
        }
      />

      <div className="card overflow-hidden">
        <div className="border-b border-n-100 px-4 py-2.5 text-[12px] text-n-500">{rows.length} expense name{rows.length === 1 ? '' : 's'}</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse">
            <thead>
              <tr>
                <th className={`${th} text-left`}>ID</th>
                <th className={`${th} text-left`}>Name</th>
                <th className={`${th} text-left`}>Category</th>
                <th className={`${th} text-left`}>Default occurrence</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td className={td} colSpan={5}>Loading…</td></tr>}
              {!isLoading && rows.length === 0 && <tr><td className={`${td} py-10 text-center text-n-400`} colSpan={5}>No expense names{q || categoryId ? ' match' : ' yet'}.</td></tr>}
              {rows.map((d) => (
                <tr key={d.id} className={`group hover:bg-n-25 ${d.isActive ? '' : 'opacity-55'}`}>
                  <td className={`${td} code text-n-500`}>{d.code}</td>
                  <td className={td}>
                    <span className="font-semibold text-n-800">{d.name}</span>
                    {!d.isActive && <span className="tag ml-2">Inactive</span>}
                  </td>
                  <td className={td}>{d.categoryName ?? <span className="text-n-300">—</span>}</td>
                  <td className={td}>
                    {d.defaultOccurrence
                      ? <span className={`tag border ${OCCURRENCE_TONE[d.defaultOccurrence]}`}>{OCCURRENCE_LABEL[d.defaultOccurrence]}</span>
                      : <span className="text-n-300">—</span>}
                  </td>
                  <td className={`${td} text-right`}>
                    <div className="flex justify-end gap-1 opacity-0 transition group-hover:opacity-100">
                      <IconBtn title="Edit" onClick={() => setModal({ def: d })}><Pencil size={14} /></IconBtn>
                      <IconBtn title="Delete" danger onClick={() => setConfirmDelete(d)}><Trash2 size={14} /></IconBtn>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modal && <DefinitionModal def={modal.def} catOptions={catOptions} onClose={() => setModal(null)} onSaved={() => { setModal(null); invalidate(); }} />}
      {confirmDelete && (
        <ModalShell open title="Delete expense name" subtitle={confirmDelete.name} primaryLabel={del.isPending ? 'Removing…' : 'Delete'} busy={del.isPending}
          onPrimary={() => del.mutate(confirmDelete.id)} onClose={() => setConfirmDelete(null)}>
          <p className="text-[13px] text-n-700">Delete “{confirmDelete.name}”? If it's already used by a registered expense it's deactivated instead, so past records stay intact.</p>
        </ModalShell>
      )}
    </div>
  );
}

function DefinitionModal({ def, catOptions, onClose, onSaved }: {
  def?: ExpenseDefinition; catOptions: { value: string; label: string }[]; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(def?.name ?? '');
  const [categoryId, setCategoryId] = useState(def?.categoryId ?? '');
  const [occurrence, setOccurrence] = useState<string>(def?.defaultOccurrence ?? '');

  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), categoryId: categoryId || null, defaultOccurrence: (occurrence || null) as ExpenseOccurrence | null };
      return def ? expenseDefinitionsApi.update(def.id, body) : expenseDefinitionsApi.create(body);
    },
    onSuccess: () => { toast.success(def ? 'Expense name updated' : 'Expense name created'); onSaved(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not save'),
  });

  return (
    <ModalShell open title={def ? 'Edit expense name' : 'New expense name'} subtitle={def?.code} primaryLabel={save.isPending ? 'Saving…' : 'Save'}
      busy={save.isPending} primaryDisabled={!name.trim()} onPrimary={() => save.mutate()} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div>
          <label className="label">Name</label>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Salary" className="input" />
        </div>
        <div>
          <label className="label">Category</label>
          <Select value={categoryId} onChange={setCategoryId} options={[{ value: '', label: 'Uncategorised' }, ...catOptions]} />
        </div>
        <div>
          <label className="label">Default occurrence <span className="font-normal text-n-400">(optional — pre-fills the register form)</span></label>
          <Select value={occurrence} onChange={setOccurrence} options={[
            { value: '', label: 'None' },
            { value: 'monthly', label: 'Monthly' },
            { value: 'annual', label: 'Annual' },
            { value: 'once_off', label: 'Once-off' },
          ]} />
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
