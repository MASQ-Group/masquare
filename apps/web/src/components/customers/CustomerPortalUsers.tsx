import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, Mail, Trash2 } from 'lucide-react';
import { customersApi, type CustomerPortalUser } from '../../lib/api';
import { useConfirm } from '../ConfirmProvider';

/**
 * The people at a customer who sign in to the portal.
 *
 * Nobody here sets somebody else's password: the account is created unusable and an invitation is
 * emailed, so the password is only ever known to the person using it. The list therefore answers
 * "can they get in yet" rather than "does a row exist", which is the question actually being asked.
 */
export function CustomerPortalUsers({ customerId, customerName }: { customerId: string; customerName: string }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');

  const users = useQuery({ queryKey: ['customers', customerId, 'users'], queryFn: () => customersApi.users(customerId) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['customers', customerId, 'users'] });
  const failed = (e: any) => toast.error(e?.response?.data?.message ?? 'That did not work', { duration: 9000 });

  /** The invitation can fail while the account succeeds, so both outcomes are reported. */
  const reportInvite = (r: { sent: boolean; message: string }) =>
    r.sent ? toast.success(r.message) : toast.warning(r.message, { duration: 15000 });

  const add = useMutation({
    mutationFn: () => customersApi.addUser(customerId, { fullName: fullName.trim(), email: email.trim() }),
    onSuccess: (r) => { setFullName(''); setEmail(''); reportInvite(r.invite); refresh(); },
    onError: failed,
  });
  const reinvite = useMutation({
    mutationFn: (userId: string) => customersApi.reinvite(customerId, userId),
    onSuccess: (r) => { reportInvite(r); refresh(); },
    onError: failed,
  });
  const setStatus = useMutation({
    mutationFn: ({ userId, status }: { userId: string; status: string }) => customersApi.updateUser(customerId, userId, { status }),
    onSuccess: () => { toast.success('Updated'); refresh(); },
    onError: failed,
  });
  const remove = useMutation({
    mutationFn: (userId: string) => customersApi.removeUser(customerId, userId),
    onSuccess: () => { toast.success('Login removed'); refresh(); },
    onError: failed,
  });

  const field = 'h-9 rounded-md border border-n-200 px-2.5 text-[13px] outline-none focus:border-teal-400';
  const rows = users.data ?? [];

  /** What this person can do right now, said plainly rather than as a status code. */
  const state = (u: CustomerPortalUser) => {
    if (u.status !== 'active') return { label: 'Disabled', tone: 'bg-n-100 text-n-600 border-n-200' };
    if (u.invite?.state === 'used') return { label: 'Can sign in', tone: 'bg-teal-50 text-teal-700 border-teal-200' };
    if (u.invite?.state === 'valid') return { label: 'Invited', tone: 'bg-blue-50 text-blue-700 border-blue-200' };
    if (u.invite?.state === 'expired') return { label: 'Invitation expired', tone: 'bg-orange-50 text-orange-700 border-orange-200' };
    return { label: 'Not invited', tone: 'bg-n-100 text-n-600 border-n-200' };
  };

  return (
    <div>
      <div className="mb-2 text-[13px] font-semibold text-n-800">Portal logins</div>
      <p className="mb-3 text-[12px] text-n-500">
        Who at {customerName} may file shipments. They set their own password from the invitation — nobody here ever sees it.
      </p>

      {users.isLoading ? (
        <p className="mb-3 text-[12.5px] text-n-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="mb-3 text-[12.5px] text-n-500">Nobody yet.</p>
      ) : (
        <div className="mb-3 divide-y divide-n-100 rounded-md border border-n-100">
          {rows.map((u) => {
            const s = state(u);
            return (
              <div key={u.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-[12.5px]">
                <span className="font-medium text-n-800">{u.fullName}</span>
                <span className="text-n-600">{u.email}</span>
                <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-semibold ${s.tone}`}>{s.label}</span>
                <span className="flex-1" />
                <button
                  type="button"
                  className="text-[11.5px] font-semibold text-teal-700 hover:underline"
                  disabled={reinvite.isPending}
                  onClick={() => reinvite.mutate(u.id)}
                >
                  {reinvite.isPending ? <Loader2 size={12} className="mr-1 inline animate-spin" /> : <Mail size={12} className="mr-1 inline" />}
                  {u.invite?.state === 'used' ? 'Send a new link' : 'Send invitation'}
                </button>
                <button
                  type="button"
                  className="text-[11.5px] font-semibold text-n-600 hover:underline"
                  onClick={() => setStatus.mutate({ userId: u.id, status: u.status === 'active' ? 'disabled' : 'active' })}
                >
                  {u.status === 'active' ? 'Disable' : 'Enable'}
                </button>
                <button
                  type="button"
                  className="text-n-400 hover:text-danger"
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
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <input className={`${field} w-[180px]`} value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Name" />
        <input className={`${field} w-[240px]`} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
        <button type="button" className="hbtn" disabled={!fullName.trim() || !email.trim() || add.isPending} onClick={() => add.mutate()}>
          {add.isPending && <Loader2 size={13} className="mr-1 inline animate-spin" />}Create login and invite
        </button>
      </div>
    </div>
  );
}
