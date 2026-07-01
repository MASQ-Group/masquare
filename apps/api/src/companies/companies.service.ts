import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCompanyDto, UpdateCompanyDto } from './dto/company.dto';

const companyInclude = {
  vatRegistrations: { where: { deletedAt: null } },
  contactPersons: { where: { deletedAt: null } },
} as const;

@Injectable()
export class CompaniesService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.company.findMany({
      where: { deletedAt: null },
      include: companyInclude,
      orderBy: { officialName: 'asc' },
    });
  }

  async get(id: string) {
    const company = await this.prisma.company.findFirst({
      where: { id, deletedAt: null },
      include: companyInclude,
    });
    if (!company) throw new NotFoundException('Company not found');
    return company;
  }

  async create(dto: CreateCompanyDto, actorId?: string) {
    const { vatRegistrations, contactPersons, ...data } = dto;
    return this.prisma.company.create({
      data: {
        ...data,
        createdById: actorId,
        updatedById: actorId,
        vatRegistrations: vatRegistrations?.length
          ? { create: vatRegistrations }
          : undefined,
        contactPersons: contactPersons?.length ? { create: contactPersons } : undefined,
      },
      include: companyInclude,
    });
  }

  async update(id: string, dto: UpdateCompanyDto, actorId?: string) {
    await this.get(id);
    const { vatRegistrations, contactPersons, ...data } = dto;

    // Replace-on-update for the nested collections (soft-delete the old rows).
    return this.prisma.$transaction(async (tx) => {
      if (vatRegistrations) {
        await tx.companyVatRegistration.updateMany({
          where: { companyId: id, deletedAt: null },
          data: { deletedAt: new Date() },
        });
        if (vatRegistrations.length) {
          await tx.companyVatRegistration.createMany({
            data: vatRegistrations.map((v) => ({ ...v, companyId: id })),
          });
        }
      }
      if (contactPersons) {
        await tx.companyContactPerson.updateMany({
          where: { companyId: id, deletedAt: null },
          data: { deletedAt: new Date() },
        });
        if (contactPersons.length) {
          await tx.companyContactPerson.createMany({
            data: contactPersons.map((c) => ({ ...c, companyId: id })),
          });
        }
      }
      return tx.company.update({
        where: { id },
        data: { ...data, updatedById: actorId },
        include: companyInclude,
      });
    });
  }

  async remove(id: string) {
    await this.get(id);
    await this.prisma.company.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return { ok: true };
  }
}
