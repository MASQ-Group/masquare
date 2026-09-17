import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { invitesApi } from '../lib/api';

/**
 * Choosing a password from an emailed invitation.
 *
 * Signed out by definition: the person holding the link has no account they can reach yet. The link
 * itself is the authorisation, so the page shows only what the invitation already told them — their
 * name and their company — and never says whether some other address is known to us.
 */
export function SetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [done, setDone] = useState(false);

  const invite = useQuery({
    queryKey: ['invite', token],
    queryFn: () => invitesApi.describe(token),
    enabled: !!token,
    retry: false,
  });

  const accept = useMutation({
    mutationFn: () => invitesApi.accept(token, password),
    onSuccess: () => setDone(true),
  });

  const tooShort = password.length > 0 && password.length < 10;
  const mismatch = again.length > 0 && again !== password;
  const ready = password.length >= 10 && password === again && !accept.isPending;

  const shell = (children: React.ReactNode) => (
    <div className="grid min-h-screen place-items-center bg-n-50 px-4">
      <div className="w-full max-w-[420px] rounded-xl border border-n-200 bg-n-0 p-7 shadow-sm">{children}</div>
    </div>
  );

  if (!token) return shell(<p className="text-[13px] text-n-600">This link is incomplete. Use the one in your invitation email.</p>);
  if (invite.isLoading) return shell(<p className="text-center text-[13px] text-n-500">Checking your invitation…</p>);

  // One message for every kind of refusal, so the page cannot be used to find out who has an account.
  if (!invite.data?.ok) {
    return shell(
      <>
        <h1 className="mb-2 text-[17px] font-semibold text-n-900">This invitation cannot be used</h1>
        <p className="text-[13px] leading-relaxed text-n-600">{invite.data?.reason ?? 'This invitation is not valid. Ask your contact to send a new one.'}</p>
      </>,
    );
  }

  if (done) {
    return shell(
      <>
        <CheckCircle2 size={22} className="mb-2 text-teal-600" />
        <h1 className="mb-2 text-[17px] font-semibold text-n-900">Your password is set</h1>
        <p className="mb-5 text-[13px] leading-relaxed text-n-600">You can sign in with {invite.data.email} from now on.</p>
        <Link to="/login" className="btn-primary inline-block">Sign in</Link>
      </>,
    );
  }

  return (
    <>
      {shell(
        <>
          <h1 className="mb-1 text-[17px] font-semibold text-n-900">Welcome, {invite.data.fullName}</h1>
          <p className="mb-5 text-[13px] leading-relaxed text-n-600">
            Choose a password for {invite.data.email}
            {invite.data.customerName ? <>, to file and follow <span className="font-medium text-n-800">{invite.data.customerName}</span>’s shipments</> : null}.
          </p>

          <label className="mb-3 block">
            <span className="mb-1 block text-[12px] font-medium text-n-700">Password</span>
            <input
              type="password"
              className="h-10 w-full rounded-md border border-n-200 px-3 text-[14px] outline-none focus:border-teal-400"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
            <span className={`mt-1 block text-[11.5px] ${tooShort ? 'text-orange-700' : 'text-n-500'}`}>
              At least 10 characters. A few ordinary words you will remember beats something clever.
            </span>
          </label>

          <label className="mb-4 block">
            <span className="mb-1 block text-[12px] font-medium text-n-700">Password again</span>
            <input
              type="password"
              className="h-10 w-full rounded-md border border-n-200 px-3 text-[14px] outline-none focus:border-teal-400"
              value={again}
              onChange={(e) => setAgain(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && ready) accept.mutate(); }}
            />
            {mismatch && <span className="mt-1 block text-[11.5px] text-orange-700">The two do not match.</span>}
          </label>

          <button type="button" className="btn-primary w-full" disabled={!ready} onClick={() => accept.mutate()}>
            {accept.isPending && <Loader2 size={14} className="mr-1.5 inline animate-spin" />}Set password and continue
          </button>

          {accept.isError && (
            <p className="mt-3 text-[12.5px] text-orange-800">
              {(accept.error as any)?.response?.data?.message ?? 'That did not work. The invitation may have expired.'}
            </p>
          )}
        </>,
      )}
    </>
  );
}
