import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Mail, Trash2, UserPlus } from 'lucide-react';
import { customersApi, type CustomerPortalUser } from '../../lib/api';
import { useConfirm } from '../ConfirmProvider';

/**
 * The people at a logistics customer who sign in to the portal.
 *
 * Nobody here sets somebody else's password: the account is created unusable and an invitation is
 * emailed, so the password is only ever known to the person using it. The list therefore answers
 * "can they get in yet" rather than "does a row exist", which is the question actually being asked.
 */
export function CustomerPortalUsers({ customerId, customerName }: { customerId: string; customerName: string }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [draft, setDraft] = useState({ fullName: '', email: '' });

  const users = useQuery({ queryKey: ['customers', customerId, 'users'], queryFn: () => customersApi.users(customerId) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['customers', customerId, 'users'] });
  const failed = (e: any) => toast.error(e?.response?.data?.message ?? 'That did not work', { duration: 9000 });

  /** The invitation can fail while the account succeeds, so both outcomes are reported. */
  const reportInvite = (r: { sent: boolean; message: string }) =>
    r.sent ? toast.success(r.message) : toast.warning(r.message, { duration: 15000 });

  const add = useMutation({
    mutationFn: () => customersApi.addUser(customerId, { fullName: draft.fullName.trim(), email: draft.email.trim() }),
    onSuccess: (r) => { setDraft({ fullName: '', email: '' }); reportInvite(r.invite); refresh(); },
    onError: failed,
  });
  const reinvite = useMutation({
    mutationFn: (userId: string) => customersApi.reinvite(customerId, userId),
    onSuccess: (r) => { reportInvite(r); refresh(); },
    onError: failed,
  });
  const setStatus = useMutation({
    mutationFn: ({ userId, status }: { userId: string; status: string }) => customersApi.updateUser(customerId, userId, { status }),
    onSuccess: () => { toast.success('Login updated'); refresh(); },
    onError: failed,
  });
  const remove = useMutation({
    mutationFn: (userId: string) => customersApi.removeUser(customerId, userId),
    onSuccess: () => { toast.success('Login removed'); refresh(); },
    onError: failed,
  });

  const rows = users.data ?? [];

  /** What this person can do right now, said plainly rather than as a status code. */
  const state = (u: CustomerPortalUser) => {
    if (u.status !== 'active') return { label: 'Disabled', tone: 'bg-n-100 text-n-600' };
    if (u.invite?.state === 'used') return { label: 'Can sign in', tone: 'bg-teal-50 text-teal-700' };
    if (u.invite?.state === 'valid') return { label: 'Invited', tone: 'bg-info-bg text-info' };
    if (u.invite?.state === 'expired') return { label: 'Invitation expired', tone: 'bg-warning-bg text-warning' };
    return { label: 'Not invited', tone: 'bg-n-100 text-n-600' };
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] text-n-600">
        The people at {customerName} who may file and follow shipments. Each sets their own password from the emailed invitation — nobody here ever sees it.
      </p>

      {users.isLoading && <p className="text-[13px] text-n-500">Loading…</p>}
      {!users.isLoading && rows.length === 0 && <p className="text-[13px] text-n-500">No portal logins yet.</p>}

      {rows.map((u) => {
        const s = state(u);
        return (
          <div key={u.id} className="flex flex-wrap items-center gap-2 rounded-md border border-n-200 px-3 py-2">
            <div className="min-w-0 flex-1 text-[13px]">
              <span className="font-semibold text-n-800">{u.fullName}</span>
              <span className={`tag ml-2 ${s.tone}`}>{s.label}</span>
              <div className="text-[12px] text-n-600">{u.email}</div>
            </div>
            <button type="button" className="hbtn" disabled={reinvite.isPending} onClick={() => reinvite.mutate(u.id)}>
              <Mail size={14} /> {u.invite?.state === 'used' ? 'Send a new link' : 'Send invitation'}
            </button>
            <button
              type="button"
              className="hbtn"
              onClick={() => setStatus.mutate({ userId: u.id, status: u.status === 'active' ? 'disabled' : 'active' })}
            >
              {u.status === 'active' ? 'Disable' : 'Enable'}
            </button>
            <button
              className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-md text-n-500 hover:bg-danger-bg hover:text-danger"
              title="Remove this login"
              onClick={async () => {
                const ok = await confirm({
                  title: `Remove ${u.fullName}'s login?`,
                  message: 'They will not be able to sign in. Anything they filed stays.',
                  confirmLabel: 'Remove',
                  tone: 'danger',
                });
                if (ok) remove.mutate(u.id);
              }}
            >
              <Trash2 size={15} />
            </button>
          </div>
        );
      })}

      <div className="grid grid-cols-2 gap-3 max-[560px]:grid-cols-1">
        <input className="input" placeholder="Full name" value={draft.fullName} onChange={(e) => setDraft({ ...draft, fullName: e.target.value })} />
        <input className="input" placeholder="Email address" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
      </div>
      <div>
        <button
          className="btn btn-ghost"
          disabled={!draft.fullName.trim() || !draft.email.trim() || add.isPending}
          onClick={() => add.mutate()}
        >
          <UserPlus size={16} /> {add.isPending ? 'Creating…' : 'Create login and send invitation'}
        </button>
      </div>
    </div>
  );
}
