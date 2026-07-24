/* maSquare — Module 1 (Foundation) seed.
 * Idempotent: safe to run repeatedly. Creates the module catalogue, two companies with
 * VAT registrations + contacts, enables & shares the Products module across both, and a
 * seeded admin user (all-access). Product catalogue + Global Settings reference data are
 * Modules 2-3 — intentionally not seeded in this slice. */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { COUNTRIES } from './countries.data';

const prisma = new PrismaClient();

/* Cyprus VAT classes. Zero-rated and Exempt both charge 0% but are distinct on a VAT
 * return, which is why taxTreatment is stored alongside the rate rather than inferred. */
const VAT_CLASSES = [
  { name: 'Standard', ratePct: 19, taxTreatment: 'standard', isDefault: true },
  { name: 'Reduced 9%', ratePct: 9, taxTreatment: 'reduced', isDefault: false },
  { name: 'Reduced 5%', ratePct: 5, taxTreatment: 'reduced', isDefault: false },
  { name: 'Zero-rated', ratePct: 0, taxTreatment: 'zero', isDefault: false },
  { name: 'Exempt', ratePct: 0, taxTreatment: 'exempt', isDefault: false },
];

const MODULES = [
  { key: 'companies', name: 'Companies', status: 'core', isCore: true, shareable: false },
  { key: 'users', name: 'Users & Permissions', status: 'core', isCore: true, shareable: false },
  { key: 'global_settings', name: 'Global Settings', status: 'module-2', isCore: false, shareable: false },
  { key: 'products', name: 'Products', status: 'module-3', isCore: false, shareable: true },
  { key: 'sales_transactions', name: 'Sales Transactions', status: 'module-4', isCore: false, shareable: false },
  { key: 'inventory', name: 'Inventory & Warehouses', status: 'module-5', isCore: false, shareable: false },
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
  const enabledKeys = ['companies', 'users', 'global_settings', 'products', 'sales_transactions'];
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

  // 8. VAT classes + product classes + backfill. After products so the catalogue is covered too.
  await seedVatClasses();
  await seedProductClasses();

  // 9. The Local Sales channel (needs countries seeded for its native country).
  await seedLocalSalesChannel();

  // 10. Chip colours for every channel, from its native country's flag. After the local
  //     channel exists so it gets one too.
  await seedChannelChipColors();

  // 11. A default warehouse so receiving and stock entry have somewhere to land.
  await seedWarehouses();

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
      `  VAT classes: ${VAT_CLASSES.length} Cyprus classes; products without one backfilled to Standard`,
      '  Product classes: Equipment (default) + Service; products without one backfilled to Equipment',
      '  Channels  : Local Sales channel (kind=local, EUR, 0% fee); chip colours from each native flag',
      '  Admin login:',
      `    email    : ${adminEmail}`,
      `    password : ${adminPassword}`,
      '',
    ].join('\n'),
  );
}

