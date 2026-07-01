/* maSquare — Module 1 (Foundation) seed.
 * Idempotent: safe to run repeatedly. Creates the module catalogue, two companies with
 * VAT registrations + contacts, enables & shares the Products module across both, and a
 * seeded admin user (all-access). Product catalogue + Global Settings reference data are
 * Modules 2-3 — intentionally not seeded in this slice. */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { COUNTRIES } from './countries.data';

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

  // 6. Global Settings reference data (Module 2) — platform-global.
  await seedReferenceData();
  await seedCountries();

  // 7. Sample product catalogue (Module 3), co-owned by both companies.
  await seedProducts(companyIds);

  // eslint-disable-next-line no-console
  console.log(
    [
      '',
      'maSquare seed complete.',
      `  Companies : ${ama.officialName}, ${nk.officialName}`,
      `  Modules   : ${MODULES.length} in catalogue; Products shared across both companies`,
      '  Global settings: vendors, brands, product/fulfilment types, category tree, attributes',
      `  Countries : ${COUNTRIES.length} preloaded (EU VAT flags + rates)`,
      '  Products  : 10 sample products with aliases + attributes, co-owned by both companies',
      '  Admin login:',
      `    email    : ${adminEmail}`,
      `    password : ${adminPassword}`,
      '',
    ].join('\n'),
  );
}

async function seedReferenceData() {
  // Fulfilment types
  for (const ft of [
    { name: 'Fulfilled by Amazon', code: 'FBA' },
    { name: 'Fulfilled by Merchant', code: 'FBM' },
  ]) {
    const exists = await prisma.fulfilmentType.findFirst({ where: { code: ft.code, deletedAt: null } });
    if (!exists) await prisma.fulfilmentType.create({ data: { ...ft, active: true } });
  }

  // Vendors (with a contact each)
  for (const v of [
    { name: 'THETACO Traders Ltd', addressCountry: 'CY', contact: 'Sales' },
    { name: 'Aegean Wholesale Ltd', addressCountry: 'GR', contact: 'Accounts' },
  ]) {
    const exists = await prisma.vendor.findFirst({ where: { name: v.name, deletedAt: null } });
    if (!exists) {
      await prisma.vendor.create({
        data: {
          name: v.name,
          addressCountry: v.addressCountry,
          contacts: { create: [{ contactName: v.contact, contactType: 'department', contactRole: v.contact }] },
        },
      });
    }
  }

  // Brands
  for (const name of ['Remington', 'BaByliss', 'Philips', 'Braun', 'Dyson']) {
    const exists = await prisma.brand.findFirst({ where: { name, deletedAt: null } });
    if (!exists) await prisma.brand.create({ data: { name } });
  }

  // Product types
  for (const name of ['Hair Straightener', 'Shaver', 'Trimmer', 'Hair Dryer']) {
    const exists = await prisma.productType.findFirst({ where: { name, deletedAt: null } });
    if (!exists) await prisma.productType.create({ data: { name } });
  }

  // Category tree: Personal Care > Hair > { Straighteners, Dryers } ; Personal Care > Shaving
  const findOrCreateCategory = async (name: string, parentId: string | null) => {
    const existing = await prisma.productCategory.findFirst({ where: { name, parentId, deletedAt: null } });
    if (existing) return existing;
    return prisma.productCategory.create({ data: { name, parentId } });
  };
  const personalCare = await findOrCreateCategory('Personal Care', null);
  const hair = await findOrCreateCategory('Hair', personalCare.id);
  await findOrCreateCategory('Straighteners', hair.id);
  await findOrCreateCategory('Dryers', hair.id);
  await findOrCreateCategory('Shaving', personalCare.id);

  // Attributes: one predefined, one free-text
  const plug = await prisma.attribute.findFirst({ where: { name: 'Plug Type', deletedAt: null } });
  if (!plug) {
    await prisma.attribute.create({
      data: {
        name: 'Plug Type',
        inputType: 'predefined',
        values: { create: [{ value: 'UK' }, { value: 'EU' }, { value: 'US' }] },
      },
    });
  }
  const voltage = await prisma.attribute.findFirst({ where: { name: 'Voltage', deletedAt: null } });
  if (!voltage) {
    await prisma.attribute.create({
      data: {
        name: 'Voltage',
        inputType: 'free_text',
        values: { create: [{ value: '220–240V' }, { value: '100–240V' }] },
      },
    });
  }

  // Platform settings singleton
  const settings = await prisma.platformSettings.findFirst();
  if (!settings) await prisma.platformSettings.create({ data: {} });
}

async function seedCountries() {
  for (const c of COUNTRIES) {
    await prisma.country.upsert({
      where: { isoCode: c.isoCode },
      create: c,
      update: { name: c.name, continent: c.continent, euVatZone: c.euVatZone, vatRate: c.vatRate },
    });
  }
}

