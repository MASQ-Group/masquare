import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { customsValue, dutiesDue, firstMatchingRule, ruleProblems, type ShipmentFacts } from './duty-rules';

export interface DutyRuleInput {
  name?: string;
  sortOrder?: number;
  active?: boolean;
  salesChannelId?: string | null;
  destinationRelation?: string;
  destinationRegion?: string;
  dutiesDue?: string;
  dutiesPaidBy?: string;
}

const SELECT = {
  id: true, name: true, sortOrder: true, active: true, salesChannelId: true,
  destinationRelation: true, destinationRegion: true, dutiesDue: true, dutiesPaidBy: true,
  salesChannel: { select: { id: true, name: true } },
  updatedAt: true,
} satisfies Prisma.FedexDutyRuleSelect;

/**
 * The FedEx duty rules, and the pre-fill they produce for one order.
 *
 * The rules themselves are pure, in duty-rules.ts. This is where they are stored, and where an
 * order's facts are gathered for them: the channel's home country, the destination and whether it is
 * in the EU, and whether duties will be due there on the goods and shipping together.
 */
@Injectable()
export class DutyRulesService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.fedexDutyRule.findMany({
      where: { deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: SELECT,
    });
  }

  private data(input: DutyRuleInput) {
    return {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: Math.trunc(Number(input.sortOrder) || 0) } : {}),
      ...(input.active !== undefined ? { active: !!input.active } : {}),
      ...(input.salesChannelId !== undefined ? { salesChannelId: input.salesChannelId || null } : {}),
      ...(input.destinationRelation !== undefined ? { destinationRelation: input.destinationRelation } : {}),
      ...(input.destinationRegion !== undefined ? { destinationRegion: input.destinationRegion } : {}),
      ...(input.dutiesDue !== undefined ? { dutiesDue: input.dutiesDue } : {}),
      ...(input.dutiesPaidBy !== undefined ? { dutiesPaidBy: input.dutiesPaidBy } : {}),
    };
  }

  async create(input: DutyRuleInput, actorId?: string) {
    const problems = ruleProblems(input as any);
    if (problems.length) throw new BadRequestException(problems.join(' '));
    // New rules go to the end unless placed: adding one should never quietly outrank the others.
    const last = await this.prisma.fedexDutyRule.aggregate({ where: { deletedAt: null }, _max: { sortOrder: true } });
    await this.prisma.fedexDutyRule.create({
      data: {
        name: input.name!.trim(),
        dutiesPaidBy: input.dutiesPaidBy!,
        ...this.data(input),
        sortOrder: input.sortOrder != null ? Math.trunc(Number(input.sortOrder) || 0) : (last._max.sortOrder ?? 0) + 10,
        createdById: actorId ?? null,
        updatedById: actorId ?? null,
      },
    });
    return this.list();
  }

  async update(id: string, input: DutyRuleInput, actorId?: string) {
    const existing = await this.prisma.fedexDutyRule.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Rule not found');
    const problems = ruleProblems({ ...existing, ...input } as any);
    if (problems.length) throw new BadRequestException(problems.join(' '));
    await this.prisma.fedexDutyRule.update({ where: { id }, data: { ...this.data(input), updatedById: actorId ?? null } });
    return this.list();
  }

  async remove(id: string) {
    const existing = await this.prisma.fedexDutyRule.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!existing) throw new NotFoundException('Rule not found');
    await this.prisma.fedexDutyRule.update({ where: { id }, data: { deletedAt: new Date() } });
    return this.list();
  }

  /**
   * Euro per unit of each currency, from the customs rates of the latest month held.
   *
   * Customs rates rather than the day's market rate, because a threshold is applied at the border
   * at the customs rate — and they are already in our database, so asking costs no outside call.
   */
  async rateToEur(): Promise<(currency: string) => number | null> {
    const latest = await this.prisma.customsExchangeRate.findFirst({ orderBy: [{ year: 'desc' }, { month: 'desc' }], select: { year: true, month: true } });
    const rows = latest
      ? await this.prisma.customsExchangeRate.findMany({ where: { year: latest.year, month: latest.month }, select: { currencyCode: true, rate: true } })
      : [];
    // Stored as units of the currency per ONE euro, so a unit of it is worth the inverse.
    const map = new Map(rows.filter((r) => r.rate > 0).map((r) => [r.currencyCode.toUpperCase(), 1 / r.rate]));
    return (c: string) => (c.toUpperCase() === 'EUR' ? 1 : map.get(c.toUpperCase()) ?? null);
  }

  /**
   * What the rules pre-fill for one of our orders, with everything that decided it.
   *
   * The facts come back whether or not a rule matched, so the screen can say WHY nothing was
   * pre-filled — an unset threshold on the destination reads very differently from no rule at all.
   */
  async suggestForOrder(transactionId: string) {
    const tx = await this.prisma.salesTransaction.findFirst({
      where: { id: transactionId, deletedAt: null },
      select: {
        salesChannelId: true, currency: true,
        salesChannel: { select: { name: true, nativeCountry: { select: { isoCode: true } } } },
        destinationCountry: { select: { isoCode: true } },
        deliveryAddress: { select: { countryIso: true } },
        items: { where: { deletedAt: null }, select: { netSalesAmount: true, shippingAmount: true } },
      },
    });
    if (!tx) return null;

    const destinationIso = (tx.deliveryAddress?.countryIso ?? tx.destinationCountry?.isoCode ?? null)?.toUpperCase() ?? null;
    const country = destinationIso
      ? await this.prisma.country.findFirst({
        where: { isoCode: destinationIso, deletedAt: null },
        select: { euVatZone: true, importDutyMode: true, importDutyThreshold: true, importDutyCurrency: true },
      })
      : null;

    // Goods plus the shipping the buyer paid, excluding VAT — the CIF value customs judge a threshold
    // on. Where no shipping was charged the goods are all we can state: our own FedEx charge is not
    // known until the booking, which is after this answer is needed. See customsValue.
    const value = customsValue(tx.items);
    const due = dutiesDue(
      country ? { mode: (country.importDutyMode as 'none' | 'threshold' | null) ?? null, threshold: country.importDutyThreshold == null ? null : Number(country.importDutyThreshold), currency: country.importDutyCurrency } : null,
      { value: value.value, currency: tx.currency ?? 'EUR', label: value.label },
      await this.rateToEur(),
    );

    const facts: ShipmentFacts = {
      salesChannelId: tx.salesChannelId,
      channelHomeIso: tx.salesChannel?.nativeCountry?.isoCode?.toUpperCase() ?? null,
      destinationIso,
      destinationInEu: country ? country.euVatZone : null,
      dutiesDue: due.due,
    };
    const rules = await this.list();
    const rule = firstMatchingRule(rules, facts);

    return {
      dutiesPaidBy: (rule?.dutiesPaidBy as 'sender' | 'recipient' | undefined) ?? null,
      rule: rule ? { id: rule.id, name: rule.name } : null,
      facts: { ...facts, channelName: tx.salesChannel?.name ?? null, dutiesReason: due.reason },
    };
  }
}