async function seedProductClasses() {
  const classes = [
    { name: 'Equipment', isDefault: true },
    { name: 'Service', isDefault: false },
  ];
  for (let i = 0; i < classes.length; i++) {
    const c = classes[i];
    const exists = await prisma.productClass.findFirst({ where: { name: c.name, deletedAt: null } });
    if (!exists) await prisma.productClass.create({ data: { ...c, sortOrder: i } });
  }
  // Every existing product is Equipment until classified otherwise. Scoped to unclassified
  // rows so a later manual choice is never overwritten.
  const equipment = await prisma.productClass.findFirst({ where: { name: 'Equipment', deletedAt: null } });
  if (equipment) {
    await prisma.product.updateMany({ where: { productClassId: null }, data: { productClassId: equipment.id } });
  }
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

/* Channel chip palette, keyed by the channel's native country: a light tint of that flag's
 * most recognisable colour, with a darker shade of the same hue for the text. Only used to
 * seed a sensible default — each channel's colours are editable in Global Settings. */
/* The single colour we first seeded per country. Kept only so the re-seed below can tell an
 * untouched auto-default from a colour the user picked, and leave the latter alone. */
const LEGACY_FLAG_CHIP: Record<string, { bg: string; text: string }> = {
  AE: { bg: '#E6F5EC', text: '#00753C' }, AU: { bg: '#E7EBF5', text: '#00247D' },
  BE: { bg: '#FFF8DC', text: '#8A6D00' }, CA: { bg: '#FDE9EA', text: '#C8102E' },
  CY: { bg: '#FDF1E0', text: '#B45F06' }, DE: { bg: '#FFF6D6', text: '#7A5C00' },
  ES: { bg: '#FBE9E9', text: '#AA151B' }, FR: { bg: '#E6EEF6', text: '#0055A4' },
  GB: { bg: '#E6E9F0', text: '#012169' }, GR: { bg: '#E6EFF7', text: '#0D5EAF' },
  IE: { bg: '#E7F5EE', text: '#0F7A4C' }, IT: { bg: '#E6F4EC', text: '#007A3D' },
  JP: { bg: '#FCE8EC', text: '#BC002D' }, MX: { bg: '#E6F1ED', text: '#006847' },
  NL: { bg: '#FFF0E0', text: '#C25E00' }, PL: { bg: '#FCE9EC', text: '#C4123C' },
  SA: { bg: '#E7F1EA', text: '#165D31' }, SE: { bg: '#E5F0F6', text: '#005E93' },
  SG: { bg: '#FDEAEC', text: '#C31F2C' }, US: { bg: '#E9E9F1', text: '#3C3B6E' },
};

/* Chip palette per native country, as an ORDERED list of variants. Channels sharing a country
 * take different variants, so e.g. Amazon UK / Ebay UK / OnBuy UK stay recognisably British but
 * are still told apart at a glance. Each variant is drawn from that flag's own colours — a
 * different colour from the flag where it has one, otherwise a tint/solid pair of the same hue. */
const FLAG_CHIP_VARIANTS: Record<string, { bg: string; text: string }[]> = {
  // Cyprus — copper island + olive branches. Five channels, so five variants.
  CY: [
    { bg: '#FDF1E0', text: '#B45F06' }, // copper tint
    { bg: '#EDF0E2', text: '#4A5730' }, // olive tint
    { bg: '#D57800', text: '#FFFFFF' }, // copper solid
    { bg: '#4E5B31', text: '#FFFFFF' }, // olive solid
    { bg: '#F6DDBB', text: '#8A4A05' }, // deep copper tint
  ],
  // United Kingdom — navy + red.
  GB: [
    { bg: '#E6E9F0', text: '#012169' }, // navy tint
    { bg: '#FBE9EC', text: '#C8102E' }, // red tint
    { bg: '#012169', text: '#FFFFFF' }, // navy solid
  ],
  DE: [{ bg: '#FFF6D6', text: '#7A5C00' }, { bg: '#FCE8E8', text: '#C1121F' }], // gold, red
  ES: [{ bg: '#FBE9E9', text: '#AA151B' }, { bg: '#FFF7DA', text: '#8A6A00' }], // red, yellow
  FR: [{ bg: '#E6EEF6', text: '#0055A4' }, { bg: '#FDEBEA', text: '#C5342A' }], // blue, red
  IT: [{ bg: '#E6F4EC', text: '#007A3D' }, { bg: '#FBEAEB', text: '#CD212A' }], // green, red
  AU: [{ bg: '#E7EBF5', text: '#00247D' }, { bg: '#FDE9E9', text: '#C41E1E' }], // navy, red
  US: [{ bg: '#E9E9F1', text: '#3C3B6E' }, { bg: '#FAE9EB', text: '#B22234' }], // navy, red
  CA: [{ bg: '#FDE9EA', text: '#C8102E' }, { bg: '#C8102E', text: '#FFFFFF' }], // red tint, red solid
  // Single-channel countries. Hues nudged apart where several flags share one (the greens).
  AE: [{ bg: '#E6F5EC', text: '#00753C' }],
  BE: [{ bg: '#FFF8DC', text: '#8A6D00' }],
  GR: [{ bg: '#E6EFF7', text: '#0D5EAF' }],
  IE: [{ bg: '#FFF1E3', text: '#C86A1A' }], // orange from the tricolour — keeps it off IT's green
  JP: [{ bg: '#FCE8EC', text: '#BC002D' }],
  MX: [{ bg: '#E4EFE9', text: '#00614A' }], // deeper green than IT
  NL: [{ bg: '#FFF0E0', text: '#C25E00' }],
  PL: [{ bg: '#FCE9EC', text: '#C4123C' }],
  SA: [{ bg: '#E4EEE7', text: '#14532D' }], // Saudi's darker green
  SE: [{ bg: '#E5F0F6', text: '#005E93' }],
  SG: [{ bg: '#FDEAEC', text: '#C31F2C' }],
};
const NEUTRAL_CHIP = { bg: '#F1F3F5', text: '#495057' };

/** Give every channel a chip colour from its native country's flag, with channels that share a
 *  country taking different variants so they stay tellable apart.
 *
 *  Only assigns to a channel whose colours are unset OR still the old auto-default for its
 *  country — a colour the user chose is never overwritten. Ordering is by name so the mapping
 *  is stable across runs. */
async function seedChannelChipColors() {
  const channels = await prisma.salesChannel.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, chipBgColor: true, chipTextColor: true, nativeCountry: { select: { isoCode: true } } },
    orderBy: { name: 'asc' },
  });

  const byIso = new Map<string, typeof channels>();
  for (const c of channels) {
    const iso = (c.nativeCountry?.isoCode ?? '').toUpperCase();
    if (!byIso.has(iso)) byIso.set(iso, []);
    byIso.get(iso)!.push(c);
  }

  let updated = 0;
  for (const [iso, group] of byIso) {
    const variants = FLAG_CHIP_VARIANTS[iso] ?? [NEUTRAL_CHIP];
    const legacy = LEGACY_FLAG_CHIP[iso];
    for (let i = 0; i < group.length; i++) {
      const c = group[i];
      const isUnset = !c.chipBgColor || !c.chipTextColor;
      const isLegacyDefault = !!legacy && c.chipBgColor === legacy.bg && c.chipTextColor === legacy.text;
      const isNeutral = c.chipBgColor === NEUTRAL_CHIP.bg && c.chipTextColor === NEUTRAL_CHIP.text;
      if (!isUnset && !isLegacyDefault && !isNeutral) continue; // user-chosen — leave it
      // More channels than variants (shouldn't happen today) → cycle rather than crash.
      const v = variants[i % variants.length];
      if (c.chipBgColor === v.bg && c.chipTextColor === v.text) continue;
      await prisma.salesChannel.update({ where: { id: c.id }, data: { chipBgColor: v.bg, chipTextColor: v.text } });
      updated++;
    }
  }
  return updated;
}

