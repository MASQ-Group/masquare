import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Search, Trash2 } from 'lucide-react';
import { Select } from '@masquare/ui';
import { LOGISTICS_TYPE, customersApi, type Customer } from '../lib/api';
import { useAccess } from '../lib/useAccess';
import { useConfirm } from '../components/ConfirmProvider';
import { PageHeader } from '../components/common/PageHeader';
import { CustomerModal } from '../components/customers/CustomerModal';

/**
 * The companies we provide services to.
 *
 * One list for every kind of customer. What we do for each one is its types, shown as tags and
 * filterable, so a service added later is a new tag here rather than a new page somewhere else.
 */
export function CustomersPage() {
  const qc = useQueryClient();
  const { canEdit } = useAccess();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [active, setActive] = useState('');
  // The type filter lives in the URL, so "the logistics customers" is a link somebody can be sent.
  const type = params.get('type') ?? '';
  const setType = (v: string) => setParams((prev) => {
    const next = new URLSearchParams(prev);
    if (v) next.set('type', v); else next.delete('type');
    return next;
  }, { replace: true });
  const [editing, setEditing] = useState<Customer | null | undefined>(undefined); // undefined = closed

  const { data: types = [] } = useQuery({ queryKey: ['customers', 'types'], queryFn: customersApi.types });
  const typeLabel = (key: string) => types.find((t) => t.key === key)?.label ?? key;

  const query = useQuery({
    queryKey: ['customers', { q, active, type }],
    queryFn: () => customersApi.list({ q: q.trim() || undefined, active: active || undefined, type: type || undefined }),
    placeholderData: (prev) => prev,
  });
  const rows = query.data ?? [];
  const mayEdit = canEdit('customers');

  const remove = useMutation({
    mutationFn: (id: string) => customersApi.remove(id),
    onSuccess: () => { toast.success('Customer removed'); qc.invalidateQueries({ queryKey: ['customers'] }); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not remove the customer'),
  });

  const th = 'border-b border-n-200 bg-n-25 px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-n-500';
  const td = 'border-b border-n-100 px-4 py-3 text-[13px]';

  return (
    <div className="w-full">
      <PageHeader
        module="Customers"
        title="Customers"
        info="The companies we provide services to, what they take from us, and who at each may sign in."
        primary={mayEdit ? <button className="hbtn-primary" onClick={() => setEditing(null)}><Plus size={16} /> Add customer</button> : undefined}
        toolbar={
          <>
            <div className="flex h-8 flex-[0_1_300px] items-center gap-2 rounded-lg border border-n-200 bg-n-0 px-2.5 focus-within:border-teal-400">
              <Search size={15} className="text-n-400" />
              <input
                className="h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none"
                placeholder="Search name, VAT number or prefix…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <Select
              dense
              className="w-44"
              value={type}
              onChange={setType}
              options={[{ value: '', label: 'All types' }, ...types.map((t) => ({ value: t.key, label: t.label }))]}
            />
            <Select
              dense
              className="w-36"
              value={active}
              onChange={setActive}
              options={[{ value: '', label: 'Active & inactive' }, { value: 'true', label: 'Active' }, { value: 'false', label: 'Inactive' }]}
            />
          </>
        }
      />

      {editing !== undefined && <CustomerModal customer={editing} types={types} onClose={() => setEditing(undefined)} />}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse">
            <thead>
              <tr>
                <th className={th}>Customer</th>
                <th className={th}>Services</th>
                <th className={th}>VAT number</th>
                <th className={th}>Served by</th>
                <th className={th}>Contact</th>
                <th className={th}>Status</th>
                <th className={th}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {query.isLoading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-[13px] text-n-500">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-[13px] text-n-500">
                    {q || active || type ? 'No customer matches those filters.' : 'No customers yet. Add the first one, then choose the services they take from us.'}
                  </td>
                </tr>
              ) : (
                rows.map((c) => {
                  const contact = c.contactPersons[0];
                  return (
                    <tr key={c.id} className="cursor-pointer hover:bg-n-25" onClick={() => setEditing(c)}>
                      <td className={td}>
                        <div className="font-semibold text-n-800">{c.name}</div>
                        {c.legalName && c.legalName !== c.name && <div className="text-[12px] text-n-500">{c.legalName}</div>}
                      </td>
                      <td className={td}>
                        <div className="flex flex-wrap gap-1">
                          {c.types.length === 0 ? (
                            <span className="text-n-400">None yet</span>
                          ) : (
                            c.types.map((t) => (
                              <span key={t} className="tag bg-teal-50 text-teal-700">
                                {typeLabel(t)}
                                {/* The prefix is what a logistics customer is known by on every shipment. */}
                                {t === LOGISTICS_TYPE && c.referencePrefix && <span className="mono ml-1 opacity-75">{c.referencePrefix}</span>}
                              </span>
                            ))
                          )}
                        </div>
                      </td>
                      <td className={`${td} mono text-n-600`}>{c.vatNumber ?? '—'}</td>
                      <td className={`${td} text-n-600`}>{c.company?.officialName ?? '—'}</td>
                      <td className={`${td} text-n-600`}>
                        {contact ? [contact.name, contact.surname].filter(Boolean).join(' ') : c.email ?? '—'}
                        {c.contactPersons.length > 1 && <span className="ml-1 text-n-400">+{c.contactPersons.length - 1}</span>}
                      </td>
                      <td className={td}>
                        <span className={`tag ${c.active ? 'bg-teal-50 text-teal-700' : 'bg-n-100 text-n-600'}`}>{c.active ? 'Active' : 'Inactive'}</span>
                      </td>
                      <td className={`${td} text-right`} onClick={(e) => e.stopPropagation()}>
                        {mayEdit && (
                          <button
                            type="button"
                            className="hbtn-icon"
                            title={`Remove ${c.name}`}
                            aria-label={`Remove ${c.name}`}
                            onClick={async () => {
                              const ok = await confirm({
                                title: `Remove ${c.name}?`,
                                message: 'Their shipments, charges and history stay. This only stops them being used.',
                                confirmLabel: 'Remove',
                                tone: 'danger',
                              });
                              if (ok) remove.mutate(c.id);
                            }}
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
