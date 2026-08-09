import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Search, Tag as TagIcon, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ModalShell, Select } from '@masquare/ui';
import { expenseTagsApi, type ExpenseTag } from '../../lib/api';
import { PageHeader } from '../../components/common/PageHeader';
import { usePersistentState } from '../../lib/usePersistentState';

export function ExpenseTagsPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [showInactive, setShowInactive] = usePersistentState('expenseTags.showInactive', false);
  const [modal, setModal] = useState<{ tag?: ExpenseTag } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ExpenseTag | null>(null);

  const { data: tags = [], isLoading } = useQuery({ queryKey: ['expense-tags', showInactive], queryFn: () => expenseTagsApi.list({ includeInactive: showInactive }) });
  const groups = useMemo(() => [...new Set(tags.map((t) => t.group).filter((g): g is string => !!g))].sort(), [tags]);
  const invalidate = () => qc.invalidateQueries({ queryKey: ['expense-tags'] });

  const del = useMutation({
    mutationFn: (id: string) => expenseTagsApi.remove(id),
    onSuccess: (res) => { toast.success(res.deactivated ? 'Tag deactivated — it is used by expenses' : 'Tag deleted'); setConfirmDelete(null); invalidate(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not remove tag'),
  });

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return tags.filter((t) => (!groupFilter || t.group === groupFilter) && (!term || t.name.toLowerCase().includes(term) || (t.group ?? '').toLowerCase().includes(term)));
  }, [tags, q, groupFilter]);

  const th = 'border-b border-n-200 bg-n-25 px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-n-500 whitespace-nowrap';
  const td = 'border-b border-n-100 px-4 py-2.5 text-[13px] text-n-700';

  return (
    <div className="w-full">
      <PageHeader
        module="Expenses"
        title="Tags"
        info="Track expenses against a specific thing — a company car by plate, a project, an office. Group related tags (e.g. all cars) to report on the whole group or one item."
        primary={<button onClick={() => setModal({})} className="hbtn-primary"><Plus size={15} /> New tag</button>}
        toolbar={
          <>
            <div className="flex h-8 min-w-[200px] max-w-[300px] flex-1 items-center gap-2 rounded-lg border border-n-200 bg-n-0 px-3">
              <Search size={15} className="text-n-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tags…" className="flex-1 bg-transparent text-[13px] text-n-900 outline-none placeholder:text-n-400" />
            </div>
            <Select dense className="w-48" value={groupFilter} onChange={setGroupFilter} options={[{ value: '', label: 'All groups' }, ...groups.map((g) => ({ value: g, label: g }))]} />
            <label className="ml-auto flex cursor-pointer items-center gap-2 text-[12.5px] text-n-600">
              <input type="checkbox" className="h-3.5 w-3.5 accent-[var(--teal-500)]" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show inactive
            </label>
          </>
        }
      />

      <div className="card overflow-hidden">
        <div className="border-b border-n-100 px-4 py-2.5 text-[12px] text-n-500">{rows.length} tag{rows.length === 1 ? '' : 's'}</div>
        <div className="overflow-x-auto max-[767px]:hidden">
          <table className="w-full min-w-[640px] border-collapse">
            <thead>
              <tr>
                <th className={`${th} text-left`}>Group</th>
                <th className={`${th} text-left`}>Tag value</th>
                <th className={`${th} text-left`}>Description</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td className={td} colSpan={4}>Loading…</td></tr>}
              {!isLoading && rows.length === 0 && <tr><td className={`${td} py-10 text-center text-n-400`} colSpan={4}>No tags{q || groupFilter ? ' match' : ' yet'}. Create one to start tracking, e.g. group “Cars”, value “CY-1234”.</td></tr>}
              {rows.map((t) => (
                <tr key={t.id} className={`group hover:bg-n-25 ${t.isActive ? '' : 'opacity-55'}`}>
                  <td className={td}>{t.group ? <span className="tag border border-n-200 bg-n-50 text-n-600">{t.group}</span> : <span className="text-n-300">—</span>}</td>
                  <td className={td}>
                    <span className="inline-flex items-center gap-1.5 font-semibold text-n-800"><TagIcon size={13} className="text-n-400" />{t.name}</span>
                    {!t.isActive && <span className="tag ml-2">Inactive</span>}
                  </td>
                  <td className={`${td} max-w-[280px] truncate text-n-500`}>{t.description ?? <span className="text-n-300">—</span>}</td>
                  <td className={`${td} text-right`}>
                    <div className="flex justify-end gap-1 opacity-0 transition group-hover:opacity-100">
                      <IconBtn title="Edit" onClick={() => setModal({ tag: t })}><Pencil size={14} /></IconBtn>
                      <IconBtn title="Delete" danger onClick={() => setConfirmDelete(t)}><Trash2 size={14} /></IconBtn>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile: card list (guide Principle 3 — no horizontal scroll). */}
        <div className="hidden flex-col gap-2 p-3 max-[767px]:flex">
          {rows.map((t) => (
            <div key={t.id} className={`flex flex-col gap-1.5 rounded-[10px] border border-n-200 p-3 ${t.isActive ? '' : 'opacity-55'}`}>
              <div className="flex items-center gap-2">
                <span className="inline-flex min-w-0 flex-1 items-center gap-1.5 truncate font-semibold text-n-800"><TagIcon size={13} className="shrink-0 text-n-400" />{t.name}</span>
                {!t.isActive && <span className="tag shrink-0">Inactive</span>}
                <div className="flex shrink-0 gap-0.5">
                  <IconBtn title="Edit" onClick={() => setModal({ tag: t })}><Pencil size={14} /></IconBtn>
                  <IconBtn title="Delete" danger onClick={() => setConfirmDelete(t)}><Trash2 size={14} /></IconBtn>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[12px] text-n-500">
                {t.group && <span className="tag border border-n-200 bg-n-50 text-n-600">{t.group}</span>}
                {t.description && <span className="min-w-0 truncate">{t.description}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {modal && <TagModal tag={modal.tag} groups={groups} onClose={() => setModal(null)} onSaved={() => { setModal(null); invalidate(); }} />}
      {confirmDelete && (
        <ModalShell open title="Delete tag" subtitle={confirmDelete.name} primaryLabel={del.isPending ? 'Removing…' : 'Delete'} busy={del.isPending}
          onPrimary={() => del.mutate(confirmDelete.id)} onClose={() => setConfirmDelete(null)}>
          <p className="text-[13px] text-n-700">Delete “{confirmDelete.name}”? If it's already used by an expense it's deactivated instead, so past records keep it.</p>
        </ModalShell>
      )}
    </div>
  );
}

function TagModal({ tag, groups, onClose, onSaved }: { tag?: ExpenseTag; groups: string[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(tag?.name ?? '');
  const [group, setGroup] = useState(tag?.group ?? '');
  const [description, setDescription] = useState(tag?.description ?? '');

  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), group: group.trim() || null, description: description.trim() || null };
      return tag ? expenseTagsApi.update(tag.id, body) : expenseTagsApi.create(body);
    },
    onSuccess: () => { toast.success(tag ? 'Tag updated' : 'Tag created'); onSaved(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not save tag'),
  });

  return (
    <ModalShell open title={tag ? 'Edit tag' : 'New tag'} primaryLabel={save.isPending ? 'Saving…' : 'Save'} busy={save.isPending}
      primaryDisabled={!name.trim()} onPrimary={() => save.mutate()} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div>
          <label className="label">Tag value</label>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. CY-1234 — Toyota Yaris" className="input" />
        </div>
        <div>
          <label className="label">Group <span className="font-normal text-n-400">(optional — groups related tags for reporting)</span></label>
          <input value={group} onChange={(e) => setGroup(e.target.value)} list="expense-tag-groups" placeholder="e.g. Cars" className="input" />
          <datalist id="expense-tag-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
        </div>
        <div>
          <label className="label">Description <span className="font-normal text-n-400">(optional)</span></label>
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Company car, sales team" className="input" />
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
