import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { usersApi, type User } from '../lib/api';
import { PageHeader } from '../components/common/PageHeader';
import { UserModal } from '../components/UserModal';

export function UsersPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<User | null | undefined>(undefined);

  const { data: users = [], isLoading } = useQuery({ queryKey: ['users'], queryFn: usersApi.list });

  const removeMut = useMutation({
    mutationFn: (id: string) => usersApi.remove(id),
    onSuccess: async () => {
      toast.success('User removed');
      await qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: () => toast.error('Could not remove user'),
  });

  return (
    <div className="w-full">
      <PageHeader
        module="Setup"
        title="Users & roles"
        info="People and what they can reach — companies × modules."
        primary={<button className="hbtn-primary" onClick={() => setEditing(null)}><Plus size={16} /> Add user</button>}
      />

      <div className="card overflow-hidden">
        <div className="overflow-x-auto max-[767px]:hidden">
          <table className="w-full min-w-[760px] border-collapse">
            <thead>
              <tr>
                {['User', 'Role', 'Status', 'Companies', 'Modules', ''].map((h) => (
                  <th key={h} className="border-b border-n-200 bg-n-25 px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-n-500">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-[13px] text-n-500">Loading…</td></tr>
              )}
              {!isLoading && users.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-[13px] text-n-500">No users yet.</td></tr>
              )}
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-teal-50">
                  <td className="border-b border-n-100 px-4 py-3">
                    <div className="text-[13.5px] font-medium text-n-800">{u.fullName}</div>
                    <div className="text-[12px] text-n-500">{u.email}</div>
                  </td>
                  <td className="border-b border-n-100 px-4 py-3">
                    {u.isAdmin ? (
                      <span className="tag border border-info-bd bg-info-bg text-info">Admin</span>
                    ) : (
                      <span className="tag border border-n-200 bg-n-100 text-n-600">Member</span>
                    )}
                  </td>
                  <td className="border-b border-n-100 px-4 py-3">
                    {u.status === 'active' ? (
                      <span className="tag border border-success-bd bg-success-bg text-success">Active</span>
                    ) : (
                      <span className="tag border border-n-200 bg-n-100 text-n-500">Disabled</span>
                    )}
                  </td>
                  <td className="mono border-b border-n-100 px-4 py-3 text-[13px] text-n-700">
                    {u.isAdmin ? 'all' : u.companyIds.length}
                  </td>
                  <td className="mono border-b border-n-100 px-4 py-3 text-[13px] text-n-700">
                    {u.isAdmin ? 'all' : u.moduleIds.length}
                  </td>
                  <td className="border-b border-n-100 px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <button className="grid h-8 w-8 place-items-center rounded-md text-n-500 hover:bg-n-100 hover:text-n-800" onClick={() => setEditing(u)} title="Edit">
                        <Pencil size={15} />
                      </button>
                      <button
                        className="grid h-8 w-8 place-items-center rounded-md text-n-500 hover:bg-danger-bg hover:text-danger"
                        onClick={() => { if (confirm(`Remove ${u.fullName}?`)) removeMut.mutate(u.id); }}
                        title="Remove"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile: card list (guide Principle 3 — no horizontal scroll). */}
        <div className="hidden flex-col gap-2 p-3 max-[767px]:flex">
          {users.map((u) => (
            <div key={u.id} className="flex flex-col gap-2 rounded-[10px] border border-n-200 p-3">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-medium text-n-800">{u.fullName}</div>
                  <div className="truncate text-[12px] text-n-500">{u.email}</div>
                </div>
                <div className="flex shrink-0 gap-0.5">
                  <button className="grid h-8 w-8 place-items-center rounded-md text-n-500 hover:bg-n-100 hover:text-n-800" onClick={() => setEditing(u)} title="Edit"><Pencil size={15} /></button>
                  <button className="grid h-8 w-8 place-items-center rounded-md text-n-500 hover:bg-danger-bg hover:text-danger" onClick={() => { if (confirm(`Remove ${u.fullName}?`)) removeMut.mutate(u.id); }} title="Remove"><Trash2 size={15} /></button>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[12px]">
                {u.isAdmin ? <span className="tag border border-info-bd bg-info-bg text-info">Admin</span> : <span className="tag border border-n-200 bg-n-100 text-n-600">Member</span>}
                {u.status === 'active' ? <span className="tag border border-success-bd bg-success-bg text-success">Active</span> : <span className="tag border border-n-200 bg-n-100 text-n-500">Disabled</span>}
                <span className="text-n-500">Companies {u.isAdmin ? 'all' : u.companyIds.length} · Modules {u.isAdmin ? 'all' : u.moduleIds.length}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {editing !== undefined && (
        <UserModal
          user={editing}
          onClose={() => setEditing(undefined)}
          onSaved={async () => {
            setEditing(undefined);
            await qc.invalidateQueries({ queryKey: ['users'] });
          }}
        />
      )}
    </div>
  );
}
