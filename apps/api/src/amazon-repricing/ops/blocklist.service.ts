import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

// Seller blocklist governance (spec §5.2, §9-#19). Unauthorized resellers / MAP violators /
// hijackers listed here are dropped from the effective competitor set so they never drag our
// price down. The engine reads active rows (competitor-set filter); this service is the CRUD.

export interface BlockedSellerDto {
  sellerId: string;
  marketplaceId?: string | null; // null = all marketplaces
  sellerName?: string | null;
  reason?: string | null; // UNAUTHORIZED | MAP_VIOLATOR | HIJACKER | OTHER
  brand?: string | null;
}

@Injectable()
export class BlocklistService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.repricingBlockedSeller.findMany({
      where: { active: true, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async add(dto: BlockedSellerDto, actorId?: string) {
    const sellerId = (dto.sellerId ?? '').trim();
    if (!sellerId) throw new BadRequestException('sellerId is required');
    const marketplaceId = dto.marketplaceId?.trim() || null;
    // Re-activate a previously removed entry for the same seller/marketplace rather than duplicate
    // (findFirst, not findUnique — the unique is on a nullable marketplaceId).
    const existing = await this.prisma.repricingBlockedSeller.findFirst({
      where: { sellerId, marketplaceId },
    });
    if (existing) {
      return this.prisma.repricingBlockedSeller.update({
        where: { id: existing.id },
        data: { active: true, deletedAt: null, sellerName: dto.sellerName ?? null, reason: dto.reason ?? null, brand: dto.brand ?? null, updatedById: actorId ?? null },
      });
    }
    return this.prisma.repricingBlockedSeller.create({
      data: { sellerId, marketplaceId, sellerName: dto.sellerName ?? null, reason: dto.reason ?? null, brand: dto.brand ?? null, createdById: actorId ?? null },
    });
  }

  /** Soft-remove: the engine only reads active rows, so this un-blocks the seller. */
  async remove(id: string, actorId?: string) {
    await this.prisma.repricingBlockedSeller.update({
      where: { id },
      data: { active: false, deletedAt: new Date(), updatedById: actorId ?? null },
    });
    return { removed: true };
  }
}
