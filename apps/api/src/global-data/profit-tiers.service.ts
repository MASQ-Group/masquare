import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SaveProfitTiersDto } from './dto/profit-tier.dto';

@Injectable()
export class ProfitTiersService {
  constructor(private readonly prisma: PrismaService) {}

  list(companyIds?: string[]) {
    return this.prisma.profitTier.findMany({
      where: { ...(companyIds ? { companyId: { in: companyIds } } : {}) },
      orderBy: { sortOrder: 'asc' },
    });
  }

  /** Replace the whole tier list (the settings editor saves it in one go). */
  async saveAll(dto: SaveProfitTiersDto, companyId?: string) {
    await this.prisma.$transaction([
      // Scoped to the company being edited. This deleted EVERY tier, so saving in one company wiped
      // the other's bands — a replace-all is only safe once it knows whose list it is replacing.
      this.prisma.profitTier.deleteMany({ where: { ...(companyId ? { companyId } : {}) } }),
      this.prisma.profitTier.createMany({
        data: dto.tiers.map((t, i) => ({
          name: t.name ?? null,
          fromPct: t.fromPct,
          toPct: t.toPct,
          bgColor: t.bgColor,
          fontColor: t.fontColor,
          sortOrder: i,
          companyId: companyId ?? null,
        })),
      }),
    ]);
    return this.list(companyId ? [companyId] : undefined);
  }
}
