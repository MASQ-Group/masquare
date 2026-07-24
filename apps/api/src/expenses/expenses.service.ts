import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ExpenseCategoriesService } from './expense-categories.service';
import { ExpenseDefinitionsService } from './expense-definitions.service';
import { ExpenseTagsService } from './expense-tags.service';
import { CancelExpenseDto, CreateExpenseDto, SetExpenseAmountDto, UpdateExpenseDto } from './dto/expense.dto';

const ACTIVE = { deletedAt: null };
const round = (v: number, d = 2) => Number(v.toFixed(d));
/** USD-pegged currencies converted via USD, matching the sales-transactions FX. */
const USD_PEG: Record<string, number> = { AED: 3.6725, SAR: 3.75 };

/** Current month as 'YYYY-MM' (UTC). */
function thisMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
const monthOf = (iso: string) => iso.slice(0, 7);
const firstDayOf = (month: string) => `${month}-01`;

/** Normalise a free-text 'Type' cell to an occurrence, tolerant of common spellings. */
function normOccurrence(v: string): 'monthly' | 'annual' | 'once_off' | null {
  const s = v.trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (['monthly', 'month', 'fixed', 'recurring'].includes(s)) return 'monthly';
  if (['annual', 'annually', 'yearly', 'year'].includes(s)) return 'annual';
  if (['onceoff', 'once', 'oneoff', 'onetime', 'single'].includes(s)) return 'once_off';
  return null;
}

/** Parse an import date cell → a UTC Date. Handles YYYY-MM, ISO, Excel serials and
 *  day-first dd/mm/yyyy (the platform default). null = empty, undefined = unparseable. */
