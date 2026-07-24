import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Ban, ChevronLeft, ChevronRight, Pencil, Plus, Search, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { DatePicker, ModalShell, MonthPicker, Select, SmartReferenceInput, type ReferenceOption } from '@masquare/ui';
import { expenseCategoriesApi, expenseDefinitionsApi, expensesApi, expenseTagsApi, type AmountScope, type Expense, type ExpenseCategoryNode, type ExpenseMonthRow, type ExpenseOccurrence } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { usePersistentState } from '../../lib/usePersistentState';
import { CurrencySelect } from '../../components/common/CurrencySelect';
import { ExpenseImportModal } from './ExpenseImportModal';

const eur = (v: number | null | undefined) =>
  v == null ? '—' : new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(v);
const OCCURRENCE_LABEL: Record<ExpenseOccurrence, string> = { monthly: 'Monthly', annual: 'Annual', once_off: 'Once-off' };
const OCCURRENCE_TONE: Record<ExpenseOccurrence, string> = {
  monthly: 'border-teal-100 bg-teal-50 text-teal-700',
  annual: 'border-info-bd bg-info-bg text-info',
  once_off: 'border-n-200 bg-n-50 text-n-500',
};
const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const prettyMonth = (m: string | null) => (m ? new Date(`${m}-01T00:00:00`).toLocaleDateString('en-IE', { month: 'short', year: 'numeric' }) : '—');
const prettyDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IE', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

function flattenCats(tree: ExpenseCategoryNode[]): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const walk = (nodes: ExpenseCategoryNode[]) => { for (const n of nodes) { out.push({ value: n.id, label: `${'  '.repeat(n.depth)}${n.name}` }); walk(n.children); } };
  walk(tree);
  return out;
}
function activeInMonth(e: Expense, m: string): boolean {
  if (e.occurrence === 'once_off') return (e.onceOffDate ?? e.startMonth).slice(0, 7) === m;
  if (m < e.startMonth) return false;
  if (e.endMonth && m > e.endMonth) return false;
  return true;
}
function activeInYear(e: Expense, y: string): boolean {
  if (e.occurrence === 'once_off') return (e.onceOffDate ?? e.startMonth).slice(0, 4) === y;
  if (e.startMonth > `${y}-12`) return false;
  if (e.endMonth && e.endMonth < `${y}-01`) return false;
  return true;
}

