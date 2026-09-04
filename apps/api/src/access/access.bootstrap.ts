import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AccessService } from './access.service';
import { DEFAULT_ROLES } from './default-roles';

/**
 * Make sure the shipped roles exist, every time the API starts.
 *
 * Roles are not optional data. With enforcement on, a user holding no role holds nothing, so a
 * deployment that migrates the schema and stops there locks out everyone who is not a platform
 * admin. That is the same category of requirement as a migration, and it belongs in the same place
 * — the boot sequence — rather than in a script somebody has to remember.
 *
 * It also has to live here rather than in `scripts/`, because the runtime image does not contain
 * that directory: the first attempt to run it on production failed with MODULE_NOT_FOUND, which is
 * exactly the kind of step that gets skipped at the worst moment.
 *
 * Reads DEFAULT_ROLES directly, so there is one definition of a role and the guard, the Access page
 * and the seed can never describe it differently.
 */
@Injectable()
export class AccessBootstrap implements OnApplicationBootstrap {
  private readonly logger = new Logger(AccessBootstrap.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      // Whether this is the first time roles have ever existed here decides if anyone is
      // back-filled below. Checked BEFORE the upsert, or the answer is always "no".
      const existing = await this.prisma.role.count();
      const firstRun = existing === 0;

      for (const [i, role] of DEFAULT_ROLES.entries()) {
        await this.prisma.role.upsert({
          where: { key: role.key },
          create: {
            key: role.key,
            name: role.name,
            description: role.description,
            grants: role.grants as any,
            isSystem: true,
            sortOrder: i,
          },
          // Kept current with the code on every boot: a role edited here in the database would
          // otherwise drift from the catalogue the guard enforces. Deliberate local edits to a
          // SYSTEM role are not a thing we support — that is what a custom role is for.
          update: { name: role.name, description: role.description, grants: role.grants as any, sortOrder: i },
        });
      }

      if (firstRun) {
        // One-time, and only on the boot that created the roles. Assigning on every start would
        // fight an administrator who has deliberately left somebody with no role, holding only
        // their own overrides — which the Access page offers as a real choice.
        const operations = await this.prisma.role.findUnique({ where: { key: 'operations' }, select: { id: true } });
        if (operations) {
          const { count } = await this.prisma.user.updateMany({
            where: { deletedAt: null, isAdmin: false, roleId: null },
            data: { roleId: operations.id },
          });
          if (count) {
            // Like-for-like rather than aspirational: before enforcement these people could reach
            // everything, so Operations is the closest honest description of what they already had.
            // Narrowing them is a deliberate act, not a side effect of a deploy.
            this.logger.log(`First run — assigned Operations to ${count} existing user(s). Narrow them from Users → Access.`);
          }
        }
      }

      this.access.invalidate();
      this.logger.log(`Access roles ready (${DEFAULT_ROLES.length} system roles).`);
    } catch (e: any) {
      // Loud, but never fatal. An API that refuses to start because it could not touch one table is
      // worse than one that starts with the roles it already had — and on any boot after the first
      // they are already there.
      this.logger.error(`Could not seed access roles: ${e?.message ?? e}`);
    }
  }
}
