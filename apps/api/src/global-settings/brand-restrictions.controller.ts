import { BadRequestException, Body, Controller, Delete, Get, Injectable, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
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

  /**
   * Record a brand's restriction on one or more channels.
   *
   * Several at once because that is how the letters arrive: a brand writes once and names four
   * marketplaces. Making somebody repeat the form per channel meant retyping the same note four
   * times — and a note is the thing that makes the warning actionable months later, so four
   * slightly different versions of it is a worse outcome than one.
   *
   * `channels` is the real input; a single channelType/marketplace is still accepted so the older
   * shape keeps working.
   */
  async create(
    dto: {
      brandId: string;
      channelType?: string;
      marketplace?: string | null;
      channels?: Array<{ channelType: string; marketplace?: string | null }>;
      note?: string | null;
    },
    actorId?: string,
  ) {
    const brand = await this.prisma.brand.findFirst({ where: { id: dto.brandId, deletedAt: null }, select: { id: true } });
    if (!brand) throw new NotFoundException('Brand not found');

    const requested = dto.channels?.length
      ? dto.channels
      : dto.channelType
        ? [{ channelType: dto.channelType, marketplace: dto.marketplace }]
        : [];
    if (requested.length === 0) throw new BadRequestException('Pick at least one channel');

    // Normalised, then deduplicated. "Amazon (all marketplaces)" alongside "Amazon US" is a
    // reasonable thing to click by accident, and two rows for the same pair would collide on the
    // unique key and lose the whole submission over a duplicate the person did not intend.
    const seen = new Map<string, { channelType: string; marketplace: string }>();
    for (const c of requested) {
      const channelType = (c.channelType ?? '').trim().toLowerCase();
      if (!channelType) continue;
      // Empty marketplace is meaningful — it covers the whole channel type — so it is normalised
      // rather than rejected.
      const marketplace = (c.marketplace ?? '').trim().toUpperCase();
      seen.set(`${channelType}|${marketplace}`, { channelType, marketplace });
    }
    const channels = [...seen.values()];
    if (channels.length === 0) throw new BadRequestException('Pick at least one channel');

    /**
     * All of them, or none.
     *
     * A brand letter is one instruction. Half of it recorded and half refused is the worst outcome
     * available: the screen would show a partial rule that reads as complete, and nobody would know
     * which marketplaces were missing.
     */
    return this.prisma.$transaction(async (tx) => {
      const saved: Awaited<ReturnType<typeof tx.brandChannelRestriction.create>>[] = [];
      for (const { channelType, marketplace } of channels) {
        // Re-adding a restriction that was removed should revive it, not collide with the unique key.
        const existing = await tx.brandChannelRestriction.findFirst({
          where: { brandId: dto.brandId, channelType, marketplace },
          select: { id: true },
        });
        saved.push(
          existing
            ? await tx.brandChannelRestriction.update({
                where: { id: existing.id },
                data: { note: dto.note ?? null, deletedAt: null, createdById: actorId },
              })
            : await tx.brandChannelRestriction.create({
                data: { brandId: dto.brandId, channelType, marketplace, note: dto.note ?? null, createdById: actorId },
              }),
        );
      }
      return saved;
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
    @Body()
    dto: {
      brandId: string;
      /** Several at once — a brand letter usually names more than one marketplace. */
      channels?: Array<{ channelType: string; marketplace?: string | null }>;
      /** The older single-channel shape, still accepted. */
      channelType?: string;
      marketplace?: string | null;
      note?: string | null;
    },
    @CurrentUser() u: AuthUser,
  ) { return this.svc.create(dto, u.sub); }

  @Delete(':id') remove(@Param('id') id: string) { return this.svc.remove(id); }
}
