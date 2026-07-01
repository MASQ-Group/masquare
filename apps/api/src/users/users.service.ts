import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  private shape(user: any) {
    const { passwordHash, companyAccess, moduleAccess, ...rest } = user;
    return {
      ...rest,
      companyIds: companyAccess?.map((a: any) => a.companyId) ?? [],
      moduleIds: moduleAccess?.map((a: any) => a.moduleId) ?? [],
    };
  }

  async list() {
    const users = await this.prisma.user.findMany({
      where: { deletedAt: null },
      include: { companyAccess: true, moduleAccess: true },
      orderBy: { fullName: 'asc' },
    });
    return users.map((u) => this.shape(u));
  }

  async get(id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      include: { companyAccess: true, moduleAccess: true },
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
        companyAccess: { create: companyIds.map((companyId) => ({ companyId })) },
        moduleAccess: { create: moduleIds.map((moduleId) => ({ moduleId })) },
      },
      include: { companyAccess: true, moduleAccess: true },
    });
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

    return this.get(id);
  }

  async remove(id: string) {
    await this.get(id);
    await this.prisma.user.update({ where: { id }, data: { deletedAt: new Date() } });
    return { ok: true };
  }
}
