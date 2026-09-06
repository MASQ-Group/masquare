import { Body, Controller, Delete, Get, Injectable, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { AccessArea, NoAccessCheck } from '../access/access.decorators';

/**
 * Channels a brand has told us not to sell them on.
 *
 * Recorded here rather than inferred from anywhere, because the source is a letter. Amazon may be
 * perfectly willing to take the listing and the restriction still stands; the two facts are kept
 * apart because they have different remedies — an approval request to Amazon, or a conversation
 * with the brand.
 */
@Injectable()
export class BrandRestrictionsService {
  constructor(private readonly prisma: PrismaService) {}

  list(brandId?: string) {
    return this.prisma.brandChannelRestriction.findMany({
      where: { deletedAt: null, ...(brandId ? { brandId } : {}) },
      include: { brand: { select: { id: true, name: true } } },
      orderBy: [{ brand: { name: 'asc' } }, { channelType: 'asc' }, { marketplace: 'asc' }],
    });
  }

  async create(dto: { brandId: string; channelType: string; marketplace?: string | null; note?: string | null }, actorId?: string) {
    const brand = await this.prisma.brand.findFirst({ where: { id: dto.brandId, deletedAt: null }, select: { id: true } });
    if (!brand) throw new NotFoundException('Brand not found');

    const channelType = (dto.channelType ?? '').trim().toLowerCase();
    // Empty marketplace is meaningful — it covers the whole channel type — so it is normalised
    // rather than rejected.
    const marketplace = (dto.marketplace ?? '').trim().toUpperCase();

    // Re-adding a restriction that was removed should revive it, not collide with the unique key.
    const existing = await this.prisma.brandChannelRestriction.findFirst({
      where: { brandId: dto.brandId, channelType, marketplace },
      select: { id: true },
    });
    if (existing) {
      return this.prisma.brandChannelRestriction.update({
        where: { id: existing.id },
        data: { note: dto.note ?? null, deletedAt: null, createdById: actorId },
      });
    }
    return this.prisma.brandChannelRestriction.create({
      data: { brandId: dto.brandId, channelType, marketplace, note: dto.note ?? null, createdById: actorId },
    });
  }

  async remove(id: string) {
    const row = await this.prisma.brandChannelRestriction.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException('Restriction not found');
    await this.prisma.brandChannelRestriction.update({ where: { id }, data: { deletedAt: new Date() } });
    return { ok: true };
  }
}

@AccessArea('global_settings')
@ApiTags('global-settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('brand-restrictions')
export class BrandRestrictionsController {
  constructor(private readonly svc: BrandRestrictionsService) {}

  // Read is not a settings action: the listing flow needs these to raise its warning, and gating
  // the read would hide the restriction from the very screen that has to show it.
  @NoAccessCheck() @Get() list(@Query('brandId') brandId?: string) { return this.svc.list(brandId); }

  @Post() create(
    @Body() dto: { brandId: string; channelType: string; marketplace?: string | null; note?: string | null },
    @CurrentUser() u: AuthUser,
  ) { return this.svc.create(dto, u.sub); }

  @Delete(':id') remove(@Param('id') id: string) { return this.svc.remove(id); }
}
