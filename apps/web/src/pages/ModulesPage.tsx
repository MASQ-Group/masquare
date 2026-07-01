import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { companiesApi, modulesApi, type ModuleCatalogItem } from '../lib/api';

export function ModulesPage() {
  const qc = useQueryClient();
  const { data: companies = [] } = useQuery({ queryKey: ['companies'], queryFn: companiesApi.list });
  const { data: modules = [], isLoading } = useQuery({ queryKey: ['modules'], queryFn: modulesApi.list });

  const setMut = useMutation({
    mutationFn: ({ key, companyIds }: { key: string; companyIds: string[] }) =>
      modulesApi.setParticipants(key, companyIds),
    onSuccess: async () => {
      toast.success('Module participation updated');
      await qc.invalidateQueries({ queryKey: ['modules'] });
    },
    onError: () => toast.error('Update failed'),
  });

  const toggle = (m: ModuleCatalogItem, companyId: string) => {
    const next = m.enabledCompanyIds.includes(companyId)
      ? m.enabledCompanyIds.filter((id) => id !== companyId)
      : [...m.enabledCompanyIds, companyId];
    setMut.mutate({ key: m.key, companyIds: next });
  };

  return (
    <div className="w-full">
      <div className="mb-5">
        <div className="eyebrow mb-1.5">Administration</div>
        <h1 className="text-[24px] font-semibold tracking-tight text-n-900">Modules &amp; sharing</h1>
        <p className="mt-1 text-[13.5px] text-n-500">
          Enable modules per company. Shareable modules (e.g. Products) co-own their records across every participating company.
        </p>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse">
            <thead>
              <tr>
                <th className="border-b border-n-200 bg-n-25 px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-n-500">
                  Module
                </th>
                {companies.map((c) => (
                  <th key={c.id} className="border-b border-n-200 bg-n-25 px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-n-500">
                    {c.officialName}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={companies.length + 1} className="px-4 py-8 text-center text-[13px] text-n-500">Loading…</td></tr>
              )}
              {modules.map((m) => (
                <tr key={m.key} className="hover:bg-teal-50">
                  <td className="border-b border-n-100 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-[13.5px] font-medium text-n-800">{m.name}</span>
                      {m.shareable && (
                        <span className="inline-flex items-center gap-1 rounded-pill bg-teal-50 px-2 py-0.5 text-[11px] font-semibold text-teal-700">
                          <Share2 size={12} /> shareable
                        </span>
                      )}
                      {m.isCore && (
                        <span className="rounded-pill bg-n-100 px-2 py-0.5 text-[11px] font-semibold text-n-600">core</span>
                      )}
                    </div>
                    <div className="mono mt-0.5 text-[11px] text-n-400">{m.key}</div>
                  </td>
                  {companies.map((c) => {
                    const enabled = m.enabledCompanyIds.includes(c.id);
                    return (
                      <td key={c.id} className="border-b border-n-100 px-4 py-3">
                        <label className="inline-flex cursor-pointer items-center gap-2">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-[var(--teal-500)]"
                            checked={enabled}
                            disabled={m.isCore || setMut.isPending}
                            onChange={() => toggle(m, c.id)}
                          />
                          <span className="text-[12.5px] text-n-500">{enabled ? 'Enabled' : 'Off'}</span>
                        </label>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="mt-3 text-[12px] text-n-400">Core modules are always on and cannot be disabled.</p>
    </div>
  );
}