async function seedProducts(companyIds: string[]) {
  // Resolve reference ids by natural key.
  const brands = new Map((await prisma.brand.findMany()).map((b) => [b.name, b.id]));
  const vendors = new Map((await prisma.vendor.findMany()).map((v) => [v.name, v.id]));
  const types = new Map((await prisma.productType.findMany()).map((t) => [t.name, t.id]));
  const fts = new Map((await prisma.fulfilmentType.findMany()).map((f) => [f.code ?? f.name, f.id]));
  const cats = new Map((await prisma.productCategory.findMany()).map((c) => [c.name, c.id]));
  const attrs = new Map((await prisma.attribute.findMany()).map((a) => [a.name, a.id]));

  type Spec = {
    sku: string; title: string; brand: string; vendor: string; type: string; ft: string;
    cat: string; cost: number; aliases?: string[]; attrs?: [string, string][];
  };
  const specs: Spec[] = [
    { sku: 'RE-S8540', title: 'Remington S8540 Keratin Protect Straightener', brand: 'Remington', vendor: 'THETACO Traders Ltd', type: 'Hair Straightener', ft: 'FBA', cat: 'Straighteners', cost: 50.0, aliases: ['RE-S8540-FBA'], attrs: [['Voltage', '220–240V']] },
    { sku: 'BA-9000', title: 'BaByliss 9000 Cordless Straightener', brand: 'BaByliss', vendor: 'THETACO Traders Ltd', type: 'Hair Straightener', ft: 'FBM', cat: 'Straighteners', cost: 72.4, attrs: [['Voltage', '100–240V']] },
    { sku: 'PH-BT7240', title: 'Philips Series 7000 Beard Trimmer', brand: 'Philips', vendor: 'Aegean Wholesale Ltd', type: 'Trimmer', ft: 'FBA', cat: 'Shaving', cost: 38.15, aliases: ['PH-BT7240-FBA', 'NK-BT7240'], attrs: [['Voltage', '100–240V'], ['Plug Type', 'EU']] },
    { sku: 'BR-S9-4200', title: 'Braun Series 9 Electric Shaver 4200', brand: 'Braun', vendor: 'THETACO Traders Ltd', type: 'Shaver', ft: 'FBM', cat: 'Shaving', cost: 144.9, attrs: [['Plug Type', 'EU']] },
    { sku: 'DY-HD08', title: 'Dyson Supersonic Hair Dryer HD08', brand: 'Dyson', vendor: 'Aegean Wholesale Ltd', type: 'Hair Dryer', ft: 'FBA', cat: 'Dryers', cost: 289.0, aliases: ['DY-HD08-EU'], attrs: [['Voltage', '220–240V'], ['Plug Type', 'EU']] },
    { sku: 'RE-D3190', title: 'Remington D3190 Hair Dryer', brand: 'Remington', vendor: 'THETACO Traders Ltd', type: 'Hair Dryer', ft: 'FBM', cat: 'Dryers', cost: 28.5, attrs: [['Voltage', '220–240V']] },
    { sku: 'PH-S5588', title: 'Philips Shaver Series 5000', brand: 'Philips', vendor: 'Aegean Wholesale Ltd', type: 'Shaver', ft: 'FBA', cat: 'Shaving', cost: 89.0, attrs: [['Plug Type', 'UK']] },
    { sku: 'BA-ST495E', title: 'BaByliss Smooth Finish Straightener', brand: 'BaByliss', vendor: 'THETACO Traders Ltd', type: 'Hair Straightener', ft: 'FBA', cat: 'Straighteners', cost: 41.2 },
    { sku: 'BR-MGK7', title: 'Braun MGK7 Multi Grooming Kit', brand: 'Braun', vendor: 'Aegean Wholesale Ltd', type: 'Trimmer', ft: 'FBM', cat: 'Shaving', cost: 55.75, attrs: [['Voltage', '100–240V']] },
    { sku: 'DY-AB14', title: 'Dyson Airwrap Complete', brand: 'Dyson', vendor: 'THETACO Traders Ltd', type: 'Hair Dryer', ft: 'FBA', cat: 'Dryers', cost: 399.0, aliases: ['DY-AB14-FBA'], attrs: [['Plug Type', 'UK']] },
  ];

  for (const s of specs) {
    const exists = await prisma.product.findUnique({ where: { mainSku: s.sku } });
    if (exists) continue;
    await prisma.product.create({
      data: {
        mainSku: s.sku,
        title: s.title,
        brandId: brands.get(s.brand) ?? null,
        vendorId: vendors.get(s.vendor) ?? null,
        productTypeId: types.get(s.type) ?? null,
        fulfilmentTypeId: fts.get(s.ft) ?? null,
        categoryId: cats.get(s.cat) ?? null,
        countryOfOrigin: 'CN',
        purchaseCostAmount: s.cost,
        purchaseCostCurrency: 'EUR',
        packageLengthCm: 20,
        packageWidthCm: 12,
        packageHeightCm: 6,
        productWeightKg: 0.5,
        aliases: s.aliases?.length ? { create: s.aliases.map((skuValue) => ({ skuValue })) } : undefined,
        attributes: s.attrs?.length
          ? {
              create: s.attrs
                .filter(([name]) => attrs.has(name))
                .map(([name, value]) => ({ attributeId: attrs.get(name)!, value })),
            }
          : undefined,
        companies: { create: companyIds.map((companyId) => ({ companyId })) },
      },
    });
  }
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