function parseImportDate(v: string): Date | null | undefined {
  const s = v.trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}$/.test(s)) return new Date(`${s}-01T00:00:00Z`);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) { const d = new Date(`${s.slice(0, 10)}T00:00:00Z`); return isNaN(+d) ? undefined : d; }
  if (/^\d+(\.\d+)?$/.test(s)) { const n = Number(s); return n > 20000 && n < 90000 ? new Date(Math.round((n - 25569) * 86400000)) : undefined; }
  const parts = s.split(/[/.\-]/).map((p) => p.trim());
  if (parts.length === 3 && parts.every((p) => /^\d+$/.test(p))) {
    let [dd, mm, yy] = parts.map(Number);
    if (yy < 100) yy += 2000;
    const d = new Date(Date.UTC(yy, mm - 1, dd));
    return d.getUTCFullYear() === yy && d.getUTCMonth() === mm - 1 && d.getUTCDate() === dd ? d : undefined;
  }
  const d = new Date(s);
  return isNaN(+d) ? undefined : d;
}
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const monthOfDate = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly definitions: ExpenseDefinitionsService,
    private readonly categories: ExpenseCategoriesService,
    private readonly tags: ExpenseTagsService,
  ) {}

  // ---- FX (EUR per 1 unit of currency, at a date) — mirrors SalesTransactionsService ----

  private async frankfurterRate(currency: string, date: string): Promise<number | null> {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const d = date.slice(0, 10);
      const endpoint = d > today ? 'latest' : d;
      const res = await fetch(`https://api.frankfurter.dev/v1/${endpoint}?from=${currency}&to=EUR`, { signal: AbortSignal.timeout(6000) });
      const json: any = await res.json();
      return typeof json?.rates?.EUR === 'number' ? json.rates.EUR : null;
    } catch {
      return null;
    }
  }

  /** currency -> EUR multiplier at `date`. EUR is 1; pegged currencies go via USD. */
  private async eurRate(currency: string, date: string): Promise<number | null> {
    const cur = currency.toUpperCase();
    if (cur === 'EUR') return 1;
    const peg = USD_PEG[cur];
    if (peg) { const usdEur = await this.frankfurterRate('USD', date); return usdEur != null ? round(usdEur / peg, 6) : null; }
    const rate = await this.frankfurterRate(cur, date);
    return rate != null ? round(rate, 6) : null;
  }

  private async convert(amount: number, currency: string, date: string): Promise<{ amountEur: number; fxRate: number | null }> {
    const cur = (currency || 'EUR').toUpperCase();
    if (cur === 'EUR') return { amountEur: round(amount), fxRate: 1 };
    const rate = await this.eurRate(cur, date);
    if (rate == null) throw new BadRequestException(`Could not get an exchange rate for ${cur}. Enter the amount in EUR, or try again.`);
    return { amountEur: round(amount * rate), fxRate: rate };
  }

  // ---- create / list / get / cancel ----

  async create(dto: CreateExpenseDto, actorId?: string, allowedCompanyIds?: string[]) {
    const def = await this.prisma.expenseDefinition.findFirst({ where: { id: dto.definitionId, ...ACTIVE }, select: { id: true } });
    if (!def) throw new NotFoundException('Expense name not found');
    // Company isolation: an expense may only be booked against a company the user is granted.
    if (allowedCompanyIds && !allowedCompanyIds.includes(dto.companyId)) throw new ForbiddenException('You do not have access to that company.');
    const company = await this.prisma.company.findFirst({ where: { id: dto.companyId, ...ACTIVE }, select: { id: true } });
    if (!company) throw new NotFoundException('Company not found');

    const currency = (dto.currency || 'EUR').toUpperCase();
    const onceOff = dto.occurrence === 'once_off';
    if (onceOff && !dto.onceOffDate) throw new BadRequestException('A once-off expense needs a date');

    const startMonth = onceOff ? monthOf(dto.onceOffDate!) : dto.startMonth ?? thisMonth();
    const fxDate = onceOff ? dto.onceOffDate!.slice(0, 10) : firstDayOf(startMonth);
    const { amountEur, fxRate } = await this.convert(dto.amount, currency, fxDate);

    const expense = await this.prisma.expense.create({
      data: {
        definitionId: dto.definitionId,
        companyId: dto.companyId,
        occurrence: dto.occurrence,
        currency,
        startMonth,
        endMonth: null,
        onceOffDate: onceOff ? new Date(dto.onceOffDate!) : null,
        status: 'active',
        note: dto.note?.trim() || null,
        tagId: dto.tagId ?? null,
        createdById: actorId ?? null,
        updatedById: actorId ?? null,
        amounts: { create: { effectiveMonth: startMonth, amount: dto.amount, amountEur, fxRate } },
      },
    });
    return this.get(expense.id);
  }

  // ---- xlsx bulk import ---------------------------------------------------

  /** Preview import rows: resolve each expense name to a definition (or flag it will be
   *  created) and validate the type / amount / date / currency. Read-only. */
  async importValidate(rows: Record<string, string>[]) {
    const [defs, cats, tagRows] = await Promise.all([
      this.prisma.expenseDefinition.findMany({ where: ACTIVE, select: { id: true, name: true } }),
      this.prisma.expenseCategory.findMany({ where: ACTIVE, select: { id: true, name: true } }),
      this.prisma.expenseTag.findMany({ where: { deletedAt: null }, select: { id: true, name: true } }),
    ]);
    const defByName = new Map(defs.map((d) => [d.name.trim().toLowerCase(), d.id]));
    const catByName = new Map(cats.map((c) => [c.name.trim().toLowerCase(), c.id]));
    const tagByName = new Map(tagRows.map((t) => [t.name.trim().toLowerCase(), t.id]));

    const out = (rows ?? []).map((row, index) => {
      const get = (k: string) => (row?.[k] == null ? '' : String(row[k]).trim());
      const issues: { field: string; message: string; severity: 'error' | 'warning' }[] = [];
      const name = get('name');
      if (!name) issues.push({ field: 'name', message: 'Expense name is required', severity: 'error' });

      const occ = normOccurrence(get('type'));
      if (!occ) issues.push({ field: 'type', message: `Type must be Monthly, Annual or Once-off (got "${get('type')}")`, severity: 'error' });

      const amountStr = get('amount').replace(/[,\s]/g, '');
      const amount = Number(amountStr);
      if (amountStr === '' || !Number.isFinite(amount) || amount <= 0) issues.push({ field: 'amount', message: `Amount must be a positive number (got "${get('amount')}")`, severity: 'error' });

      const currency = (get('currency') || 'EUR').toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) issues.push({ field: 'currency', message: `Currency should be a 3-letter code (got "${get('currency')}") — defaulting to EUR`, severity: 'warning' });

      const dateCell = get('date');
      const parsed = parseImportDate(dateCell);
      if (parsed == null) issues.push({ field: 'date', message: occ === 'once_off' ? 'A once-off expense needs a date' : 'A start month (YYYY-MM) or date is required', severity: 'error' });
      else if (parsed === undefined) issues.push({ field: 'date', message: `Couldn't read the date "${dateCell}" — use YYYY-MM or YYYY-MM-DD`, severity: 'error' });

      const defId = defByName.get(name.toLowerCase()) ?? null;
      const catName = get('category');
      const catId = catName ? catByName.get(catName.toLowerCase()) ?? null : null;
      if (catName && !catId && defId) issues.push({ field: 'category', message: `Existing expense name keeps its own category — "${catName}" ignored`, severity: 'warning' });
      const tagName = get('tag');

      const hasError = issues.some((x) => x.severity === 'error');
      return {
        index, name, status: hasError ? 'error' : 'new', occurrence: occ,
        willCreateDefinition: !!name && !defId && !hasError,
        willCreateCategory: !!catName && !catId && !defId && !hasError,
        willCreateTag: !!tagName && !tagByName.get(tagName.toLowerCase()) && !hasError,
        issues,
      };
    });
    return { rows: out };
  }

  /** Commit import rows: resolve-or-create the expense name (its category and tag too), then
   *  register the expense. Rows still carrying a blocking error are skipped. */
  async importCommit(rows: Record<string, string>[], companyId: string, actorId?: string) {
    const company = await this.prisma.company.findFirst({ where: { id: companyId, ...ACTIVE }, select: { id: true } });
    if (!company) throw new NotFoundException('Company not found');

    // Caches refreshed as we create, so repeated names within one file collapse to one record.
    const defs = await this.prisma.expenseDefinition.findMany({ where: ACTIVE, select: { id: true, name: true } });
    const defByName = new Map(defs.map((d) => [d.name.trim().toLowerCase(), d.id as string]));
    const cats = await this.prisma.expenseCategory.findMany({ where: ACTIVE, select: { id: true, name: true } });
    const catByName = new Map(cats.map((c) => [c.name.trim().toLowerCase(), c.id as string]));
    const tagRows = await this.prisma.expenseTag.findMany({ where: { deletedAt: null }, select: { id: true, name: true } });
    const tagByName = new Map(tagRows.map((t) => [t.name.trim().toLowerCase(), t.id as string]));

    let created = 0;
    let skipped = 0;
    const errors: { name: string; message: string }[] = [];

    for (const row of rows ?? []) {
      const get = (k: string) => (row?.[k] == null ? '' : String(row[k]).trim());
      const name = get('name');
      try {
        const occ = normOccurrence(get('type'));
        const amount = Number(get('amount').replace(/[,\s]/g, ''));
        const parsed = parseImportDate(get('date'));
        if (!name || !occ || !Number.isFinite(amount) || amount <= 0 || !parsed) { skipped++; continue; }
        const rawCcy = (get('currency') || 'EUR').toUpperCase();
        const currency = /^[A-Z]{3}$/.test(rawCcy) ? rawCcy : 'EUR';

        let defId = defByName.get(name.toLowerCase());
        if (!defId) {
          const catName = get('category');
          let categoryId: string | undefined;
          if (catName) {
            categoryId = catByName.get(catName.toLowerCase());
            if (!categoryId) { const c = await this.categories.create({ name: catName }, actorId); categoryId = c.id; catByName.set(catName.toLowerCase(), c.id); }
          }
          const d = await this.definitions.create({ name, categoryId, defaultOccurrence: occ }, actorId);
          defId = d.id; defByName.set(name.toLowerCase(), d.id);
        }

        const tagName = get('tag');
        let tagId: string | null = null;
        if (tagName) {
          tagId = tagByName.get(tagName.toLowerCase()) ?? null;
          if (!tagId) { const t = await this.tags.create({ name: tagName }, actorId); tagId = t.id; tagByName.set(tagName.toLowerCase(), t.id); }
        }

        await this.create({
          definitionId: defId!, companyId, occurrence: occ, currency, amount,
          ...(occ === 'once_off' ? { onceOffDate: isoDate(parsed) } : { startMonth: monthOfDate(parsed) }),
          note: get('note') || null, tagId,
        }, actorId);
        created++;
      } catch (e: any) {
        errors.push({ name: name || '(unnamed)', message: (e?.message ?? 'Failed').toString().slice(0, 160) });
      }
    }
    return { created, skipped, errors };
  }

  async list(opts: { companyId?: string; companyIds?: string[]; includeCancelled?: boolean } = {}) {
    const rows = await this.prisma.expense.findMany({
      where: {
        ...ACTIVE,
        ...(opts.companyIds ? { companyId: { in: opts.companyIds } } : opts.companyId ? { companyId: opts.companyId } : {}),
        ...(opts.includeCancelled ? {} : { status: 'active' }),
      },
      include: {
        definition: { select: { code: true, name: true, categoryId: true, category: { select: { name: true } } } },
        tag: { select: { id: true, name: true, group: true } },
        amounts: { orderBy: { effectiveMonth: 'asc' } },
        overrides: true,
      },
      orderBy: { startMonth: 'desc' },
    });
    const now = thisMonth();
    return rows.map((e) => this.serialize(e, now));
  }

  async get(id: string, companyIds?: string[]) {
    const e = await this.prisma.expense.findFirst({
      where: { id, ...ACTIVE, ...(companyIds ? { companyId: { in: companyIds } } : {}) },
      include: {
        definition: { select: { code: true, name: true, categoryId: true, category: { select: { name: true } } } },
        tag: { select: { id: true, name: true, group: true } },
        amounts: { orderBy: { effectiveMonth: 'asc' } },
        overrides: true,
      },
    });
    if (!e) throw new NotFoundException('Expense not found');
    return this.serialize(e, thisMonth());
  }

  /** Cancel a recurring expense: it stops applying after `month` (kept up to and including it). */
  async cancel(id: string, dto: CancelExpenseDto, actorId?: string, companyIds?: string[]) {
    const e = await this.prisma.expense.findFirst({ where: { id, ...ACTIVE, ...(companyIds ? { companyId: { in: companyIds } } : {}) }, select: { id: true, occurrence: true, startMonth: true, status: true } });
    if (!e) throw new NotFoundException('Expense not found');
    if (e.occurrence === 'once_off') throw new BadRequestException('A once-off expense has nothing to cancel');
    if (e.status === 'cancelled') throw new BadRequestException('Expense is already cancelled');
    const month = dto.month ?? thisMonth();
    if (month < e.startMonth) throw new BadRequestException('Cancel month is before the expense started');
    await this.prisma.expense.update({ where: { id }, data: { status: 'cancelled', endMonth: month, updatedById: actorId ?? null } });
    return this.get(id);
  }

  /** Edit a submitted expense. Attributes (name, tag, note, currency, amount) are always
   *  editable; structural changes (occurrence, start month, once-off date) are only allowed
   *  while the expense still has a single baseline and no ledger overrides, so a scheduled
   *  amount history is never silently discarded. */
  async update(id: string, dto: UpdateExpenseDto, actorId?: string, companyIds?: string[]) {
    const e = await this.prisma.expense.findFirst({
      where: { id, ...ACTIVE, ...(companyIds ? { companyId: { in: companyIds } } : {}) },
      include: { amounts: { orderBy: { effectiveMonth: 'asc' } }, overrides: true },
    });
    if (!e) throw new NotFoundException('Expense not found');

    const simple = e.amounts.length <= 1 && e.overrides.length === 0;
    const currency = (dto.currency ?? e.currency).toUpperCase();
    const occurrence = dto.occurrence ?? e.occurrence;
    const onceOff = occurrence === 'once_off';

    const existingOnceOff = e.onceOffDate ? e.onceOffDate.toISOString().slice(0, 10) : null;
    const onceOffDateStr = onceOff ? (dto.onceOffDate?.slice(0, 10) ?? existingOnceOff) : null;
    if (onceOff && !onceOffDateStr) throw new BadRequestException('A once-off expense needs a date');
    const startMonth = onceOff ? monthOf(onceOffDateStr!) : (dto.startMonth ?? e.startMonth);

    const occChanged = occurrence !== e.occurrence;
    const startChanged = !onceOff && startMonth !== e.startMonth;
    const onceOffChanged = onceOff && onceOffDateStr !== existingOnceOff;
    if ((occChanged || startChanged || onceOffChanged) && !simple) {
      throw new BadRequestException('This expense has scheduled amount changes in the ledger. Change those from the monthly ledger first, then edit its type or date here.');
    }
    if (!onceOff && e.endMonth && startMonth > e.endMonth) {
      throw new BadRequestException('The start month cannot be after the month the expense was cancelled.');
    }

    if (dto.definitionId && dto.definitionId !== e.definitionId) {
      const def = await this.prisma.expenseDefinition.findFirst({ where: { id: dto.definitionId, ...ACTIVE }, select: { id: true } });
      if (!def) throw new NotFoundException('Expense name not found');
    }
    if (dto.tagId) {
      const tag = await this.prisma.expenseTag.findFirst({ where: { id: dto.tagId, deletedAt: null }, select: { id: true } });
      if (!tag) throw new NotFoundException('Tag not found');
    }

    const currencyChanged = currency !== e.currency;
    const base = e.amounts[0] ?? null;

    await this.prisma.$transaction(async (tx) => {
      await tx.expense.update({
        where: { id },
        data: {
          ...(dto.definitionId ? { definitionId: dto.definitionId } : {}),
          occurrence,
          currency,
          startMonth,
          onceOffDate: onceOff ? new Date(onceOffDateStr!) : null,
          ...(onceOff ? { endMonth: null, status: 'active' } : {}),
          ...(dto.note !== undefined ? { note: dto.note?.trim() || null } : {}),
          ...(dto.tagId !== undefined ? { tagId: dto.tagId ?? null } : {}),
          updatedById: actorId ?? null,
        },
      });

      // Baseline amount: the earliest ExpenseAmount row tracks the (possibly new) start month.
      const baseAmount = dto.amount ?? Number(base?.amount ?? 0);
      const baseFxDate = onceOff ? onceOffDateStr! : firstDayOf(startMonth);
      const baseConv = await this.convert(baseAmount, currency, baseFxDate);
      if (base) {
        await tx.expenseAmount.update({ where: { id: base.id }, data: { effectiveMonth: startMonth, amount: baseAmount, amountEur: baseConv.amountEur, fxRate: baseConv.fxRate } });
      } else {
        await tx.expenseAmount.create({ data: { expenseId: id, effectiveMonth: startMonth, amount: baseAmount, amountEur: baseConv.amountEur, fxRate: baseConv.fxRate } });
      }

      // If the currency changed, re-price every later scheduled amount and override at its own date.
      if (currencyChanged) {
        for (const a of e.amounts.slice(1)) {
          const conv = await this.convert(Number(a.amount), currency, firstDayOf(a.effectiveMonth));
          await tx.expenseAmount.update({ where: { id: a.id }, data: { amountEur: conv.amountEur, fxRate: conv.fxRate } });
        }
        for (const o of e.overrides) {
          const conv = await this.convert(Number(o.amount), currency, firstDayOf(o.month));
          await tx.expenseMonthOverride.update({ where: { id: o.id }, data: { amountEur: conv.amountEur, fxRate: conv.fxRate } });
        }
      }
    });

    return this.get(id);
  }

  // ---- monthly ledger + rollups (compute-on-read) ----

  /** Every expense's contribution to a single month, plus the month total (EUR). */
  async monthly(month: string, companyIds?: string[]) {
    const rows = await this.loadAll(companyIds);
    const items = rows.map((e) => this.monthRow(e, month)).filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => b.monthEur - a.monthEur);
    return { month, totalEur: round(items.reduce((s, r) => s + r.monthEur, 0)), count: items.length, items };
  }

  /** A year's total plus its 12-month breakdown (EUR). Monthly ×12, annual as-is, once-off once. */
  async annual(year: number, companyIds?: string[]) {
    const rows = await this.loadAll(companyIds);
    const breakdown = Array.from({ length: 12 }, (_, i) => {
      const m = `${year}-${String(i + 1).padStart(2, '0')}`;
      const totalEur = round(rows.reduce((s, e) => { const r = this.monthRow(e, m); return s + (r ? r.monthEur : 0); }, 0));
      return { month: m, totalEur };
    });
    return { year, totalEur: round(breakdown.reduce((s, b) => s + b.totalEur, 0)), breakdown };
  }

  /** Edit a month's amount: 'this_month' writes a per-month override; 'all_following'
   *  sets a new effective baseline from that month and clears later overrides. */
  async setAmount(expenseId: string, dto: SetExpenseAmountDto, actorId?: string, companyIds?: string[]) {
    const e = await this.prisma.expense.findFirst({ where: { id: expenseId, ...ACTIVE, ...(companyIds ? { companyId: { in: companyIds } } : {}) }, select: { id: true, currency: true, occurrence: true, startMonth: true, endMonth: true, onceOffDate: true } });
    if (!e) throw new NotFoundException('Expense not found');
    const month = dto.month;
    if (e.occurrence === 'once_off') {
      if (month !== e.startMonth) throw new BadRequestException('A once-off expense can only be edited in its own month');
    } else {
      if (month < e.startMonth) throw new BadRequestException('That month is before the expense started');
      if (e.endMonth && month > e.endMonth) throw new BadRequestException('That month is after the expense was cancelled');
    }

    const fxDate = e.occurrence === 'once_off' && e.onceOffDate ? e.onceOffDate.toISOString().slice(0, 10) : firstDayOf(month);
    const { amountEur, fxRate } = await this.convert(dto.amount, e.currency, fxDate);

    if (e.occurrence === 'once_off' || dto.scope === 'all_following') {
      // New (or updated) effective baseline at `month`; once-off edits its single base.
      const effMonth = e.occurrence === 'once_off' ? e.startMonth : month;
      const existing = await this.prisma.expenseAmount.findFirst({ where: { expenseId, effectiveMonth: effMonth } });
      if (existing) await this.prisma.expenseAmount.update({ where: { id: existing.id }, data: { amount: dto.amount, amountEur, fxRate } });
      else await this.prisma.expenseAmount.create({ data: { expenseId, effectiveMonth: effMonth, amount: dto.amount, amountEur, fxRate } });
      if (dto.scope === 'all_following') {
        // A fresh baseline supersedes any ad-hoc overrides from this month onward.
        await this.prisma.expenseMonthOverride.deleteMany({ where: { expenseId, month: { gte: month } } });
      }
    } else {
      // this_month — override wins for just this month.
      await this.prisma.expenseMonthOverride.upsert({
        where: { expenseId_month: { expenseId, month } },
        update: { amount: dto.amount, amountEur, fxRate },
        create: { expenseId, month, amount: dto.amount, amountEur, fxRate },
      });
    }
    await this.prisma.expense.update({ where: { id: expenseId }, data: { updatedById: actorId ?? null } });
    return this.get(expenseId);
  }

  private async loadAll(companyIds?: string[]) {
    return this.prisma.expense.findMany({
      where: { ...ACTIVE, ...(companyIds ? { companyId: { in: companyIds } } : {}) },
      include: { definition: { select: { code: true, name: true, category: { select: { name: true } } } }, amounts: { orderBy: { effectiveMonth: 'asc' } }, overrides: true },
    });
  }

  private isActiveInMonth(e: any, month: string): boolean {
    if (e.occurrence === 'once_off') return e.startMonth === month;
    if (month < e.startMonth) return false;
    if (e.endMonth && month > e.endMonth) return false;
    return true;
  }

  private monthRow(e: any, month: string) {
    if (!this.isActiveInMonth(e, month)) return null;
    const amt = this.amountForMonth(e, month) ?? { amount: 0, amountEur: 0 };
    const div = e.occurrence === 'annual' ? 12 : 1;
    return {
      expenseId: e.id,
      definitionCode: e.definition?.code ?? null,
      definitionName: e.definition?.name ?? '—',
      categoryName: e.definition?.category?.name ?? null,
      occurrence: e.occurrence as string,
      currency: e.currency as string,
      status: e.status as string,
      // Base amount in the expense's own period (monthly amount, or annual amount for annual).
      baseAmount: round(amt.amount),
      baseAmountEur: round(amt.amountEur),
      // The contribution actually counted in this month.
      monthNative: round(amt.amount / div),
      monthEur: round(amt.amountEur / div),
      hasOverride: e.overrides.some((o: any) => o.month === month),
    };
  }

  // ---- helpers ----

  /** The amount (native + EUR) in effect for `month`: a month override wins, else the
   *  latest effective amount whose month is <= the target. */
  private amountForMonth(e: any, month: string): { amount: number; amountEur: number } | null {
    const override = e.overrides.find((o: any) => o.month === month);
    if (override) return { amount: Number(override.amount), amountEur: Number(override.amountEur) };
    let chosen: any = null;
    for (const a of e.amounts) { if (a.effectiveMonth <= month) chosen = a; }
    if (!chosen) chosen = e.amounts[0] ?? null; // before the first change, use the earliest
    return chosen ? { amount: Number(chosen.amount), amountEur: Number(chosen.amountEur) } : null;
  }

  private serialize(e: any, currentMonth: string) {
    // For display, resolve the amount at the later of the start month / current month so a
    // future-dated or cancelled expense still shows a sensible current figure.
    const refMonth = currentMonth < e.startMonth ? e.startMonth : e.endMonth && currentMonth > e.endMonth ? e.endMonth : currentMonth;
    const cur = this.amountForMonth(e, refMonth) ?? { amount: 0, amountEur: 0 };
    const monthlyEur = e.occurrence === 'annual' ? round(cur.amountEur / 12) : cur.amountEur;
    const annualEur = e.occurrence === 'annual' ? cur.amountEur : e.occurrence === 'monthly' ? round(cur.amountEur * 12) : cur.amountEur;
    const latestFx = e.amounts.length ? Number(e.amounts[e.amounts.length - 1].fxRate ?? 1) : 1;
    return {
      id: e.id,
      definitionId: e.definitionId,
      definitionCode: e.definition?.code ?? null,
      definitionName: e.definition?.name ?? '—',
      categoryId: e.definition?.categoryId ?? null,
      categoryName: e.definition?.category?.name ?? null,
      companyId: e.companyId,
      occurrence: e.occurrence,
      currency: e.currency,
      startMonth: e.startMonth,
      endMonth: e.endMonth,
      onceOffDate: e.onceOffDate ? e.onceOffDate.toISOString().slice(0, 10) : null,
      status: e.status,
      note: e.note,
      hasSchedule: (e.amounts?.length ?? 0) > 1 || (e.overrides?.length ?? 0) > 0,
      registeredAt: e.createdAt ? e.createdAt.toISOString() : null,
      tagId: e.tagId ?? null,
      tagName: e.tag?.name ?? null,
      tagGroup: e.tag?.group ?? null,
      currentAmount: cur.amount,
      currentAmountEur: cur.amountEur,
      fxRate: latestFx,
      monthlyEur,
      annualEur,
    };
  }
}
