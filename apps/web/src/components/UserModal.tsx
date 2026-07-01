import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ModalShell } from '@masquare/ui';
import { companiesApi, modulesApi, usersApi, type User } from '../lib/api';

interface Props {
  user: User | null; // null = create
  onClose: () => void;
  onSaved: () => void;
}

const TABS = [
  { key: 'details', label: 'Details' },
  { key: 'access', label: 'Access' },
];

export function UserModal({ user, onClose, onSaved }: Props) {
  const [tab, setTab] = useState('details');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  const { data: companies = [] } = useQuery({ queryKey: ['companies'], queryFn: companiesApi.list });
  const { data: modules = [] } = useQuery({ queryKey: ['modules'], queryFn: modulesApi.list });

  const [form, setForm] = useState({
    fullName: user?.fullName ?? '',
    email: user?.email ?? '',
    password: '',
    isAdmin: user?.isAdmin ?? false,
    status: user?.status ?? ('active' as 'active' | 'disabled'),
  });
  // On create, default to all-access (matches the API default).
  const [companyIds, setCompanyIds] = useState<string[]>(user?.companyIds ?? []);
  const [moduleIds, setModuleIds] = useState<string[]>(user?.moduleIds ?? []);
  const [grantsTouched, setGrantsTouched] = useState(false);

  const set = (patch: Partial<typeof form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
  };

  const isCreate = !user;
  // When creating, if the admin hasn't touched grants, leave them undefined => all-access.
  const effectiveCompanyIds = isCreate && !grantsTouched ? undefined : companyIds;
  const effectiveModuleIds = isCreate && !grantsTouched ? undefined : moduleIds;

  const canSave = useMemo(() => {
    if (!form.fullName.trim() || !form.email.trim()) return false;
    if (isCreate && form.password.length < 6) return false;
    return true;
  }, [form, isCreate]);

  const toggle = (list: string[], id: string, setter: (v: string[]) => void) => {
    setter(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
    setGrantsTouched(true);
    setDirty(true);
  };

  const save = async () => {
    if (!canSave) {
      setTab('details');
      toast.error(isCreate ? 'Name, email, and a 6+ char password are required' : 'Name and email are required');
      return;
    }
    setBusy(true);
    try {
      const body: any = {
        fullName: form.fullName,
        email: form.email,
        isAdmin: form.isAdmin,
        status: form.status,
      };
      if (form.password) body.password = form.password;
      if (effectiveCompanyIds !== undefined) body.companyIds = effectiveCompanyIds;
      if (effectiveModuleIds !== undefined) body.moduleIds = effectiveModuleIds;

      if (user) await usersApi.update(user.id, body);
      else await usersApi.create(body);
      toast.success(user ? 'User updated' : 'User created');
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
      title={user ? 'Edit user' : 'New user'}
      subtitle={user?.email}
      tabs={TABS}
      activeTab={tab}
      onTabChange={setTab}
      dirty={dirty}
      primaryLabel={user ? 'Save changes' : 'Create user'}
      onPrimary={save}
      primaryDisabled={!canSave}
      busy={busy}
      onClose={onClose}
    >
      {tab === 'details' && (
        <div className="grid grid-cols-2 gap-4 max-[560px]:grid-cols-1">
          <div className="col-span-2">
            <label className="label">Full name *</label>
            <input className="input" value={form.fullName} onChange={(e) => set({ fullName: e.target.value })} />
          </div>
          <div className="col-span-2">
            <label className="label">Email *</label>
            <input className="input" value={form.email} onChange={(e) => set({ email: e.target.value })} />
          </div>
          <div className="col-span-2">
            <label className="label">{user ? 'New password (leave blank to keep)' : 'Password *'}</label>
            <input className="input mono" type="password" value={form.password} onChange={(e) => set({ password: e.target.value })} />
          </div>
          <div>
            <label className="label">Status</label>
            <select className="input" value={form.status} onChange={(e) => set({ status: e.target.value as any })}>
              <option value="active">Active</option>
              <option value="disabled">Disabled</option>
            </select>
          </div>
          <div className="flex items-end">
            <label className="flex cursor-pointer items-center gap-2.5 pb-2.5">
              <input type="checkbox" className="h-4 w-4 accent-[var(--teal-500)]" checked={form.isAdmin} onChange={(e) => set({ isAdmin: e.target.checked })} />
              <span className="text-[13.5px] text-n-700">Platform admin</span>
            </label>
          </div>
        </div>
      )}

      {tab === 'access' && (
        <div className="flex flex-col gap-5">
          {form.isAdmin ? (
            <p className="rounded-md border border-info-bd bg-info-bg px-3 py-2.5 text-[13px] text-info">
              Admins implicitly hold every company and module grant. Toggle off “Platform admin” to set specific access.
            </p>
          ) : (
            <>
              {isCreate && !grantsTouched && (
                <p className="rounded-md border border-n-200 bg-n-50 px-3 py-2.5 text-[13px] text-n-600">
                  New users default to <strong>all-access</strong>. Toggle any box to set access explicitly.
                </p>
              )}
              <Section title="Companies">
                <div className="grid grid-cols-2 gap-2 max-[560px]:grid-cols-1">
                  {companies.map((c) => {
                    const on = isCreate && !grantsTouched ? true : companyIds.includes(c.id);
                    return (
                      <label key={c.id} className="flex cursor-pointer items-center gap-2.5 rounded-md border border-n-200 px-3 py-2 hover:bg-n-50">
                        <input type="checkbox" className="h-4 w-4 accent-[var(--teal-500)]" checked={on} onChange={() => toggle(companyIds.length || grantsTouched ? companyIds : companies.map((x) => x.id), c.id, setCompanyIds)} />
                        <span className="truncate text-[13px] text-n-700">{c.officialName}</span>
                      </label>
                    );
                  })}
                </div>
              </Section>
              <Section title="Modules">
                <div className="grid grid-cols-2 gap-2 max-[560px]:grid-cols-1">
                  {modules.map((m) => {
                    const on = isCreate && !grantsTouched ? true : moduleIds.includes(m.id);
                    return (
                      <label key={m.id} className="flex cursor-pointer items-center gap-2.5 rounded-md border border-n-200 px-3 py-2 hover:bg-n-50">
                        <input type="checkbox" className="h-4 w-4 accent-[var(--teal-500)]" checked={on} onChange={() => toggle(moduleIds.length || grantsTouched ? moduleIds : modules.map((x) => x.id), m.id, setModuleIds)} />
                        <span className="truncate text-[13px] text-n-700">{m.name}</span>
                      </label>
                    );
                  })}
                </div>
              </Section>
            </>
          )}
        </div>
      )}
    </ModalShell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-[13px] font-semibold text-n-800">{title}</h3>
      {children}
    </div>
  );
}
