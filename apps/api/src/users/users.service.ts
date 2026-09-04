import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { resolveAccess, sanitiseGrants, validateGrants, describeAccess } from '../access/resolve';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AccessService } from '../access/access.service';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    // Every write here changes what somebody may do, so the resolved copy has to go. Without this
    // a revoked permission would keep working for the length of the cache window — short, but the
    // wrong shape of wrong: revocation should be immediate or it is not revocation.
    private readonly access: AccessService,
  ) {}

  private shape(user: any) {
    const { passwordHash, companyAccess, moduleAccess, role, ...rest } = user;
    // Resolved here rather than in the browser so the page and the guard can never disagree about
    // what somebody holds — there is one implementation of that question and this is it.
    const access = resolveAccess({
      isAdmin: user.isAdmin,
      role: role && !role.deletedAt ? sanitiseGrants(role.grants) : null,
      overrides: sanitiseGrants(user.accessOverrides),
    });
    return {
      ...rest,
      companyIds: companyAccess?.map((a: any) => a.companyId) ?? [],
      moduleIds: moduleAccess?.map((a: any) => a.moduleId) ?? [],
      role: role ? { id: role.id, key: role.key, name: role.name } : null,
      accessOverrides: sanitiseGrants(user.accessOverrides),
      access,
      accessSummary: describeAccess(access),
    };
  }

  /** Refuse an unknown key with a message rather than dropping it where nobody will notice. */
  private checkOverrides(raw: unknown) {
    const res = validateGrants(raw ?? {});
    if (!res.ok) throw new BadRequestException(res.errors.join(' '));
    return res.grants;
  }

  async list() {
    const users = await this.prisma.user.findMany({
      where: { deletedAt: null },
      include: { companyAccess: true, moduleAccess: true, role: true },
      orderBy: { fullName: 'asc' },
    });
    return users.map((u) => this.shape(u));
  }

  async get(id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      include: { companyAccess: true, moduleAccess: true, role: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return this.shape(user);
  }

  async create(dto: CreateUserDto, actorId?: string) {
    const email = dto.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new BadRequestException('A user with this email already exists');

    // New users default to all-access unless explicit grant lists are supplied.
    const companyIds =
      dto.companyIds ??
      (await this.prisma.company.findMany({ where: { deletedAt: null }, select: { id: true } })).map(
        (c) => c.id,
      );
    const moduleIds =
      dto.moduleIds ??
      (await this.prisma.module.findMany({ select: { id: true } })).map((m) => m.id);

    const user = await this.prisma.user.create({
      data: {
        fullName: dto.fullName,
        email,
        passwordHash: await bcrypt.hash(dto.password, 10),
        isAdmin: dto.isAdmin ?? false,
        status: dto.status ?? 'active',
        createdById: actorId,
        updatedById: actorId,
        roleId: dto.roleId ?? null,
        accessOverrides: (dto.accessOverrides !== undefined ? this.checkOverrides(dto.accessOverrides) : undefined) as any,
        companyAccess: { create: companyIds.map((companyId) => ({ companyId })) },
        moduleAccess: { create: moduleIds.map((moduleId) => ({ moduleId })) },
      },
      include: { companyAccess: true, moduleAccess: true, role: true },
    });
    this.access.invalidate(user.id);
    return this.shape(user);
  }

  async update(id: string, dto: UpdateUserDto, actorId?: string) {
    await this.get(id);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          fullName: dto.fullName,
          email: dto.email?.toLowerCase(),
          isAdmin: dto.isAdmin,
          status: dto.status,
          // `undefined` leaves them alone; null on roleId clears it deliberately.
          ...(dto.roleId !== undefined ? { roleId: dto.roleId } : {}),
          ...(dto.accessOverrides !== undefined ? { accessOverrides: this.checkOverrides(dto.accessOverrides) as any } : {}),
          updatedById: actorId,
          ...(dto.password ? { passwordHash: await bcrypt.hash(dto.password, 10) } : {}),
        },
      });

      if (dto.companyIds) {
        await tx.userCompanyAccess.deleteMany({ where: { userId: id } });
        if (dto.companyIds.length) {
          await tx.userCompanyAccess.createMany({
            data: dto.companyIds.map((companyId) => ({ userId: id, companyId })),
          });
        }
      }
      if (dto.moduleIds) {
        await tx.userModuleAccess.deleteMany({ where: { userId: id } });
        if (dto.moduleIds.length) {
          await tx.userModuleAccess.createMany({
            data: dto.moduleIds.map((moduleId) => ({ userId: id, moduleId })),
          });
        }
      }
    });

    this.access.invalidate(id);
    return this.get(id);
  }

  async remove(id: string) {
    await this.get(id);
    await this.prisma.user.update({ where: { id }, data: { deletedAt: new Date() } });
    // A deleted user must stop being able to act now, not when their cached set happens to expire.
    this.access.invalidate(id);
    return { ok: true };
  }
}