/** The single Local Sales channel — our own direct/walk-in sales, entered by hand.
 *  EUR with a zero fee, so a local sale needs no FX conversion and no marketplace deduction.
 *  Idempotent on kind: there is deliberately only ever one local channel. */
async function seedLocalSalesChannel() {
  const existing = await prisma.salesChannel.findFirst({ where: { kind: 'local', deletedAt: null } });
  if (existing) {
    // A local sale has no marketplace tax reporting, so a transaction Total is always
    // meaningful here. Scoped to the local channel — never touches a marketplace's setting.
    if (!existing.showTransactionTotal) {
      await prisma.salesChannel.update({ where: { id: existing.id }, data: { showTransactionTotal: true } });
    }
    return;
  }
  const cy = await prisma.country.findFirst({ where: { isoCode: 'CY' } });
  await prisma.salesChannel.create({
    data: {
      name: 'Local Sales',
      description: 'Direct and walk-in sales invoiced by us. VAT is charged per line from the product’s VAT class.',
      kind: 'local',
      nativeCountryId: cy?.id ?? null,
      nativeCurrency: 'EUR',
      generalSalesFeePct: 0,
      showTransactionTotal: true,
    },
  });
}

/** Starter warehouses. Only created when none exist — never touches a real tree.
 *  "Main Warehouse" holds sellable stock; "Damaged Goods" shows what we hold but
 *  cannot sell, which is exactly what include_in_inventory=false is for. */
async function seedWarehouses() {
  const any = await prisma.warehouse.findFirst({ where: { deletedAt: null }, select: { id: true } });
  if (any) return;

  const main = await prisma.warehouse.create({
    data: { name: 'Main Warehouse', type: 'physical', includeInInventory: true, notes: 'Default receiving and dispatch location.' },
  });
  await prisma.warehouse.create({
    data: {
      name: 'Damaged Goods',
      type: 'virtual',
      parentWarehouseId: main.id,
      includeInInventory: false,
      notes: 'Held stock that is not sellable. Excluded from availability.',
    },
  });
}

async function seedVatClasses() {
  for (let i = 0; i < VAT_CLASSES.length; i++) {
    const vc = VAT_CLASSES[i];
    const exists = await prisma.vatClass.findFirst({ where: { name: vc.name, deletedAt: null } });
    if (!exists) await prisma.vatClass.create({ data: { ...vc, sortOrder: i } });
  }

  // Give every product a class so a local sale line always has a VAT rate to default to.
  // Scoped to rows that have none — never touches a product whose class was set deliberately.
  const standard = await prisma.vatClass.findFirst({ where: { isDefault: true, deletedAt: null } });
  if (standard) {
    await prisma.product.updateMany({ where: { vatClassId: null }, data: { vatClassId: standard.id } });
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
