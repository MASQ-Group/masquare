import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, Loader2, Mail, Send, XCircle } from 'lucide-react';
import { emailApi } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { SectionHeader } from './shared';

/**
 * How the platform sends email.
 *
 * Google Workspace, through a service account that is allowed to act as one of your own mailboxes.
 * The setup is in two consoles and the errors from getting it wrong all look alike, so the steps are
 * on the page rather than in a document somebody has to find — and the test send is the only thing
 * that proves any of it, which is why sending cannot be switched on before one has succeeded.
 */
export function EmailTab() {
  const { user } = useAuth();
  // Admin-only to change: whoever holds this chooses the address the platform speaks as.
  const readOnly = !user?.isAdmin;
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['email', 'settings'], queryFn: emailApi.settings });

  const [senderAddress, setSenderAddress] = useState('');
  const [senderName, setSenderName] = useState('');
  const [replyTo, setReplyTo] = useState('');
  const [json, setJson] = useState('');
  const [testTo, setTestTo] = useState('');

  // The saved values, once they arrive. Re-seeded when the row changes under us (a save, a test).
  useEffect(() => {
    if (!data) return;
    setSenderAddress(data.senderAddress ?? '');
    setSenderName(data.senderName ?? 'maSquare');
    setReplyTo(data.replyTo ?? '');
  }, [data?.senderAddress, data?.senderName, data?.replyTo]);

  const save = useMutation({
    mutationFn: (patch: Parameters<typeof emailApi.save>[0]) => emailApi.save(patch),
    onSuccess: () => {
      setJson('');
      toast.success('Email settings saved');
      qc.invalidateQueries({ queryKey: ['email'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not save', { duration: 9000 }),
  });

  const test = useMutation({
    mutationFn: () => emailApi.test(testTo.trim()),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['email'] });
      if (r.ok) toast.success(r.message, { duration: 8000 });
      // Long, because the message is the instructions for fixing it.
      else toast.error(r.message, { duration: 20000 });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not send the test', { duration: 9000 }),
  });

  const messages = useQuery({ queryKey: ['email', 'messages'], queryFn: () => emailApi.messages(20) });

  const busy = save.isPending || test.isPending;
  const configured = !!data?.senderAddress && !!data?.hasKey;
  const field = 'h-9 w-full rounded-md border border-n-200 px-2.5 text-[13px] outline-none focus:border-teal-400 disabled:bg-n-25';

  if (isLoading) return <div className="py-10 text-center text-[13px] text-n-500">Loading…</div>;

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Email"
        description="The account the platform sends from — invitations, notifications and anything else it needs to tell somebody about."
      />

      <div className="card p-5">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Mail size={15} className="text-n-500" />
          <span className="text-[13px] font-semibold text-n-800">Google Workspace</span>
          <span className={`tag border ${data?.enabled ? 'border-teal-100 bg-teal-50 text-teal-700' : 'border-n-200 bg-n-50 text-n-600'}`}>
            {data?.enabled ? 'Sending is on' : 'Sending is off'}
          </span>
          {data?.lastTestedAt && (
            <span className="inline-flex items-center gap-1 text-[12px] text-n-500">
              {data.lastTestStatus === 'ok' ? <CheckCircle2 size={13} className="text-teal-600" /> : <XCircle size={13} className="text-orange-600" />}
              Last test {new Date(data.lastTestedAt).toLocaleString()}
            </span>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-n-700">Send from</span>
            <input className={field} disabled={readOnly || busy} value={senderAddress} onChange={(e) => setSenderAddress(e.target.value)} placeholder="shipments@yourdomain.com" />
            <span className="mt-1 block text-[11.5px] text-n-500">A real mailbox in your Workspace domain. Sent messages appear in its sent folder.</span>
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-n-700">Shown as</span>
            <input className={field} disabled={readOnly || busy} value={senderName} onChange={(e) => setSenderName(e.target.value)} placeholder="maSquare" />
            <span className="mt-1 block text-[11.5px] text-n-500">The name recipients see beside the address.</span>
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-n-700">Replies go to <span className="font-normal text-n-500">(optional)</span></span>
            <input className={field} disabled={readOnly || busy} value={replyTo} onChange={(e) => setReplyTo(e.target.value)} placeholder="Leave blank to use the sending address" />
          </label>
          <div className="block">
            <span className="mb-1 block text-[12px] font-medium text-n-700">Service account key</span>
            <div className="flex h-9 items-center text-[12.5px] text-n-600">
              {data?.hasKey
                ? <span>Held{data.clientEmail ? <> for <span className="mono text-n-800">{data.clientEmail}</span></> : null}{data.keyId ? <span className="text-n-400"> · key {data.keyId.slice(0, 8)}…</span> : null}</span>
                : <span className="text-n-500">None yet — paste the JSON key below.</span>}
            </div>
          </div>
        </div>

        <label className="mt-4 block">
          <span className="mb-1 block text-[12px] font-medium text-n-700">{data?.hasKey ? 'Replace the key' : 'Paste the JSON key file'}</span>
          <textarea
            className="h-28 w-full rounded-md border border-n-200 p-2.5 font-mono text-[11.5px] outline-none focus:border-teal-400 disabled:bg-n-25"
            disabled={readOnly || busy}
            value={json}
            onChange={(e) => setJson(e.target.value)}
            placeholder={'{\n  "type": "service_account",\n  "client_email": "...",\n  "private_key": "-----BEGIN PRIVATE KEY-----\\n..."\n}'}
          />
          <span className="mt-1 block text-[11.5px] text-n-500">
            The whole file, as downloaded. It is encrypted before it is stored and never shown again.
          </span>
        </label>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-primary"
            disabled={readOnly || busy}
            onClick={() => save.mutate({ senderAddress, senderName, replyTo, serviceAccountJson: json.trim() || undefined })}
          >
            {save.isPending && <Loader2 size={13} className="mr-1 inline animate-spin" />}Save
          </button>

          <div className="flex-1" />

          <input className={`${field} max-w-[240px]`} disabled={readOnly || busy || !configured} value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="Send a test to…" />
          <button type="button" className="hbtn" disabled={readOnly || busy || !configured || !testTo.trim()} onClick={() => test.mutate()}>
            {test.isPending ? <Loader2 size={13} className="mr-1 inline animate-spin" /> : <Send size={13} className="mr-1 inline" />}Send test
          </button>
          {/* The switch is deliberately last and deliberately blocked until a test has worked: "on"
              with nothing behind it is the state in which failures are silent. */}
          <button
            type="button"
            className="hbtn"
            disabled={readOnly || busy || !configured || (!data?.enabled && data?.lastTestStatus !== 'ok')}
            title={!configured ? 'Add the sender address and key first' : data?.lastTestStatus !== 'ok' && !data?.enabled ? 'Send a successful test first' : undefined}
            onClick={() => save.mutate({ enabled: !data?.enabled })}
          >
            {data?.enabled ? 'Switch sending off' : 'Switch sending on'}
          </button>
        </div>

        {data?.lastTestStatus === 'failed' && data.lastTestMessage && (
          <p className="mt-3 whitespace-pre-line rounded-md border border-orange-200 bg-orange-50 p-3 text-[12px] text-orange-900">{data.lastTestMessage}</p>
        )}
      </div>

      <div className="card p-5">
        <div className="mb-2 text-[13px] font-semibold text-n-800">Setting this up in Google</div>
        <ol className="ml-4 list-decimal space-y-1.5 text-[12.5px] leading-relaxed text-n-600">
          <li>In the <span className="font-medium">Google Cloud console</span>, create a project (or use an existing one) and enable the <span className="font-medium">Gmail API</span>.</li>
          <li>Create a <span className="font-medium">service account</span> in that project, then create a <span className="font-medium">JSON key</span> for it and paste the file above.</li>
          <li>Copy the service account’s <span className="font-medium">numeric Client ID</span> — the <span className="mono">client_id</span> in that same file, not its email address.</li>
          <li>
            In the <span className="font-medium">Workspace admin console</span> → Security → Access and data control → API controls → <span className="font-medium">Domain-wide delegation</span>,
            add that Client ID with the single scope <span className="mono text-[11.5px]">https://www.googleapis.com/auth/gmail.send</span>.
          </li>
          <li>Put a real mailbox from your domain in <span className="font-medium">Send from</span>, and send a test.</li>
        </ol>
        <p className="mt-3 text-[12px] text-n-500">
          Only <span className="mono text-[11.5px]">gmail.send</span> is needed. It lets the platform send as that mailbox and nothing else — it cannot read mail.
        </p>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-n-100 px-4 py-2.5 text-[13px] font-semibold text-n-800">Recently sent</div>
        {(messages.data ?? []).length === 0 ? (
          <div className="px-4 py-6 text-center text-[12.5px] text-n-500">Nothing sent yet.</div>
        ) : (
          <table className="w-full text-[12.5px]">
            <thead className="text-left text-[11px] uppercase tracking-wide text-n-500">
              <tr>
                <th className="px-4 py-2 font-semibold">When</th>
                <th className="px-3 py-2 font-semibold">To</th>
                <th className="px-3 py-2 font-semibold">Subject</th>
                <th className="px-3 py-2 font-semibold">Kind</th>
                <th className="px-3 py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {(messages.data ?? []).map((m) => (
                <tr key={m.id} className="border-t border-n-100">
                  <td className="px-4 py-1.5 text-n-600">{new Date(m.createdAt).toLocaleString()}</td>
                  <td className="px-3 py-1.5 mono text-n-700">{m.toAddress}</td>
                  <td className="max-w-[260px] truncate px-3 py-1.5 text-n-700" title={m.subject}>{m.subject}</td>
                  <td className="px-3 py-1.5 text-n-500">{m.kind}</td>
                  <td className="px-3 py-1.5">
                    <span className={m.status === 'sent' ? 'text-teal-700' : m.status === 'failed' ? 'text-orange-700' : 'text-n-500'} title={m.error ?? undefined}>
                      {m.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
