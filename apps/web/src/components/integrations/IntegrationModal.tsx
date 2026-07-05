import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Download, KeyRound, ShieldCheck, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { ModalShell } from '@masquare/ui';
import { integrationsApi, salesChannelsApi, type ChannelIntegration, type ConnectorField } from '../../lib/api';
import { useAuth } from '../../lib/auth';

interface Props {
  integration?: ChannelIntegration; // editing when provided
  onClose: () => void;
  onSaved: () => void;
}

export function IntegrationModal({ integration, onClose, onSaved }: Props) {
  const editing = !!integration;
  const { user } = useAuth();
  const companies = user?.companies ?? [];
  const { data: connectors = [] } = useQuery({ queryKey: ['integration-connectors'], queryFn: () => integrationsApi.connectors() });
  const { data: channels = [] } = useQuery({ queryKey: ['sales-channels'], queryFn: () => salesChannelsApi.list(), enabled: editing });

  // Import settings (edit only).
  const [targetSalesChannelId, setTargetSalesChannelId] = useState(integration?.targetSalesChannelId ?? '');
  const [targetCompanyId, setTargetCompanyId] = useState(integration?.targetCompanyId ?? '');
  const [autoSync, setAutoSync] = useState(integration?.autoSyncEnabled ?? false);
  const [backfillDays, setBackfillDays] = useState(String(integration?.backfillDays ?? 30));

  const [channelType, setChannelType] = useState(integration?.channelType ?? '');
  const [marketplace, setMarketplace] = useState(integration?.marketplace ?? '');
  const connector = useMemo(() => connectors.find((c) => c.type === channelType), [connectors, channelType]);

  const [name, setName] = useState(integration?.name ?? '');
  const [nameEdited, setNameEdited] = useState(editing);
  const [config, setConfig] = useState<Record<string, string>>(integration?.config ?? {});
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testMode, setTestMode] = useState<'live' | 'test'>('test');
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const touch = () => setDirty(true);
  const setCfg = (k: string, v: string) => { setConfig((c) => ({ ...c, [k]: v })); touch(); };
  const setSecret = (k: string, v: string) => { setSecrets((s) => ({ ...s, [k]: v })); touch(); };

  // Suggest a name from the chosen marketplace (until the user edits it).
  useEffect(() => {
    if (nameEdited || !connector) return;
    const mkt = connector.marketplaces.find((m) => m.id === marketplace);
    setName(mkt?.label ?? connector.label);
  }, [connector, marketplace, nameEdited]);

  const secretState = (key: string) => integration?.secretFields.find((f) => f.fieldKey === key);
  const groups = useMemo(() => {
    const g = new Map<string, ConnectorField[]>();
    for (const f of connector?.fields ?? []) { const key = f.group ?? 'Details'; if (!g.has(key)) g.set(key, []); g.get(key)!.push(f); }
    return [...g.entries()];
  }, [connector]);

  const save = async () => {
    if (!connector) { toast.error('Pick a channel'); return; }
    if (connector.marketplaces.length > 0 && !marketplace) { toast.error('Pick a marketplace / sub-channel'); return; }
    if (!name.trim()) { toast.error('Name is required'); return; }
    const missing = connector.fields.filter((f) => f.required && !f.secret && !(config[f.key] ?? '').trim());
    if (missing.length) { toast.error(`Required: ${missing.map((m) => m.label).join(', ')}`); return; }
    setBusy(true);
    try {
      const secretsPayload = Object.fromEntries(Object.entries(secrets).filter(([, v]) => v.trim() !== ''));
      if (editing) {
        await integrationsApi.update(integration!.id, {
          name, marketplace: marketplace || null, config, secrets: secretsPayload,
          targetSalesChannelId: targetSalesChannelId || null, targetCompanyId: targetCompanyId || null,
          autoSyncEnabled: autoSync, backfillDays: Number(backfillDays) || 30,
        });
      } else {
        await integrationsApi.create({ name, channelType, marketplace: marketplace || null, config, secrets: secretsPayload });
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
      setTestResult(await integrationsApi.test(integration!.id, testMode));
    } catch (e: any) {
      setTestResult({ ok: false, message: e?.response?.data?.message ?? 'Test failed' });
    } finally {
      setBusy(false);
    }
  };

  const onlyTest = connector?.type === 'onbuy'; // OnBuy has live+test key sets

  return (
    <ModalShell
      open
      title={editing ? 'Edit integration' : 'Add channel integration'}
      subtitle={editing ? [integration!.connectorLabel, integration!.marketplaceLabel].filter(Boolean).join(' · ') : undefined}
      initialSize={{ w: 640, h: 660 }}
      dirty={dirty}
      primaryLabel={editing ? 'Save changes' : 'Create integration'}
      onPrimary={save}
      secondaryLabel={editing && connector?.testable ? 'Test connection' : undefined}
      onSecondary={editing && connector?.testable ? runTest : undefined}
      busy={busy}
      onClose={onClose}
    >
      <div className="flex flex-col gap-5">
        {/* Channel family + sub-channel */}
        <div className="grid grid-cols-2 gap-4 max-[520px]:grid-cols-1">
          <div>
            <label className="label">Sales channel</label>
            {editing ? (
              <input className="input" value={integration!.connectorLabel} disabled />
            ) : (
              <select className="input" value={channelType} onChange={(e) => { setChannelType(e.target.value); setMarketplace(''); touch(); }}>
                <option value="">Select…</option>
                {connectors.map((c) => <option key={c.type} value={c.type}>{c.label}</option>)}
              </select>
            )}
          </div>
          <div>
            <label className="label">Marketplace / sub-channel</label>
            <select
              className="input"
              value={marketplace}
              disabled={!connector || connector.marketplaces.length === 0}
              onChange={(e) => { setMarketplace(e.target.value); touch(); }}
            >
              <option value="">{connector ? 'Select…' : '—'}</option>
              {connector?.marketplaces.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
        </div>

        {connector && (
          <>
            <div>
              <label className="label">Integration name</label>
              <input className="input" value={name} onChange={(e) => { setName(e.target.value); setNameEdited(true); touch(); }} placeholder="e.g. Amazon UK — main store" />
            </div>

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
                          ) : f.type === 'select' ? (
                            <select className="input" value={config[f.key] ?? f.options?.[0]?.value ?? ''} onChange={(e) => setCfg(f.key, e.target.value)}>
                              {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
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

            {editing && (
              <div className="rounded-lg border border-n-200 p-3">
                <div className="mb-2.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-n-500">
                  <Download size={12} className="text-teal-600" /> Import settings
                </div>
                <div className="grid grid-cols-2 gap-3 max-[520px]:grid-cols-1">
                  <div>
                    <label className="label">Imported orders → sales channel</label>
                    <select className="input" value={targetSalesChannelId} onChange={(e) => { setTargetSalesChannelId(e.target.value); touch(); }}>
                      <option value="">Select…</option>
                      {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">Imported orders → company</label>
                    <select className="input" value={targetCompanyId} onChange={(e) => { setTargetCompanyId(e.target.value); touch(); }}>
                      <option value="">Select…</option>
                      {companies.map((c) => <option key={c.id} value={c.id}>{c.officialName}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">First-run backfill (days)</label>
                    <input className="input mono" inputMode="numeric" value={backfillDays} onChange={(e) => { setBackfillDays(e.target.value); touch(); }} />
                  </div>
                  <label className="flex cursor-pointer items-end gap-2.5 pb-2.5">
                    <input type="checkbox" className="h-4 w-4 accent-[var(--teal-500)]" checked={autoSync} onChange={(e) => { setAutoSync(e.target.checked); touch(); }} />
                    <span className="text-[13px] text-n-700">Automatic daily sync</span>
                  </label>
                </div>
                <p className="mt-1 text-[11px] text-n-400">Imported orders become draft transactions, deduped by order ID. Sync runs from the card once the mapping is verified.</p>
              </div>
            )}

            {editing && connector.testable && (
              <div className="flex flex-wrap items-center gap-3 rounded-md border border-n-200 bg-n-25 px-3 py-2.5">
                <span className="text-[12.5px] font-medium text-n-700">Test connection</span>
                {onlyTest && (
                  <select className="input h-8 w-28 text-[12.5px]" value={testMode} onChange={(e) => setTestMode(e.target.value as 'live' | 'test')}>
                    <option value="test">Test keys</option>
                    <option value="live">Live keys</option>
                  </select>
                )}
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
