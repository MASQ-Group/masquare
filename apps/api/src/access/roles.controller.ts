import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { AccessService } from './access.service';
import { AccessArea } from './access.decorators';
import { validateGrants } from './resolve';

interface RoleBody {
  name?: string;
  description?: string | null;
  grants?: unknown;
}

@ApiTags('roles')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@AccessArea('administration')
@Controller('roles')
export class RolesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  @Get()
  async list() {
    const roles = await this.prisma.role.findMany({
      where: { deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { users: { where: { deletedAt: null } } } } },
    });
    return roles.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description,
      isSystem: r.isSystem,
      grants: r.grants,
      userCount: r._count.users,
    }));
  }

  @Post()
  async create(@Body() body: RoleBody & { key?: string }, @CurrentUser() user: AuthUser) {
    const name = body.name?.trim();
    if (!name) throw new BadRequestException('Give the role a name');
    const grants = this.checkGrants(body.grants);

    // Derived from the name rather than typed, because the key is only ever used to find the role
    // in code and a hand-entered one is a thing to get wrong for no benefit.
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'role';
    let key = base;
    for (let n = 2; await this.prisma.role.findUnique({ where: { key } }); n++) key = `${base}_${n}`;

    const created = await this.prisma.role.create({
      data: {
        key,
        name,
        description: body.description?.trim() || null,
        grants: grants as any,
        // Only the seeded roles are system roles; anything made here can be deleted again.
        isSystem: false,
        sortOrder: 100,
        createdById: user.sub,
        updatedById: user.sub,
      },
    });
    return { id: created.id, key: created.key };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: RoleBody, @CurrentUser() user: AuthUser) {
    const existing = await this.prisma.role.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Role not found');

    await this.prisma.role.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.description !== undefined ? { description: body.description?.trim() || null } : {}),
        ...(body.grants !== undefined ? { grants: this.checkGrants(body.grants) as any } : {}),
        updatedById: user.sub,
      },
    });

    // Everyone's resolved copy, not just this role's holders: finding who held it costs a query and
    // the recovery is one re-read per active user.
    this.access.invalidate();
    return { ok: true };
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    const role = await this.prisma.role.findFirst({
      where: { id, deletedAt: null },
      include: { _count: { select: { users: { where: { deletedAt: null } } } } },
    });
    if (!role) throw new NotFoundException('Role not found');

    // A system role is what the platform falls back to and what the seed script re-creates;
    // deleting one would come back on the next deploy having achieved nothing but confusion.
    if (role.isSystem) throw new BadRequestException(`${role.name} ships with the platform and cannot be deleted. Edit it instead.`);

    // Refused rather than cascaded: the user rows survive a role deletion by design, but they would
    // survive holding nothing, which is a silent lockout dressed up as a tidy-up.
    if (role._count.users > 0) {
      throw new BadRequestException(
        `${role.name} is held by ${role._count.users} user${role._count.users === 1 ? '' : 's'}. Move them to another role first.`,
      );
    }

    await this.prisma.role.update({ where: { id }, data: { deletedAt: new Date() } });
    this.access.invalidate();
    return { ok: true };
  }

  /** Refuse unknown keys with a message rather than dropping them where nobody will notice. */
  private checkGrants(raw: unknown) {
    const res = validateGrants(raw ?? {});
    if (!res.ok) throw new BadRequestException(res.errors.join(' '));
    return res.grants;
  }
}
