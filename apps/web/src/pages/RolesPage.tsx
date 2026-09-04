import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { ModalShell } from '@masquare/ui';
import { accessApi, rolesApi, type GrantSet, type Role } from '../lib/api';
import { AccessEditor } from '../components/access/AccessEditor';
import { PageHeader } from '../components/common/PageHeader';

const EMPTY: GrantSet = { areas: {}, capabilities: {} };

/**
 * The roles people are assigned.
 *
 * A role is a starting point rather than a cage — every setting here can be overridden for one
 * person on their own Access tab. What lives here is the shape of a job, so that hiring somebody
 * into it is one decision instead of twenty-one.
 */
export function RolesPage() {
  const qc = useQueryClient();
  const { data: roles = [], isLoading } = useQuery({ queryKey: ['roles'], queryFn: rolesApi.list });
  const { data: catalogue } = useQuery({ queryKey: ['access', 'catalogue'], queryFn: accessApi.catalogue });
  const [editing, setEditing] = useState<Role | 'new' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Role | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['roles'] });
    qc.invalidateQueries({ queryKey: ['users'] });
  };

  const del = useMutation({
    mutationFn: (id: string) => rolesApi.remove(id),
    onSuccess: () => { toast.success('Role deleted'); setConfirmDelete(null); invalidate(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not delete the role'),
  });

  const count = (g: GrantSet, level: string) => Object.values(g.areas ?? {}).filter((v) => v === level).length;
  const caps = (g: GrantSet) => Object.values(g.capabilities ?? {}).filter(Boolean).length;

  return (
    <div className="w-full">
      <PageHeader
        module="Setup"
        title="Roles"
        info="The shape of a job, assigned to people and adjusted per person where it differs."
        primary={<button className="hbtn-primary" onClick={() => setEditing('new')}><Plus size={16} /> New role</button>}
      />

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {['Role', 'Editable', 'Read-only', 'Capabilities', 'People', ''].map((h) => (
                  <th key={h} className="border-b border-n-200 bg-n-25 px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-n-500">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={6} className="px-4 py-8 text-[13px] text-n-500">Loading…</td></tr>}
              {!isLoading && roles.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-[13px] text-n-500">No roles yet.</td></tr>
              )}
              {roles.map((r) => (
                <tr key={r.id} className="group hover:bg-n-25">
                  <td className="border-b border-n-100 px-4 py-3">
                    <div className="flex items-center gap-1.5 text-[13.5px] font-semibold text-n-800">
                      {r.name}
                      {r.isSystem && (
                        <span title="Ships with the platform — editable, but not deletable" className="text-n-400">
                          <Lock size={12} />
                        </span>
                      )}
                    </div>
                    {r.description && <div className="mt-0.5 max-w-[52ch] text-[12px] leading-4 text-n-500">{r.description}</div>}
                  </td>
                  <td className="mono border-b border-n-100 px-4 py-3 text-[13px] text-n-700">{count(r.grants, 'edit')}</td>
                  <td className="mono border-b border-n-100 px-4 py-3 text-[13px] text-n-700">{count(r.grants, 'view')}</td>
                  <td className="mono border-b border-n-100 px-4 py-3 text-[13px] text-n-700">{caps(r.grants)}</td>
                  <td className="border-b border-n-100 px-4 py-3 text-[13px] text-n-600">
                    <span className="inline-flex items-center gap-1.5"><Users size={13} className="text-n-400" />{r.userCount}</span>
                  </td>
                  <td className="border-b border-n-100 px-4 py-3">
                    <div className="flex justify-end gap-1 opacity-0 transition group-hover:opacity-100">
                      <button className="grid h-8 w-8 place-items-center rounded-md text-n-500 hover:bg-n-100 hover:text-n-800" onClick={() => setEditing(r)} title="Edit">
                        <Pencil size={15} />
                      </button>
                      <button
                        className="grid h-8 w-8 place-items-center rounded-md text-n-500 hover:bg-danger-bg hover:text-danger disabled:opacity-30"
                        disabled={r.isSystem || r.userCount > 0}
                        title={r.isSystem ? 'Ships with the platform' : r.userCount > 0 ? 'Someone holds this role' : 'Delete'}
                        onClick={() => setConfirmDelete(r)}
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
      </div>

      {editing && catalogue && (
        <RoleModal
          role={editing === 'new' ? null : editing}
          catalogue={catalogue}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); invalidate(); }}
        />
      )}

      {confirmDelete && (
        <ModalShell
          open
          title="Delete role"
          subtitle={confirmDelete.name}
          primaryLabel={del.isPending ? 'Deleting…' : 'Delete'}
          onPrimary={() => del.mutate(confirmDelete.id)}
          busy={del.isPending}
          onClose={() => setConfirmDelete(null)}
        >
          <p className="text-[13px] text-n-700">
            Delete {confirmDelete.name}? Nobody holds it, so nobody loses access.
          </p>
        </ModalShell>
      )}
    </div>
  );
}

function RoleModal({
  role, catalogue, onClose, onSaved,
}: {
  role: Role | null;
  catalogue: NonNullable<Awaited<ReturnType<typeof accessApi.catalogue>>>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [grants, setGrants] = useState<GrantSet>(role?.grants ?? EMPTY);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(role?.name ?? '');
    setDescription(role?.description ?? '');
    setGrants(role?.grants ?? EMPTY);
  }, [role?.id]);

  const save = async () => {
    if (!name.trim()) { toast.error('Give the role a name'); return; }
    setBusy(true);
    try {
      if (role) await rolesApi.update(role.id, { name: name.trim(), description: description.trim() || null, grants });
      else await rolesApi.create({ name: name.trim(), description: description.trim() || null, grants });
      toast.success(role ? 'Role saved' : 'Role created');
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
      title={role ? 'Edit role' : 'New role'}
      subtitle={role?.isSystem ? 'Ships with the platform — edits are kept, but the seed can restore the original' : undefined}
      dirty={dirty}
      primaryLabel={busy ? 'Saving…' : role ? 'Save role' : 'Create role'}
      onPrimary={save}
      busy={busy}
      onClose={onClose}
      initialSize={{ w: 880, h: 720 }}
    >
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-4 max-[640px]:grid-cols-1">
          <div>
            <label className="label">Name</label>
            <input className="input" value={name} onChange={(e) => { setName(e.target.value); setDirty(true); }} placeholder="e.g. Warehouse" />
          </div>
          <div>
            <label className="label">Description <span className="font-normal text-n-400">(optional)</span></label>
            <input
              className="input"
              value={description}
              onChange={(e) => { setDescription(e.target.value); setDirty(true); }}
              placeholder="What this job does, in a sentence"
            />
          </div>
        </div>

        {role && role.userCount > 0 && (
          <p className="rounded-md border border-info-bd bg-info-bg px-3 py-2 text-[12.5px] text-info">
            {role.userCount} {role.userCount === 1 ? 'person holds' : 'people hold'} this role. Saving changes what they can do
            immediately — except where someone has an override, which always wins.
          </p>
        )}

        <AccessEditor catalogue={catalogue} value={grants} onChange={(g) => { setGrants(g); setDirty(true); }} />
      </div>
    </ModalShell>
  );
}
