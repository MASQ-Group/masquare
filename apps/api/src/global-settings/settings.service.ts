import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { UpdateSettingsDto } from './dto/settings.dto';
import { reviewRecipients } from '../customer-shipments/alert-recipients';

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** Platform settings are a singleton; create defaults on first read. */
  async get() {
    const existing = await this.prisma.platformSettings.findFirst();
    const row = existing ?? (await this.prisma.platformSettings.create({ data: {} }));
    return {
      ...row,
      salesTxStandardColumns: this.parseColumns(row.salesTxStandardColumns),
      faviconUrl: row.faviconKey ? this.storage.publicUrl(row.faviconKey) : null,
    };
  }

  // ── browser favicon ──────────────────────────────────────────────────────────────────────────

  /** The favicon's public address, or null when none is set. Read on every page load, so kept cheap. */
  async faviconUrl(): Promise<string | null> {
    const row = await this.prisma.platformSettings.findFirst({ select: { faviconKey: true } });
    return row?.faviconKey ? this.storage.publicUrl(row.faviconKey) : null;
  }

  /**
   * Upload the browser tab icon. Small square images only: a favicon is drawn at 16–32 px, and a
   * large photo would be downloaded on every page load for no visible gain.
   */
  async setFavicon(file: { buffer: Buffer; originalname: string; mimetype: string } | undefined) {
    if (!file?.buffer?.length) throw new BadRequestException('No image was uploaded');
    const ext = (file.originalname.split('.').pop() || '').toLowerCase();
    const TYPES: Record<string, string> = {
      ico: 'image/x-icon', png: 'image/png', svg: 'image/svg+xml', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    };
    if (!TYPES[ext]) throw new BadRequestException('The icon must be an ICO, PNG, SVG, WEBP or JPG image');
    if (file.buffer.length > 512_000) throw new BadRequestException('The icon must be 500 KB or smaller');

    // A new key per upload, so a replaced icon is never served from a cache of the old one.
    const key = `branding/favicon-${Date.now()}.${ext}`;
    try {
      await this.storage.putObject(key, file.buffer, TYPES[ext]);
    } catch (e: any) {
      this.logger.error(`Favicon upload failed: ${e?.name ?? ''} ${e?.message ?? e}`);
      throw new ServiceUnavailableException(`Image storage rejected the upload: ${e?.message ?? 'unknown error'}`.slice(0, 300));
    }
    const current = await this.prisma.platformSettings.findFirst() ?? (await this.prisma.platformSettings.create({ data: {} }));
    await this.prisma.platformSettings.update({ where: { id: current.id }, data: { faviconKey: key } });
    return { faviconUrl: this.storage.publicUrl(key) };
  }

  /** Back to the browser's default icon. The stored image is left in place; nothing references it. */
  async removeFavicon() {
    const current = await this.prisma.platformSettings.findFirst();
    if (current) await this.prisma.platformSettings.update({ where: { id: current.id }, data: { faviconKey: null } });
    return { faviconUrl: null };
  }

  async update(dto: UpdateSettingsDto) {
    /**
     * The extra alert addresses, checked before anything is stored.
     *
     * Refused rather than quietly tidied: a shipment email carries a customer's recipient, their
     * address and what is in their boxes, and an address half-accepted here is how that reaches
     * somebody nobody meant. The complaint names the entry that was wrong.
     */
    const reviewed = dto.logisticsAlertEmails !== undefined ? reviewRecipients(dto.logisticsAlertEmails) : null;
    if (reviewed?.problems.length) throw new BadRequestException(reviewed.problems.join(' '));

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
        ...(dto.logisticsAlertUserId !== undefined ? { logisticsAlertUserId: dto.logisticsAlertUserId } : {}),
        ...(dto.logisticsAlertEmails !== undefined ? { logisticsAlertEmails: reviewed!.addresses } : {}),
        ...(dto.applyChannelResolutions !== undefined ? { applyChannelResolutions: dto.applyChannelResolutions } : {}),
        ...(dto.autoAdjustAvailabilityOnSale !== undefined ? { autoAdjustAvailabilityOnSale: dto.autoAdjustAvailabilityOnSale } : {}),
        ...(dto.launchMarginPct !== undefined ? { launchMarginPct: dto.launchMarginPct } : {}),
        ...(dto.listingLiveWrites !== undefined ? { listingLiveWrites: dto.listingLiveWrites } : {}),
        ...(dto.channelPriceWrites !== undefined ? { channelPriceWrites: dto.channelPriceWrites } : {}),
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
