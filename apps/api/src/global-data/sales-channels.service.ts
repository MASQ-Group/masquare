import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSalesChannelDto, UpdateSalesChannelDto } from './dto/sales-channel.dto';

const include = {
  nativeCountry: { select: { id: true, name: true, isoCode: true } },
  // A user with access to more than one company sees a channel per company, and the names are
  // routinely identical ("Amazon AUS" under two entities). Without the owner the picker offers
  // two indistinguishable options, and choosing the wrong one silently costs a listing against
  // an entity that has no shipments or orders at all.
  company: { select: { id: true, officialName: true } },
} satisfies Prisma.SalesChannelInclude;

@Injectable()
export class SalesChannelsService {
  constructor(private readonly prisma: PrismaService) {}

  // Sales channels are company-owned: a company only sees its own, never another's.
  list(q?: string, companyIds?: string[]) {
    return this.prisma.salesChannel.findMany({
      where: {
        deletedAt: null,
        ...(companyIds ? { companyId: { in: companyIds } } : {}),
        ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}),
      },
      orderBy: { name: 'asc' },
      include,
    });
  }

  async get(id: string, companyIds?: string[]) {
    const row = await this.prisma.salesChannel.findFirst({
      where: { id, deletedAt: null, ...(companyIds ? { companyId: { in: companyIds } } : {}) },
      include,
    });
    if (!row) throw new NotFoundException('Sales channel not found');
    return row;
  }

  create(dto: CreateSalesChannelDto, actorId?: string, companyId?: string) {
    return this.prisma.salesChannel.create({
      data: {
        companyId: companyId ?? null,
        name: dto.name,
        description: dto.description,
        nativeCountryId: dto.nativeCountryId ?? null,
        nativeCurrency: dto.nativeCurrency,
        generalSalesFeePct: dto.generalSalesFeePct ?? null,
        feeChargedInNativeCurrency: dto.feeChargedInNativeCurrency ?? true,
        feeCurrency: dto.feeCurrency ?? null,
        showTransactionTotal: dto.showTransactionTotal ?? false,
        chipBgColor: dto.chipBgColor ?? null,
        chipTextColor: dto.chipTextColor ?? null,
        pricesIncludeTax: dto.pricesIncludeTax ?? true,
        fxRateOverride: dto.fxRateOverride ?? null,
        fxRateOverrideNote: dto.fxRateOverrideNote ?? null,
        fxRateOverrideSetAt: dto.fxRateOverride != null ? new Date() : null,
        vatThresholdEnabled: dto.vatThresholdEnabled ?? false,
        vatThresholdAmount: dto.vatThresholdAmount ?? null,
        vatThresholdCurrency: dto.vatThresholdCurrency ?? null,
        vatBelowThresholdPct: dto.vatBelowThresholdPct ?? null,
        vatAboveThresholdPct: dto.vatAboveThresholdPct ?? null,
        email: dto.email,
        website: dto.website,
        contactName: dto.contactName,
        createdById: actorId,
        updatedById: actorId,
      },
      include,
    });
  }

  async update(id: string, dto: UpdateSalesChannelDto, actorId?: string, companyIds?: string[]) {
    await this.get(id, companyIds);
    return this.prisma.salesChannel.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        nativeCountryId: dto.nativeCountryId,
        nativeCurrency: dto.nativeCurrency,
        generalSalesFeePct: dto.generalSalesFeePct,
        feeChargedInNativeCurrency: dto.feeChargedInNativeCurrency,
        feeCurrency: dto.feeCurrency,
        showTransactionTotal: dto.showTransactionTotal,
        chipBgColor: dto.chipBgColor,
        chipTextColor: dto.chipTextColor,
        pricesIncludeTax: dto.pricesIncludeTax,
        fxRateOverride: dto.fxRateOverride,
        fxRateOverrideNote: dto.fxRateOverrideNote,
        // Stamped when the rate changes, so how stale it is can be seen at a glance.
        ...(dto.fxRateOverride !== undefined ? { fxRateOverrideSetAt: dto.fxRateOverride != null ? new Date() : null } : {}),
        vatThresholdEnabled: dto.vatThresholdEnabled,
        vatThresholdAmount: dto.vatThresholdAmount,
        vatThresholdCurrency: dto.vatThresholdCurrency,
        vatBelowThresholdPct: dto.vatBelowThresholdPct,
        vatAboveThresholdPct: dto.vatAboveThresholdPct,
        email: dto.email,
        website: dto.website,
        contactName: dto.contactName,
        updatedById: actorId,
      },
      include,
    });
  }

  async remove(id: string, companyIds?: string[]) {
    await this.get(id, companyIds);
    await this.prisma.salesChannel.update({ where: { id }, data: { deletedAt: new Date() } });
    return { ok: true };
  }
}
