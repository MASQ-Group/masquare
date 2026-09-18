import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, Loader2, Mail, Plus, Send, Trash2, XCircle } from 'lucide-react';
import { emailApi, settingsApi, usersApi } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Select } from '@masquare/ui';
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

  /**
   * Who is told by email when a customer files a shipment. Staff only — the list the API returns
   * excludes customers' own people, and the sender refuses one regardless.
   */
  const platform = useQuery({ queryKey: ['settings'], queryFn: settingsApi.get });
  const staff = useQuery({ queryKey: ['users'], queryFn: usersApi.list, enabled: !readOnly });
  const setAlertUser = useMutation({
    mutationFn: (logisticsAlertUserId: string | null) => settingsApi.update({ logisticsAlertUserId }),
    onSuccess: () => { toast.success('Saved'); qc.invalidateQueries({ queryKey: ['settings'] }); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not save'),
  });

  /**
   * The extra addresses, edited as a list and saved as one.
   *
   * Held locally while being typed — saving on every keystroke would store half an address, and the
   * API rightly refuses those. It saves on Save.
   */
  const [extras, setExtras] = useState<string[]>([]);
  const [extrasDirty, setExtrasDirty] = useState(false);
  useEffect(() => {
    if (!extrasDirty) setExtras(platform.data?.logisticsAlertEmails ?? []);
  }, [platform.data?.logisticsAlertEmails, extrasDirty]);

  const saveExtras = useMutation({
    mutationFn: () => settingsApi.update({ logisticsAlertEmails: extras.map((e) => e.trim()).filter(Boolean) }),
    onSuccess: () => {
      toast.success('Saved');
      setExtrasDirty(false);
      qc.invalidateQueries({ queryKey: ['settings'] });
    },
    // The API names the entry that was wrong, so show what it said rather than a generic failure.
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not save', { duration: 9000 }),
  });

  const editExtras = (next: string[]) => { setExtras(next); setExtrasDirty(true); };

  const busy = save.isPending || test.isPending;
  const configured = !!data?.senderAddress && !!data?.hasKey;
  const field = 'input';

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
            <span className="label">Send from</span>
            <input className={field} disabled={readOnly || busy} value={senderAddress} onChange={(e) => setSenderAddress(e.target.value)} placeholder="shipments@yourdomain.com" />
            <span className="mt-1 block text-[11.5px] text-n-500">A real mailbox in your Workspace domain. Sent messages appear in its sent folder.</span>
          </label>
          <label className="block">
            <span className="label">Shown as</span>
            <input className={field} disabled={readOnly || busy} value={senderName} onChange={(e) => setSenderName(e.target.value)} placeholder="maSquare" />
            <span className="mt-1 block text-[11.5px] text-n-500">The name recipients see beside the address.</span>
          </label>
          <label className="block">
            <span className="label">Replies go to <span className="font-normal text-n-500">(optional)</span></span>
            <input className={field} disabled={readOnly || busy} value={replyTo} onChange={(e) => setReplyTo(e.target.value)} placeholder="Leave blank to use the sending address" />
          </label>
          <div className="block">
            <span className="label">Service account key</span>
            <div className="flex h-9 items-center text-[12.5px] text-n-600">
              {data?.hasKey
                ? <span>Held{data.clientEmail ? <> for <span className="mono text-n-800">{data.clientEmail}</span></> : null}{data.keyId ? <span className="text-n-400"> · key {data.keyId.slice(0, 8)}…</span> : null}</span>
                : <span className="text-n-500">None yet — paste the JSON key below.</span>}
            </div>
          </div>
        </div>

        <label className="mt-4 block">
          <span className="label">{data?.hasKey ? 'Replace the key' : 'Paste the JSON key file'}</span>
          <textarea
            className="input h-28 py-2 font-mono text-[12px]"
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
            className="btn btn-primary"
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
        <div className="mb-1 text-[13px] font-semibold text-n-800">Who is emailed when a customer files a shipment</div>
        <p className="mb-3 text-[12px] text-n-500">
          Everyone who can fulfil shipments sees it in their notifications. These are the people who are also emailed.
        </p>
        <div className="mb-1.5 text-[12px] font-medium text-n-600">A platform user</div>
        <div className="max-w-[360px]">
          <Select
            searchable
            disabled={readOnly || setAlertUser.isPending}
            value={platform.data?.logisticsAlertUserId ?? ''}
            onChange={(v) => setAlertUser.mutate(v || null)}
            options={[
              { value: '', label: 'Nobody — notifications only' },
              ...(staff.data ?? []).filter((u) => u.status === 'active').map((u) => ({ value: u.id, label: `${u.fullName} (${u.email})` })),
            ]}
          />
        </div>
        <div className="mt-5 border-t border-n-100 pt-4">
          <div className="mb-1 text-[13px] font-semibold text-n-800">Anyone else</div>
          <p className="mb-3 text-[12px] text-n-500">
            Plain addresses, for people with no platform login — a shared operations mailbox, a colleague at the other
            company. Each gets their own copy, so nobody's address is shown to the rest.
          </p>

          <div className="flex max-w-[420px] flex-col gap-2">
            {extras.map((address, i) => (
              <div key={i} className="flex gap-2">
                <input
                  className="input"
                  type="email"
                  value={address}
                  disabled={readOnly}
                  placeholder="shipments@example.com"
                  onChange={(e) => editExtras(extras.map((a, idx) => (idx === i ? e.target.value : a)))}
                />
                <button
                  type="button"
                  className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-md text-n-500 hover:bg-danger-bg hover:text-danger disabled:opacity-40"
                  title="Remove"
                  disabled={readOnly}
                  onClick={() => editExtras(extras.filter((_, idx) => idx !== i))}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}

            <div className="flex items-center gap-3">
              <button type="button" className="btn btn-ghost" disabled={readOnly} onClick={() => editExtras([...extras, ''])}>
                <Plus size={16} /> Add an address
              </button>
              {extrasDirty && (
                <>
                  <button type="button" className="btn btn-primary" disabled={saveExtras.isPending} onClick={() => saveExtras.mutate()}>
                    {saveExtras.isPending ? 'Saving…' : 'Save addresses'}
                  </button>
                  <button
                    type="button"
                    className="text-[12.5px] font-medium text-n-600 hover:underline"
                    onClick={() => { setExtrasDirty(false); setExtras(platform.data?.logisticsAlertEmails ?? []); }}
                  >
                    Discard
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {!data?.enabled && (
          <p className="mt-4 text-[12px] text-orange-800">Sending is off, so nothing is emailed until it is switched on above.</p>
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
