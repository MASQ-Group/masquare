import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import { Select, TableScroll } from '@masquare/ui';
import { customersApi, type LogisticsCustomer } from '../lib/api';
import { useAccess } from '../lib/useAccess';
import { useConfirm } from '../components/ConfirmProvider';
import { PageHeader } from '../components/common/PageHeader';
import { CustomerModal } from '../components/customers/CustomerModal';

/**
 * The companies we provide logistics services to.
 *
 * Kept apart from our own companies and from vendors because it is neither: a customer is the tenant
 * of the portal their people sign in to, and the row is what every shipment they file hangs off.
 */
export function LogisticsCustomersPage() {
  const qc = useQueryClient();
  const { canEdit } = useAccess();
  const confirm = useConfirm();
  const [q, setQ] = useState('');
  const [active, setActive] = useState('');
  const [editing, setEditing] = useState<LogisticsCustomer | null>(null);
  const [creating, setCreating] = useState(false);

  const query = useQuery({
    queryKey: ['customers', { q, active }],
    queryFn: () => customersApi.list({ q: q.trim() || undefined, active: active || undefined }),
    placeholderData: (prev) => prev,
  });
  const rows = query.data ?? [];

  const remove = useMutation({
    mutationFn: (id: string) => customersApi.remove(id),
    onSuccess: () => { toast.success('Customer removed'); qc.invalidateQueries({ queryKey: ['customers'] }); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not remove'),
  });


  return (
    <div className="w-full">
      <PageHeader
        module="Logistics"
        title="Logistics customers"
        info="The companies we ship for. Each one has its own reference prefix and its own people."
      />

      {creating && <CustomerModal customer={null} onClose={() => setCreating(false)} />}
      {editing && <CustomerModal customer={editing} onClose={() => setEditing(null)} />}

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-n-100 px-4 py-2.5">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, VAT or prefix…"
            className="h-8 w-56 rounded-md border border-n-200 px-2.5 text-[12.5px] outline-none focus:border-teal-400"
          />
          <div className="w-[150px]">
            <Select dense value={active} onChange={setActive} options={[{ value: '', label: 'All customers' }, { value: 'true', label: 'Active' }, { value: 'false', label: 'Inactive' }]} />
          </div>
          <div className="flex-1" />
          <span className="text-[12px] text-n-500">{rows.length} customer{rows.length === 1 ? '' : 's'}</span>
          {canEdit('logistics_customers') && (
            <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
              <Plus size={13} className="mr-1 inline" />New customer
            </button>
          )}
        </div>

        <TableScroll>
          <table className="w-full text-[12.5px]">
            <thead className="text-left text-[11px] uppercase tracking-wide text-n-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Customer</th>
                <th className="px-3 py-2 font-semibold">Prefix</th>
                <th className="px-3 py-2 font-semibold">Next reference</th>
                <th className="px-3 py-2 font-semibold">VAT</th>
                <th className="px-3 py-2 font-semibold">Served by</th>
                <th className="px-3 py-2 font-semibold">Contact</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {query.isLoading ? (
                <tr><td colSpan={8} className="px-4 py-6 text-center text-n-500">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-n-500">
                    {q || active ? 'No customer matches that.' : 'No logistics customers yet. Add the first one to give them a reference prefix and, later, a login.'}
                  </td>
                </tr>
              ) : (
                rows.map((c) => {
                  const contact = c.contactPersons[0];
                  return (
                    <tr key={c.id} className="cursor-pointer border-t border-n-100 hover:bg-n-25" onClick={() => setEditing(c)}>
                      <td className="px-4 py-1.5">
                        <span className="font-medium text-n-800">{c.name}</span>
                        {c.legalName && c.legalName !== c.name && <span className="ml-1.5 text-[11.5px] text-n-500">{c.legalName}</span>}
                      </td>
                      <td className="px-3 py-1.5 mono font-semibold text-n-700">{c.referencePrefix}</td>
                      <td className="px-3 py-1.5 mono text-n-600">{c.nextReference}</td>
                      <td className="px-3 py-1.5 mono text-n-600">{c.vatNumber ?? '—'}</td>
                      <td className="px-3 py-1.5 text-n-600">{c.company?.officialName ?? <span className="text-orange-700">not set</span>}</td>
                      <td className="px-3 py-1.5 text-n-600">
                        {contact ? [contact.name, contact.surname].filter(Boolean).join(' ') : c.email ?? '—'}
                        {c.contactPersons.length > 1 && <span className="ml-1 text-n-400">+{c.contactPersons.length - 1}</span>}
                      </td>
                      <td className="px-3 py-1.5">
                        <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-semibold ${c.active ? 'border-teal-200 bg-teal-50 text-teal-700' : 'border-n-200 bg-n-100 text-n-600'}`}>
                          {c.active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-right" onClick={(e) => e.stopPropagation()}>
                        {canEdit('logistics_customers') && (
                          <button
                            type="button"
                            className="text-n-400 hover:text-danger"
                            title="Remove"
                            onClick={async () => {
                              const ok = await confirm({
                                title: `Remove ${c.name}?`,
                                message: 'Their shipments and charges stay — this only stops them being used.',
                                confirmLabel: 'Remove',
                                tone: 'danger',
                              });
                              if (ok) remove.mutate(c.id);
                            }}
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </TableScroll>
      </div>
    </div>
  );
}
