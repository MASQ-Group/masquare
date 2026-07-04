import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SaveProfitTiersDto } from './dto/profit-tier.dto';

@Injectable()
export class ProfitTiersService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.profitTier.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  /** Replace the whole tier list (the settings editor saves it in one go). */
  async saveAll(dto: SaveProfitTiersDto) {
    await this.prisma.$transaction([
      this.prisma.profitTier.deleteMany({}),
      this.prisma.profitTier.createMany({
        data: dto.tiers.map((t, i) => ({
          name: t.name ?? null,
          fromPct: t.fromPct,
          toPct: t.toPct,
          bgColor: t.bgColor,
          fontColor: t.fontColor,
          sortOrder: i,
        })),
      }),
    ]);
    return this.list();
  }
}
