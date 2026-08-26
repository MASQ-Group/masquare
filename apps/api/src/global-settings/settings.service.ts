import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateSettingsDto } from './dto/settings.dto';

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Platform settings are a singleton; create defaults on first read. */
  async get() {
    const existing = await this.prisma.platformSettings.findFirst();
    const row = existing ?? (await this.prisma.platformSettings.create({ data: {} }));
    return { ...row, salesTxStandardColumns: this.parseColumns(row.salesTxStandardColumns) };
  }

  async update(dto: UpdateSettingsDto) {
    const current = await this.prisma.platformSettings.findFirst() ?? (await this.prisma.platformSettings.create({ data: {} }));
    const row = await this.prisma.platformSettings.update({
      where: { id: current.id },
      data: {
        measurementSystem: dto.measurementSystem,
        dateFormat: dto.dateFormat,
        ...(dto.salesTxStandardColumns !== undefined ? { salesTxStandardColumns: JSON.stringify(dto.salesTxStandardColumns) } : {}),
        ...(dto.bodyFont !== undefined ? { bodyFont: dto.bodyFont } : {}),
        ...(dto.monoFont !== undefined ? { monoFont: dto.monoFont } : {}),
        ...(dto.deductStockOnSale !== undefined ? { deductStockOnSale: dto.deductStockOnSale } : {}),
        ...(dto.applyChannelResolutions !== undefined ? { applyChannelResolutions: dto.applyChannelResolutions } : {}),
        ...(dto.autoAdjustAvailabilityOnSale !== undefined ? { autoAdjustAvailabilityOnSale: dto.autoAdjustAvailabilityOnSale } : {}),
        ...(dto.launchMarginPct !== undefined ? { launchMarginPct: dto.launchMarginPct } : {}),
        ...(dto.listingLiveWrites !== undefined ? { listingLiveWrites: dto.listingLiveWrites } : {}),
        ...(dto.channelQuantityPushEnabled !== undefined ? { channelQuantityPushEnabled: dto.channelQuantityPushEnabled } : {}),
        ...(dto.channelPricePushEnabled !== undefined ? { channelPricePushEnabled: dto.channelPricePushEnabled } : {}),
        ...(dto.maxZeroingPushesPerRun !== undefined ? { maxZeroingPushesPerRun: dto.maxZeroingPushesPerRun } : {}),
      },
    });
    return { ...row, salesTxStandardColumns: this.parseColumns(row.salesTxStandardColumns) };
  }

  private parseColumns(raw: string | null): string[] | null {
    if (!raw) return null;
    try { const v = JSON.parse(raw); return Array.isArray(v) ? v : null; } catch { return null; }
  }
}
