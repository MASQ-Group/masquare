import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, KeyRound, ShieldCheck, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { ModalShell } from '@masquare/ui';
import { integrationsApi, type ChannelIntegration, type ConnectorField } from '../../lib/api';

interface Props {
  integration?: ChannelIntegration; // editing when provided
  onClose: () => void;
  onSaved: () => void;
}

export function IntegrationModal({ integration, onClose, onSaved }: Props) {
  const editing = !!integration;
  const { data: connectors = [] } = useQuery({ queryKey: ['integration-connectors'], queryFn: () => integrationsApi.connectors() });

  const [channelType, setChannelType] = useState(integration?.channelType ?? '');
  const connector = useMemo(() => connectors.find((c) => c.type === channelType) ?? (connectors.length === 1 ? connectors[0] : undefined), [connectors, channelType]);
  const effectiveType = channelType || connector?.type || '';

  const [name, setName] = useState(integration?.name ?? '');
  const [config, setConfig] = useState<Record<string, string>>(integration?.config ?? {});
  const [secrets, setSecrets] = useState<Record<string, string>>({}); // only what the user (re)enters
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testMode, setTestMode] = useState<'live' | 'test'>('test');
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const touch = () => setDirty(true);
  const setCfg = (k: string, v: string) => { setConfig((c) => ({ ...c, [k]: v })); touch(); };
  const setSecret = (k: string, v: string) => { setSecrets((s) => ({ ...s, [k]: v })); touch(); };

  const secretState = (key: string) => integration?.secretFields.find((f) => f.fieldKey === key);
  const groups = useMemo(() => {
    const g = new Map<string, ConnectorField[]>();
    for (const f of connector?.fields ?? []) { const key = f.group ?? 'Details'; if (!g.has(key)) g.set(key, []); g.get(key)!.push(f); }
    return [...g.entries()];
  }, [connector]);

  const save = async () => {
    if (!name.trim()) { toast.error('Name is required'); return; }
    if (!connector) { toast.error('Pick a channel'); return; }
    const missing = connector.fields.filter((f) => f.required && !f.secret && !(config[f.key] ?? '').trim());
    if (missing.length) { toast.error(`Required: ${missing.map((m) => m.label).join(', ')}`); return; }
    setBusy(true);
    try {
      // Only send secret fields the user actually typed — blanks leave stored keys untouched.
      const secretsPayload = Object.fromEntries(Object.entries(secrets).filter(([, v]) => v.trim() !== ''));
      if (editing) {
        await integrationsApi.update(integration!.id, { name, config, secrets: secretsPayload });
      } else {
        await integrationsApi.create({ name, channelType: effectiveType, config, secrets: secretsPayload });
      }
      toast.success(editing ? 'Integration updated' : 'Integration created');
      onSaved();
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const runTest = async () => {
    if (!editing) { toast.error('Save the integration first, then test.'); return; }
    setBusy(true);
    setTestResult(null);
    try {
      const res = await integrationsApi.test(integration!.id, testMode);
      setTestResult(res);
    } catch (e: any) {
      setTestResult({ ok: false, message: e?.response?.data?.message ?? 'Test failed' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      open
      title={editing ? 'Edit integration' : 'Add channel integration'}
      subtitle={editing ? integration!.connectorLabel : undefined}
      initialSize={{ w: 620, h: 640 }}
      dirty={dirty}
      primaryLabel={editing ? 'Save changes' : 'Create integration'}
      onPrimary={save}
      secondaryLabel={editing && connector?.testable ? 'Test connection' : undefined}
      onSecondary={editing && connector?.testable ? runTest : undefined}
      busy={busy}
      onClose={onClose}
    >
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-4 max-[520px]:grid-cols-1">
          <div>
            <label className="label">Integration name</label>
            <input className="input" value={name} onChange={(e) => { setName(e.target.value); touch(); }} placeholder="e.g. OnBuy — main store" />
          </div>
          <div>
            <label className="label">Channel</label>
            {editing ? (
              <input className="input" value={integration!.connectorLabel} disabled />
            ) : (
              <select className="input" value={effectiveType} onChange={(e) => { setChannelType(e.target.value); touch(); }}>
                <option value="">Select…</option>
                {connectors.map((c) => <option key={c.type} value={c.type}>{c.label}</option>)}
              </select>
            )}
          </div>
        </div>

        {connector && (
          <>
            {groups.map(([groupName, fields]) => {
              const hasSecret = fields.some((f) => f.secret);
              return (
                <div key={groupName} className="rounded-lg border border-n-200 p-3">
                  <div className="mb-2.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-n-500">
                    {hasSecret && <KeyRound size={12} className="text-teal-600" />}{groupName}
                  </div>
                  <div className="grid grid-cols-2 gap-3 max-[520px]:grid-cols-1">
                    {fields.map((f) => {
                      const st = f.secret ? secretState(f.key) : undefined;
                      return (
                        <div key={f.key}>
                          <label className="label">{f.label}{f.required && <span className="text-danger"> *</span>}</label>
                          {f.secret ? (
                            <>
                              <input
                                type="password"
                                autoComplete="new-password"
                                className="input mono"
                                value={secrets[f.key] ?? ''}
                                onChange={(e) => setSecret(f.key, e.target.value)}
                                placeholder={st?.set ? `•••• ${st.last4} · set — leave blank to keep` : 'Enter key'}
                              />
                              {st?.set && !secrets[f.key] && <p className="mt-1 text-[11px] text-n-400">Stored securely. Type a new value to replace it.</p>}
                            </>
                          ) : (
                            <input
                              className={`input ${f.type === 'url' ? 'mono' : ''}`}
                              value={config[f.key] ?? ''}
                              onChange={(e) => setCfg(f.key, e.target.value)}
                              placeholder={f.placeholder}
                            />
                          )}
                          {f.help && <p className="mt-1 text-[11px] text-n-400">{f.help}</p>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            <p className="flex items-start gap-2 rounded-md border border-info-bd bg-info-bg px-3 py-2 text-[12px] text-info">
              <ShieldCheck size={15} className="mt-0.5 shrink-0" />
              Keys are encrypted (AES-256-GCM) before storage and are never shown again or sent back to the browser. Enter a new value only to replace a stored key.
            </p>

            {editing && connector.testable && (
              <div className="flex flex-wrap items-center gap-3 rounded-md border border-n-200 bg-n-25 px-3 py-2.5">
                <span className="text-[12.5px] font-medium text-n-700">Test with</span>
                <select className="input h-8 w-28 text-[12.5px]" value={testMode} onChange={(e) => setTestMode(e.target.value as 'live' | 'test')}>
                  <option value="test">Test keys</option>
                  <option value="live">Live keys</option>
                </select>
                {testResult && (
                  <span className={`inline-flex items-center gap-1.5 text-[12.5px] font-medium ${testResult.ok ? 'text-success' : 'text-danger'}`}>
                    {testResult.ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />}{testResult.message}
                  </span>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </ModalShell>
  );
}
