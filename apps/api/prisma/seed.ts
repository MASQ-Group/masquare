/* maSquare — Module 1 (Foundation) seed.
 * Idempotent: safe to run repeatedly. Creates the module catalogue, two companies with
 * VAT registrations + contacts, enables & shares the Products module across both, and a
 * seeded admin user (all-access). Product catalogue + Global Settings reference data are
 * Modules 2-3 — intentionally not seeded in this slice. */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const MODULES = [
  { key: 'companies', name: 'Companies', status: 'core', isCore: true, shareable: false },
  { key: 'users', name: 'Users & Permissions', status: 'core', isCore: true, shareable: false },
  { key: 'global_settings', name: 'Global Settings', status: 'module-2', isCore: false, shareable: false },
  { key: 'products', name: 'Products', status: 'module-3', isCore: false, shareable: true },
  { key: 'inventory', name: 'Inventory & Warehouses', status: 'future', isCore: false, shareable: false },
  { key: 'integrations', name: 'Marketplace Integrations', status: 'future', isCore: false, shareable: false },
  { key: 'tax_finance', name: 'Tax & Financial', status: 'future', isCore: false, shareable: false },
  { key: 'analytics', name: 'Analytics', status: 'future', isCore: false, shareable: false },
  { key: 'assets', name: 'Assets', status: 'future', isCore: false, shareable: false },
];

async function upsertCompany(input: {
  officialName: string;
  registrationNumber?: string;
  addressCity?: string;
  addressCountry?: string;
  email?: string;
  vats: { country: string; vatNumber: string }[];
  contacts: { name: string; surname?: string; email?: string; role?: string }[];
}) {
  const existing = await prisma.company.findFirst({
    where: { officialName: input.officialName, deletedAt: null },
  });
  if (existing) return existing;

  return prisma.company.create({
    data: {
      officialName: input.officialName,
      registrationNumber: input.registrationNumber,
      addressCity: input.addressCity,
      addressCountry: input.addressCountry,
      email: input.email,
      vatRegistrations: { create: input.vats },
      contactPersons: { create: input.contacts },
    },
  });
}

async function main() {
  // 1. Module catalogue
  const modules: Record<string, { id: string }> = {};
  for (let i = 0; i < MODULES.length; i++) {
    const m = MODULES[i];
    const row = await prisma.module.upsert({
      where: { key: m.key },
      create: { ...m, sortOrder: i },
      update: { name: m.name, status: m.status, isCore: m.isCore, shareable: m.shareable, sortOrder: i },
    });
    modules[m.key] = row;
  }

  // 2. Companies
  const ama = await upsertCompany({
    officialName: 'A.M.A. MASQUARE LTD',
    addressCity: 'Nicosia',
    addressCountry: 'CY',
    email: 'info@masquare.com',
    vats: [{ country: 'CY', vatNumber: 'CY10156304C' }],
    contacts: [{ name: 'Andreas', surname: 'M.', role: 'Director', email: 'andreas@masquare.com' }],
  });
  const nk = await upsertCompany({
    officialName: 'N.K. MULTITRADE CORPORATION LTD',
    addressCity: 'Limassol',
    addressCountry: 'CY',
    email: 'info@nkmultitrade.com',
    vats: [
      { country: 'CY', vatNumber: 'CY10402024X' },
      { country: 'IT', vatNumber: 'IT00441109998' },
    ],
    contacts: [{ name: 'Nikos', surname: 'K.', role: 'Director', email: 'nikos@nkmultitrade.com' }],
  });
  const companyIds = [ama.id, nk.id];

  // 3. Enable core + Products + Global Settings for both companies
  const enabledKeys = ['companies', 'users', 'global_settings', 'products'];
  for (const companyId of companyIds) {
    for (const key of enabledKeys) {
      await prisma.companyModule.upsert({
        where: { companyId_moduleId: { companyId, moduleId: modules[key].id } },
        create: { companyId, moduleId: modules[key].id, enabled: true },
        update: { enabled: true, deletedAt: null },
      });
    }
  }

  // 4. Share the Products module across both companies (co-ownership)
  await prisma.moduleSharing.deleteMany({ where: { moduleId: modules['products'].id } });
  await prisma.moduleSharing.createMany({
    data: companyIds.map((companyId) => ({ companyId, moduleId: modules['products'].id })),
  });

  // 5. Seeded admin (all-access)
  const adminEmail = (process.env.ADMIN_EMAIL ?? 'admin@masquare.local').toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD ?? 'masquare-admin';
  const allModuleIds = Object.values(modules).map((m) => m.id);

  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!existingAdmin) {
    await prisma.user.create({
      data: {
        fullName: 'Platform Admin',
        email: adminEmail,
        passwordHash: await bcrypt.hash(adminPassword, 10),
        isAdmin: true,
        status: 'active',
        companyAccess: { create: companyIds.map((companyId) => ({ companyId })) },
        moduleAccess: { create: allModuleIds.map((moduleId) => ({ moduleId })) },
      },
    });
  }

  // eslint-disable-next-line no-console
  console.log(
    [
      '',
      'maSquare seed complete.',
      `  Companies : ${ama.officialName}, ${nk.officialName}`,
      `  Modules   : ${MODULES.length} in catalogue; Products shared across both companies`,
      '  Admin login:',
      `    email    : ${adminEmail}`,
      `    password : ${adminPassword}`,
      '',
    ].join('\n'),
  );
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