export function ExpensesPage() {
  const qc = useQueryClient();
  const { activeCompanyId } = useAuth();
  const [view, setView] = usePersistentState<'registered' | 'ledger'>('expenses.view', 'registered');
  const [showCancelled, setShowCancelled] = usePersistentState('expenses.showCancelled', false);
  const [modalOpen, setModalOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editExpense, setEditExpense] = useState<Expense | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<Expense | null>(null);
  // Report filters
  const [q, setQ] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [monthFilter, setMonthFilter] = useState('');
  const [yearFilter, setYearFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [sortDir, setSortDir] = useState<1 | -1>(-1);

  const { data: expenses = [], isLoading } = useQuery({
    queryKey: ['expenses', activeCompanyId, showCancelled],
    queryFn: () => expensesApi.list({ companyId: activeCompanyId || undefined, includeCancelled: showCancelled }),
  });
  const { data: catTree = [] } = useQuery({ queryKey: ['expense-categories', 'tree'], queryFn: () => expenseCategoriesApi.tree() });
  const catOptions = useMemo(() => flattenCats(catTree), [catTree]);
  const { data: tags = [] } = useQuery({ queryKey: ['expense-tags'], queryFn: () => expenseTagsApi.list() });
  const tagOptions = useMemo(() => tags.map((t) => ({ value: t.id, label: t.group ? `${t.group} · ${t.name}` : t.name })), [tags]);
  const yearOptions = useMemo(() => {
    const yrs = new Set<string>();
    for (const e of expenses) yrs.add(e.startMonth.slice(0, 4));
    yrs.add(String(new Date().getFullYear()));
    return [...yrs].sort((a, b) => Number(b) - Number(a));
  }, [expenses]);
  const invalidate = () => qc.invalidateQueries({ queryKey: ['expenses'] });

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const dateOf = (e: Expense) => e.registeredAt ?? '';
    const filtered = expenses.filter((e) =>
      (!term || e.definitionName.toLowerCase().includes(term) || (e.definitionCode ?? '').toLowerCase().includes(term)) &&
      (!typeFilter || e.occurrence === typeFilter) &&
      (!categoryFilter || e.categoryId === categoryFilter) &&
      (!monthFilter || activeInMonth(e, monthFilter)) &&
      (!yearFilter || activeInYear(e, yearFilter)) &&
      (!tagFilter || e.tagId === tagFilter),
    );
    return filtered.sort((a, b) => (dateOf(a) < dateOf(b) ? -1 : dateOf(a) > dateOf(b) ? 1 : 0) * sortDir);
  }, [expenses, q, typeFilter, categoryFilter, monthFilter, yearFilter, tagFilter, sortDir]);
  const hasFilters = !!(q || typeFilter || categoryFilter || monthFilter || yearFilter || tagFilter);

  const cancel = useMutation({
    mutationFn: (id: string) => expensesApi.cancel(id),
    onSuccess: () => { toast.success('Expense cancelled — it stops after this month'); setConfirmCancel(null); invalidate(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not cancel'),
  });

  const th = 'border-b border-n-200 bg-n-25 px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-n-500 whitespace-nowrap';
  const td = 'border-b border-n-100 px-4 py-2.5 text-[13px] text-n-700';

  return (
    <div className="w-full">
      <div className="mb-5 flex items-start gap-4">
        <div className="flex-1">
          <h1 className="text-[22px] font-bold tracking-tight text-n-900">Expenses</h1>
          <p className="mt-1 text-[13px] text-n-500">Company operating expenses (COGS lives in Purchase Orders). Recurring expenses accrue every month until cancelled.</p>
        </div>
        <button
          onClick={() => setImportOpen(true)}
          disabled={!activeCompanyId}
          title={activeCompanyId ? 'Bulk-register expenses from a spreadsheet' : 'Select an active company first'}
          className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md border border-n-200 bg-n-0 px-3.5 text-[13px] font-semibold text-n-700 hover:border-n-300 disabled:opacity-50"
        >
          <Upload size={15} /> Import
        </button>
        <button
          onClick={() => setModalOpen(true)}
          disabled={!activeCompanyId}
          title={activeCompanyId ? undefined : 'Select an active company first'}
          className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md bg-teal-500 px-3.5 text-[13px] font-semibold text-white hover:bg-teal-600 disabled:opacity-50"
        >
          <Plus size={15} /> Register expense
        </button>
      </div>

      <div className="mb-4 flex items-center gap-2 border-b border-n-200">
        {([['registered', 'Registered'], ['ledger', 'Monthly ledger']] as const).map(([key, label]) => (
          <button key={key} onClick={() => setView(key)}
            className={`-mb-px border-b-2 px-3 py-2 text-[13px] font-semibold transition ${view === key ? 'border-teal-500 text-teal-700' : 'border-transparent text-n-500 hover:text-n-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {view === 'ledger' && (activeCompanyId
        ? <MonthlyLedger companyId={activeCompanyId} />
        : <div className="card p-10 text-center text-[13px] text-n-500">Select an active company to view its monthly ledger.</div>)}

      {view === 'registered' && (<>
      <div className="mb-3 flex flex-wrap items-center gap-2.5">
        <div className="flex h-9 min-w-[200px] max-w-[280px] flex-1 items-center gap-2 rounded-md border border-n-200 bg-n-50 px-3">
          <Search size={15} className="text-n-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search expenses…" className="flex-1 bg-transparent text-[13px] text-n-900 outline-none placeholder:text-n-400" />
        </div>
        <Select dense className="w-36" value={typeFilter} onChange={setTypeFilter} options={[{ value: '', label: 'All types' }, { value: 'monthly', label: 'Monthly' }, { value: 'annual', label: 'Annual' }, { value: 'once_off', label: 'Once-off' }]} />
        <Select dense className="w-48" value={categoryFilter} onChange={setCategoryFilter} options={[{ value: '', label: 'All categories' }, ...catOptions]} />
        <div className="w-[150px]"><MonthPicker value={monthFilter} onChange={setMonthFilter} dense clearable placeholder="Any month" /></div>
        <Select dense className="w-28" value={yearFilter} onChange={setYearFilter} options={[{ value: '', label: 'Any year' }, ...yearOptions.map((y) => ({ value: y, label: y }))]} />
        {tagOptions.length > 0 && <Select dense className="w-48" value={tagFilter} onChange={setTagFilter} options={[{ value: '', label: 'All tags' }, ...tagOptions]} />}
        {hasFilters && <button onClick={() => { setQ(''); setTypeFilter(''); setCategoryFilter(''); setMonthFilter(''); setYearFilter(''); setTagFilter(''); }} className="text-[12.5px] font-semibold text-n-500 hover:text-n-700">Reset</button>}
        <label className="ml-auto flex cursor-pointer items-center gap-2 text-[12.5px] text-n-600">
          <input type="checkbox" className="h-3.5 w-3.5 accent-[var(--teal-500)]" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} /> Show cancelled
        </label>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-n-100 px-4 py-2.5 text-[12px] text-n-500">{rows.length} expense{rows.length === 1 ? '' : 's'}</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse">
            <thead>
              <tr>
                <th className={`${th} text-left`}>Expense</th>
                <th className={`${th} text-left`}>Category</th>
                <th className={`${th} text-left`}>Tag</th>
                <th className={`${th} text-left`}>Type</th>
                <th className={`${th} text-right`}>Amount</th>
                <th className={`${th} text-right`}>Per month (€)</th>
                <th className={`${th} text-right`}>Per year (€)</th>
                <th className={`${th} cursor-pointer select-none text-left hover:text-n-800`} onClick={() => setSortDir((d) => (d === 1 ? -1 : 1))}>
                  <span className="inline-flex items-center gap-0.5">Date {sortDir === 1 ? <ArrowUp size={11} /> : <ArrowDown size={11} />}</span>
                </th>
                <th className={`${th} text-left`}>Status</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td className={td} colSpan={10}>Loading…</td></tr>}
              {!isLoading && rows.length === 0 && <tr><td className={`${td} py-10 text-center text-n-400`} colSpan={10}>{hasFilters ? 'No expenses match these filters.' : 'No expenses registered yet.'}</td></tr>}
              {rows.map((e) => (
                <tr key={e.id} className={`group hover:bg-n-25 ${e.status === 'cancelled' ? 'opacity-60' : ''}`}>
                  <td className={td}>
                    <div className="font-semibold text-n-800">{e.definitionName}</div>
                    {e.definitionCode && <div className="code mt-0.5 text-[11px] text-n-400">{e.definitionCode}</div>}
                  </td>
                  <td className={td}>{e.categoryName ?? <span className="text-n-300">—</span>}</td>
                  <td className={td}>{e.tagName
                    ? <span className="tag border border-n-200 bg-n-50 text-n-600">{e.tagGroup ? <span className="text-n-400">{e.tagGroup} · </span> : null}{e.tagName}</span>
                    : <span className="text-n-300">—</span>}</td>
                  <td className={td}><span className={`tag border ${OCCURRENCE_TONE[e.occurrence]}`}>{OCCURRENCE_LABEL[e.occurrence]}</span></td>
                  <td className={`${td} mono text-right`}>
                    <div className="text-n-800">{e.currency === 'EUR' ? eur(e.currentAmountEur) : `${new Intl.NumberFormat('en-IE', { maximumFractionDigits: 2 }).format(e.currentAmount)} ${e.currency}`}</div>
                    {e.currency !== 'EUR' && <div className="text-[11px] text-n-400">{eur(e.currentAmountEur)}</div>}
                  </td>
                  <td className={`${td} mono text-right text-n-700`}>{eur(e.monthlyEur)}</td>
                  <td className={`${td} mono text-right text-n-700`}>{eur(e.annualEur)}</td>
                  <td className={`${td} whitespace-nowrap`}>{prettyDate(e.registeredAt)}</td>
                  <td className={td}>
                    {e.status === 'cancelled'
                      ? <span className="tag border border-n-200 bg-n-50 text-n-500">Cancelled {prettyMonth(e.endMonth)}</span>
                      : <span className="tag border border-teal-100 bg-teal-50 text-teal-700">Active</span>}
                  </td>
                  <td className={`${td} text-right`}>
                    <div className="flex justify-end gap-1 opacity-0 transition group-hover:opacity-100">
                      <button title="Edit" onClick={() => setEditExpense(e)}
                        className="grid h-7 w-7 place-items-center rounded-md border border-n-200 bg-n-0 text-n-500 transition hover:text-n-700">
                        <Pencil size={14} />
                      </button>
                      {e.status === 'active' && e.occurrence !== 'once_off' && (
                        <button title="Cancel" onClick={() => setConfirmCancel(e)}
                          className="grid h-7 w-7 place-items-center rounded-md border border-n-200 bg-n-0 text-n-500 transition hover:border-danger-bd hover:text-danger">
                          <Ban size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      </>)}

      {modalOpen && activeCompanyId && (
        <RegisterExpenseModal companyId={activeCompanyId} onClose={() => setModalOpen(false)} onSaved={() => { setModalOpen(false); invalidate(); }} />
      )}
      {editExpense && activeCompanyId && (
        <RegisterExpenseModal companyId={activeCompanyId} expense={editExpense} onClose={() => setEditExpense(null)} onSaved={() => { setEditExpense(null); invalidate(); }} />
      )}
      {importOpen && activeCompanyId && (
        <ExpenseImportModal companyId={activeCompanyId} onClose={() => setImportOpen(false)} onDone={() => { setImportOpen(false); invalidate(); qc.invalidateQueries({ queryKey: ['expense-definitions'] }); qc.invalidateQueries({ queryKey: ['expense-categories'] }); qc.invalidateQueries({ queryKey: ['expense-tags'] }); }} />
      )}
      {confirmCancel && (
        <ModalShell open title="Cancel expense" subtitle={confirmCancel.definitionName} primaryLabel={cancel.isPending ? 'Cancelling…' : 'Cancel expense'} busy={cancel.isPending}
          onPrimary={() => cancel.mutate(confirmCancel.id)} onClose={() => setConfirmCancel(null)}>
          <p className="text-[13px] text-n-700">Stop “{confirmCancel.definitionName}” from {prettyMonth(thisMonth())} onward? Months already counted stay in the record; it simply won't accrue in future months.</p>
        </ModalShell>
      )}
    </div>
  );
}

const nativeFmt = (v: number, currency: string) =>
  currency === 'EUR' ? eur(v) : `${new Intl.NumberFormat('en-IE', { maximumFractionDigits: 2 }).format(v)} ${currency}`;

function MonthlyLedger({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const [month, setMonth] = useState(thisMonth());
  const [editRow, setEditRow] = useState<ExpenseMonthRow | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['expenses', 'monthly', companyId, month], queryFn: () => expensesApi.monthly(month, companyId) });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['expenses'] });
  const shift = (delta: number) => { const [y, m] = month.split('-').map(Number); const d = new Date(y, m - 1 + delta, 1); setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); };

  const th = 'border-b border-n-200 bg-n-25 px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-n-500 whitespace-nowrap';
  const td = 'border-b border-n-100 px-4 py-2.5 text-[13px] text-n-700';
  const items = data?.items ?? [];

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <button onClick={() => shift(-1)} className="grid h-9 w-9 place-items-center rounded-md border border-n-200 bg-n-0 text-n-600 hover:bg-n-50"><ChevronLeft size={16} /></button>
        <div className="w-[150px]"><MonthPicker value={month} onChange={setMonth} dense /></div>
        <button onClick={() => shift(1)} className="grid h-9 w-9 place-items-center rounded-md border border-n-200 bg-n-0 text-n-600 hover:bg-n-50"><ChevronRight size={16} /></button>
        <div className="ml-auto text-right">
          <div className="text-[11px] uppercase tracking-wide text-n-400">Total this month</div>
          <div className="mono text-[18px] font-bold text-n-900">{eur(data?.totalEur ?? 0)}</div>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-n-100 px-4 py-2.5 text-[12px] text-n-500">{items.length} expense{items.length === 1 ? '' : 's'} in {prettyMonth(month)}</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse">
            <thead>
              <tr>
                <th className={`${th} text-left`}>Expense</th>
                <th className={`${th} text-left`}>Category</th>
                <th className={`${th} text-left`}>Type</th>
                <th className={`${th} text-right`}>Amount</th>
                <th className={`${th} text-right`}>This month (€)</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td className={td} colSpan={6}>Loading…</td></tr>}
              {!isLoading && items.length === 0 && <tr><td className={`${td} py-10 text-center text-n-400`} colSpan={6}>No expenses in {prettyMonth(month)}.</td></tr>}
              {items.map((r) => (
                <tr key={r.expenseId} className="group hover:bg-n-25">
                  <td className={td}>
                    <div className="font-semibold text-n-800">{r.definitionName}</div>
                    {r.definitionCode && <div className="code mt-0.5 text-[11px] text-n-400">{r.definitionCode}</div>}
                  </td>
                  <td className={td}>{r.categoryName ?? <span className="text-n-300">—</span>}</td>
                  <td className={td}><span className={`tag border ${OCCURRENCE_TONE[r.occurrence]}`}>{OCCURRENCE_LABEL[r.occurrence]}</span></td>
                  <td className={`${td} mono text-right`}>
                    <div className="text-n-800">{nativeFmt(r.baseAmount, r.currency)}</div>
                    <div className="text-[11px] text-n-400">{r.occurrence === 'annual' ? '/yr' : r.occurrence === 'monthly' ? '/mo' : 'once'}</div>
                  </td>
                  <td className={`${td} mono text-right`}>
                    {eur(r.monthEur)}
                    {r.hasOverride && <span className="ml-1.5 rounded bg-warning-bg px-1.5 py-0.5 text-[10px] font-semibold text-warning">edited</span>}
                  </td>
                  <td className={`${td} text-right`}>
                    <button title="Edit amount" onClick={() => setEditRow(r)}
                      className="grid h-7 w-7 place-items-center rounded-md border border-n-200 bg-n-0 text-n-500 opacity-0 transition hover:bg-n-50 hover:text-n-700 group-hover:opacity-100"><Pencil size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editRow && <EditAmountModal row={editRow} month={month} onClose={() => setEditRow(null)} onSaved={() => { setEditRow(null); invalidate(); }} />}
    </div>
  );
}

function EditAmountModal({ row, month, onClose, onSaved }: { row: ExpenseMonthRow; month: string; onClose: () => void; onSaved: () => void }) {
  const [amount, setAmount] = useState(String(row.baseAmount));
  const [scope, setScope] = useState<AmountScope>('all_following');
  const recurring = row.occurrence !== 'once_off';
  const label = row.occurrence === 'annual' ? 'Annual amount' : row.occurrence === 'monthly' ? 'Monthly amount' : 'Amount';

  const save = useMutation({
    mutationFn: () => expensesApi.setAmount(row.expenseId, { month, amount: Number(amount), scope: recurring ? scope : 'all_following' }),
    onSuccess: () => { toast.success('Amount updated'); onSaved(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not update amount'),
  });

  return (
    <ModalShell open title="Edit amount" subtitle={`${row.definitionName} · ${prettyMonth(month)}`} primaryLabel={save.isPending ? 'Saving…' : 'Save'}
      busy={save.isPending} primaryDisabled={amount === '' || Number(amount) < 0} onPrimary={() => save.mutate()} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div>
          <label className="label">{label} <span className="font-normal text-n-400">({row.currency})</span></label>
          <input autoFocus type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="input" />
          {row.occurrence === 'annual' && <p className="mt-1 text-[11.5px] text-n-400">This is the yearly figure — it's amortised to 1/12 per month.</p>}
        </div>
        {recurring && (
          <div>
            <label className="label">Apply to</label>
            <div className="flex flex-col gap-2">
              {([['all_following', 'All following months', 'Changes this month and every month after.'], ['this_month', 'This month only', `A one-off override for ${prettyMonth(month)}; other months keep the current amount.`]] as const).map(([val, title, desc]) => (
                <label key={val} className={`flex cursor-pointer gap-2.5 rounded-lg border p-3 ${scope === val ? 'border-teal-400 bg-teal-50/50' : 'border-n-200 hover:bg-n-25'}`}>
                  <input type="radio" name="scope" className="mt-0.5 h-4 w-4 accent-[var(--teal-500)]" checked={scope === val} onChange={() => setScope(val)} />
                  <span>
                    <span className="block text-[13px] font-semibold text-n-800">{title}</span>
                    <span className="mt-0.5 block text-[12px] text-n-500">{desc}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
    </ModalShell>
  );
}

const todayIso = () => new Date().toISOString().slice(0, 10);

function RegisterExpenseModal({ companyId, expense, onClose, onSaved }: { companyId: string; expense?: Expense; onClose: () => void; onSaved: () => void }) {
  const editing = !!expense;
  // Structural fields (type / start date) are locked once the expense has scheduled amount
  // changes in the ledger, so that history is never silently discarded.
  const locked = expense?.hasSchedule ?? false;
  const [def, setDef] = useState<ReferenceOption | null>(
    expense ? { id: expense.definitionId, label: expense.definitionName, sub: expense.definitionCode ?? undefined } : null,
  );
  const [mode, setMode] = useState<'fixed' | 'once_off'>(expense?.occurrence === 'once_off' ? 'once_off' : 'fixed');
  const [occurrence, setOccurrence] = useState<'monthly' | 'annual'>(expense && expense.occurrence !== 'once_off' ? expense.occurrence : 'monthly');
  const [currency, setCurrency] = useState<string | null>(expense?.currency ?? 'EUR');
  const [amount, setAmount] = useState(expense ? String(expense.currentAmount) : '');
  const [startMonth, setStartMonth] = useState(expense && expense.occurrence !== 'once_off' ? expense.startMonth : thisMonth());
  const [onceOffDate, setOnceOffDate] = useState(expense?.onceOffDate ?? todayIso());
  const [note, setNote] = useState(expense?.note ?? '');
  const [tag, setTag] = useState<ReferenceOption | null>(
    expense?.tagId ? { id: expense.tagId, label: expense.tagName ?? '', sub: expense.tagGroup ?? undefined } : null,
  );

  const fetchDefs = async (q: string): Promise<ReferenceOption[]> => {
    const rows = await expenseDefinitionsApi.list({ q });
    return rows.map((d) => ({ id: d.id, label: d.name, sub: [d.code, d.categoryName].filter(Boolean).join(' · ') }));
  };

  const fetchTags = async (q: string): Promise<ReferenceOption[]> => {
    const rows = await expenseTagsApi.list({ q });
    return rows.map((t) => ({ id: t.id, label: t.name, sub: t.group ?? undefined }));
  };

  const pickDef = async (o: ReferenceOption) => {
    setDef(o);
    if (editing) return; // don't auto-flip an existing expense's type from the definition default
    const rows = await expenseDefinitionsApi.list({ q: o.label });
    const found = rows.find((d) => d.id === o.id) ?? null;
    if (found?.defaultOccurrence === 'once_off') setMode('once_off');
    else if (found?.defaultOccurrence) { setMode('fixed'); setOccurrence(found.defaultOccurrence); }
  };

  const amt = Number(amount);
  const onceOff = mode === 'once_off';
  const valid = !!def && amount !== '' && amt > 0 && (onceOff ? !!onceOffDate : !!startMonth);
  const fxNote = onceOff ? onceOffDate : startMonth;

  const save = useMutation({
    mutationFn: () => {
      const body = {
        definitionId: def!.id,
        occurrence: onceOff ? ('once_off' as const) : occurrence,
        currency: currency || 'EUR', amount: amt,
        ...(onceOff ? { onceOffDate } : { startMonth }),
        note: note.trim() || null,
        tagId: tag?.id ?? null,
      };
      return editing ? expensesApi.update(expense!.id, body) : expensesApi.create({ ...body, companyId });
    },
    onSuccess: () => { toast.success(editing ? 'Expense updated' : 'Expense registered'); onSaved(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? (editing ? 'Could not update expense' : 'Could not register expense')),
  });

  return (
    <ModalShell open title={editing ? 'Edit expense' : 'Register expense'} subtitle={onceOff ? 'Once-off — counted in the month of its date' : 'Recurring — accrues every month until cancelled'}
      primaryLabel={save.isPending ? 'Saving…' : editing ? 'Save' : 'Submit'} busy={save.isPending} primaryDisabled={!valid} onPrimary={() => save.mutate()} onClose={onClose}>
      <div className="flex flex-col gap-4">
        {locked && (
          <div className="rounded-md border border-info-bd bg-info-bg px-3 py-2 text-[12px] text-info">
            This expense has scheduled amount changes in the monthly ledger, so its type and start date are locked. Name, tag, note, currency and the starting amount can still be edited.
          </div>
        )}
        <div>
          <label className="label">Expense name</label>
          <SmartReferenceInput value={def}
            placeholder="Search an expense name…" fetchSuggestions={fetchDefs} onSelect={pickDef} onClear={() => setDef(null)} />
        </div>
        <div>
          <label className="label">Kind</label>
          <div className={`inline-flex rounded-md bg-n-100 p-[3px] ${locked ? 'opacity-50' : ''}`}>
            {([['fixed', 'Fixed (recurring)'], ['once_off', 'Once-off']] as const).map(([m, lbl]) => (
              <button key={m} disabled={locked} onClick={() => setMode(m)}
                className={`rounded-[6px] px-4 py-1.5 text-[13px] font-semibold transition-colors ${mode === m ? 'bg-n-0 text-n-900 shadow-sm' : 'text-n-500 hover:text-n-700'} ${locked ? 'cursor-not-allowed' : ''}`}>
                {lbl}
              </button>
            ))}
          </div>
        </div>
        {!onceOff && (
          <div>
            <label className="label">Type</label>
            <div className={`inline-flex rounded-md bg-n-100 p-[3px] ${locked ? 'opacity-50' : ''}`}>
              {(['monthly', 'annual'] as const).map((o) => (
                <button key={o} disabled={locked} onClick={() => setOccurrence(o)}
                  className={`rounded-[6px] px-4 py-1.5 text-[13px] font-semibold transition-colors ${occurrence === o ? 'bg-n-0 text-n-900 shadow-sm' : 'text-n-500 hover:text-n-700'} ${locked ? 'cursor-not-allowed' : ''}`}>
                  {o === 'monthly' ? 'Monthly' : 'Annual'}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[12px] text-n-400">{occurrence === 'monthly'
              ? 'The amount is counted in every month from the start month.'
              : 'The amount is the yearly cost — it is amortised to 1/12 per month.'}</p>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">{editing && expense!.hasSchedule ? 'Starting amount' : 'Amount'}</label>
            <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="input" />
            {editing && expense!.hasSchedule && <p className="mt-1 text-[11.5px] text-n-400">Later changes made in the monthly ledger are kept.</p>}
          </div>
          <div>
            <label className="label">Currency</label>
            <CurrencySelect value={currency} onChange={setCurrency} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {onceOff ? (
            <div>
              <label className="label">Date</label>
              <DatePicker value={onceOffDate} onChange={setOnceOffDate} disabled={locked} />
              <p className="mt-1 text-[11.5px] text-n-400">It lands in this date's month. Past dates are allowed.</p>
            </div>
          ) : (
            <div>
              <label className="label">Start month</label>
              <MonthPicker value={startMonth} onChange={setStartMonth} disabled={locked} />
              <p className="mt-1 text-[11.5px] text-n-400">Back-dating is allowed — pick a past month to apply it retroactively.</p>
            </div>
          )}
          {currency && currency !== 'EUR' && (
            <div className="self-end pb-1 text-[12px] text-n-400">Converted to EUR at the {fxNote} rate on save.</div>
          )}
        </div>
        <div>
          <label className="label">Tag <span className="font-normal text-n-400">(optional — track against a car, project, office…)</span></label>
          <SmartReferenceInput value={tag} placeholder="Search a tag…" fetchSuggestions={fetchTags} onSelect={setTag} onClear={() => setTag(null)} />
        </div>
        <div>
          <label className="label">Note <span className="font-normal text-n-400">(optional)</span></label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. supplier / reference" className="input" />
        </div>
      </div>
    </ModalShell>
  );
}
