import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { companiesApi, type Company } from '../lib/api';
import { PageHeader } from '../components/common/PageHeader';
import { useAuth } from '../lib/auth';
import { CompanyModal } from '../components/CompanyModal';

export function CompaniesPage() {
  const qc = useQueryClient();
  const { refresh } = useAuth();
  const [editing, setEditing] = useState<Company | null | undefined>(undefined); // undefined = closed

  const { data: companies = [], isLoading } = useQuery({
    queryKey: ['companies'],
    queryFn: companiesApi.list,
  });

  const removeMut = useMutation({
    mutationFn: (id: string) => companiesApi.remove(id),
    onSuccess: async () => {
      toast.success('Company removed');
      await qc.invalidateQueries({ queryKey: ['companies'] });
      await refresh();
    },
    onError: () => toast.error('Could not remove company'),
  });

  return (
    <div className="w-full">
      <PageHeader
        module="Setup"
        title="Companies"
        info="Registered entities, VAT registrations, and contacts."
        primary={<button className="hbtn-primary" onClick={() => setEditing(null)}><Plus size={16} /> Add company</button>}
      />

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse">
            <thead>
              <tr>
                {['Company', 'Country', 'VAT registrations', 'Contacts', ''].map((h) => (
                  <th
                    key={h}
                    className="border-b border-n-200 bg-n-25 px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-n-500"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-[13px] text-n-500">Loading…</td></tr>
              )}
              {!isLoading && companies.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-[13px] text-n-500">
                    No companies yet. Add your first company.
                  </td>
                </tr>
              )}
              {companies.map((c) => (
                <tr key={c.id} className="hover:bg-teal-50">
                  <td className="border-b border-n-100 px-4 py-3">
                    <div className="text-[13.5px] font-medium text-n-800">{c.officialName}</div>
                    {c.registrationNumber && (
                      <div className="mono text-[12px] text-n-500">{c.registrationNumber}</div>
                    )}
                  </td>
                  <td className="mono border-b border-n-100 px-4 py-3 text-[13px] text-n-700">
                    {c.addressCountry ?? '—'}
                  </td>
                  <td className="border-b border-n-100 px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {c.vatRegistrations.length === 0 && <span className="text-[13px] text-n-400">—</span>}
                      {c.vatRegistrations.map((v) => (
                        <span key={v.id} className="mono rounded bg-n-100 px-2 py-0.5 text-[11px] text-n-600">
                          {v.vatNumber}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="border-b border-n-100 px-4 py-3 text-[13px] text-n-700">
                    {c.contactPersons.length}
                  </td>
                  <td className="border-b border-n-100 px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <button
                        className="grid h-8 w-8 place-items-center rounded-md text-n-500 hover:bg-n-100 hover:text-n-800"
                        onClick={() => setEditing(c)}
                        title="Edit"
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        className="grid h-8 w-8 place-items-center rounded-md text-n-500 hover:bg-danger-bg hover:text-danger"
                        onClick={() => {
                          if (confirm(`Remove ${c.officialName}?`)) removeMut.mutate(c.id);
                        }}
                        title="Remove"
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

      {editing !== undefined && (
        <CompanyModal
          company={editing}
          onClose={() => setEditing(undefined)}
          onSaved={async () => {
            setEditing(undefined);
            await qc.invalidateQueries({ queryKey: ['companies'] });
            await refresh();
          }}
        />
      )}
    </div>
  );
}
