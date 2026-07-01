import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ModulesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Module catalogue with, per module, the companies that have it enabled and (for
   *  shareable modules) the companies that co-own its records. */
  async list() {
    const modules = await this.prisma.module.findMany({
      orderBy: { sortOrder: 'asc' },
      include: {
        companyModules: { where: { enabled: true, deletedAt: null } },
        moduleSharings: { where: { deletedAt: null } },
      },
    });
    return modules.map((m) => ({
      id: m.id,
      key: m.key,
      name: m.name,
      status: m.status,
      isCore: m.isCore,
      shareable: m.shareable,
      enabledCompanyIds: m.companyModules.map((cm) => cm.companyId),
      sharedCompanyIds: m.moduleSharings.map((s) => s.companyId),
    }));
  }

  /** Replace the set of companies that participate in a module (enablement, and
   *  sharing for shareable modules). */
  async setParticipants(key: string, companyIds: string[]) {
    const module = await this.prisma.module.findUnique({ where: { key } });
    if (!module) throw new NotFoundException('Module not found');

    await this.prisma.$transaction(async (tx) => {
      // Enablement: disable all, then enable/insert the requested set.
      await tx.companyModule.updateMany({
        where: { moduleId: module.id },
        data: { enabled: false },
      });
      for (const companyId of companyIds) {
        await tx.companyModule.upsert({
          where: { companyId_moduleId: { companyId, moduleId: module.id } },
          create: { companyId, moduleId: module.id, enabled: true },
          update: { enabled: true, deletedAt: null },
        });
      }

      // Sharing applies only to shareable modules.
      if (module.shareable) {
        await tx.moduleSharing.deleteMany({ where: { moduleId: module.id } });
        if (companyIds.length) {
          await tx.moduleSharing.createMany({
            data: companyIds.map((companyId) => ({ companyId, moduleId: module.id })),
          });
        }
      }
    });

    return this.list();
  }
}
