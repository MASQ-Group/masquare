import { PrismaClient } from '@prisma/client';

/**
 * The compliance vocabularies, as shipped.
 *
 * These are the values a person picks from on the product card, and the values the eligibility
 * rules compare against. They are seeded rather than hard-coded so that a value nobody anticipated
 * can be added in Global Settings without a deploy — and upserted by (kind, code) so re-running
 * this never duplicates a row or overwrites a label somebody has deliberately edited.
 */

interface Option {
  code: string;
  label: string;
  numericMin?: number;
  numericMax?: number;
  note?: string;
}

/**
 * Mains ratings, carrying the range the rules compare.
 *
 * The range is the whole reason this is a vocabulary: "220-240V" as text tells a rule nothing,
 * while 220–240 tells it everything. Ratings that are not mains-powered carry no range, which is
 * what makes them pass every market rather than fail for want of a number.
 */
const VOLTAGE_RATING: Option[] = [
  { code: '220-240V', label: '220–240V (EU/UK/AU)', numericMin: 220, numericMax: 240 },
  { code: '100-120V', label: '100–120V (US/CA/JP)', numericMin: 100, numericMax: 127 },
  { code: '100-240V', label: '100–240V (dual voltage, worldwide)', numericMin: 100, numericMax: 240, note: 'Sellable on every market — the usual answer for chargers and power supplies.' },
  { code: '230V', label: '230V only', numericMin: 230, numericMax: 230 },
  { code: '110V', label: '110V only', numericMin: 110, numericMax: 110 },
  { code: '12V-DC', label: '12V DC', numericMin: 12, numericMax: 12 },
  { code: '24V-DC', label: '24V DC', numericMin: 24, numericMax: 24 },
  { code: 'BATTERY', label: 'Battery powered only', note: 'No mains connection, so no market is excluded on voltage.' },
  { code: 'NONE', label: 'Not electrical' },
];

const FREQUENCY: Option[] = [
  { code: '50', label: '50 Hz' },
  { code: '60', label: '60 Hz' },
  { code: '50/60', label: '50/60 Hz' },
  { code: 'DC', label: 'DC' },
  { code: 'NA', label: 'Not applicable' },
];

/** IEC World Plugs letters. The ones we actually meet are listed first. */
const PLUG_TYPE: Option[] = [
  { code: 'G', label: 'Type G — UK, Ireland, Malta, Cyprus' },
  { code: 'F', label: 'Type F — Schuko: Germany, Netherlands, Spain, Sweden, Poland' },
  { code: 'C', label: 'Type C — Europlug, fits most of continental Europe' },
  { code: 'E', label: 'Type E — France, Belgium, Poland, Czechia' },
  { code: 'L', label: 'Type L — Italy, Chile' },
  { code: 'J', label: 'Type J — Switzerland, Liechtenstein' },
  { code: 'K', label: 'Type K — Denmark, Greenland' },
  { code: 'A', label: 'Type A — US, Canada, Japan (ungrounded)' },
  { code: 'B', label: 'Type B — US, Canada, Japan (grounded)' },
  { code: 'I', label: 'Type I — Australia, New Zealand, China, Argentina' },
  { code: 'D', label: 'Type D — India, Nepal, Sri Lanka' },
  { code: 'M', label: 'Type M — South Africa' },
  { code: 'N', label: 'Type N — Brazil, South Africa' },
  { code: 'H', label: 'Type H — Israel' },
  { code: 'O', label: 'Type O — Thailand' },
  { code: 'USB', label: 'USB powered' },
  { code: 'HARDWIRED', label: 'Hardwired / no plug' },
  { code: 'NONE', label: 'No mains connection' },
];

const BATTERY_TYPE: Option[] = [
  { code: 'NONE', label: 'No battery' },
  { code: 'ALKALINE', label: 'Alkaline (AA, AAA, 9V)' },
  { code: 'LI_ION', label: 'Lithium-ion, rechargeable', note: 'UN3480 loose, UN3481 in or with equipment.' },
  { code: 'LI_METAL', label: 'Lithium metal, non-rechargeable', note: 'UN3090 loose, UN3091 in or with equipment.' },
  { code: 'LI_POLYMER', label: 'Lithium polymer' },
  { code: 'BUTTON_CELL', label: 'Button or coin cell', note: 'Child-safety rules apply in several markets.' },
  { code: 'NIMH', label: 'Nickel-metal hydride (NiMH)' },
  { code: 'NICD', label: 'Nickel-cadmium (NiCd)' },
  { code: 'LEAD_ACID', label: 'Lead-acid' },
  { code: 'BUILT_IN', label: 'Built-in rechargeable, not user-replaceable' },
];

/** UN transport classes, plus the lithium entries that come up most on our catalogue. */
const HAZMAT_CLASS: Option[] = [
  { code: 'NONE', label: 'Not dangerous goods' },
  { code: 'UN3480', label: 'UN3480 — lithium-ion batteries shipped alone' },
  { code: 'UN3481', label: 'UN3481 — lithium-ion batteries in or with equipment' },
  { code: 'UN3090', label: 'UN3090 — lithium metal batteries shipped alone' },
  { code: 'UN3091', label: 'UN3091 — lithium metal batteries in or with equipment' },
  { code: 'CLASS_1', label: 'Class 1 — Explosives' },
  { code: 'CLASS_2_1', label: 'Class 2.1 — Flammable gases (aerosols)' },
  { code: 'CLASS_2_2', label: 'Class 2.2 — Non-flammable, non-toxic gases' },
  { code: 'CLASS_2_3', label: 'Class 2.3 — Toxic gases' },
  { code: 'CLASS_3', label: 'Class 3 — Flammable liquids (alcohol, solvents, perfume)' },
  { code: 'CLASS_4_1', label: 'Class 4.1 — Flammable solids' },
  { code: 'CLASS_4_2', label: 'Class 4.2 — Spontaneously combustible' },
  { code: 'CLASS_4_3', label: 'Class 4.3 — Dangerous when wet' },
  { code: 'CLASS_5_1', label: 'Class 5.1 — Oxidising substances' },
  { code: 'CLASS_5_2', label: 'Class 5.2 — Organic peroxides' },
  { code: 'CLASS_6_1', label: 'Class 6.1 — Toxic substances' },
  { code: 'CLASS_6_2', label: 'Class 6.2 — Infectious substances' },
  { code: 'CLASS_7', label: 'Class 7 — Radioactive material' },
  { code: 'CLASS_8', label: 'Class 8 — Corrosive substances' },
  { code: 'CLASS_9', label: 'Class 9 — Miscellaneous dangerous goods' },
];

const VOCABULARIES: Record<string, Option[]> = {
  VOLTAGE_RATING,
  FREQUENCY,
  PLUG_TYPE,
  BATTERY_TYPE,
  HAZMAT_CLASS,
};

export async function seedComplianceOptions(prisma: PrismaClient): Promise<number> {
  let written = 0;
  for (const [kind, options] of Object.entries(VOCABULARIES)) {
    for (const [i, o] of options.entries()) {
      await prisma.complianceOption.upsert({
        where: { kind_code: { kind, code: o.code } },
        // Only the ordering and the range are refreshed. A label somebody reworded stays reworded —
        // re-running the seed must not undo a deliberate edit.
        update: { sortOrder: i * 10, numericMin: o.numericMin ?? null, numericMax: o.numericMax ?? null },
        create: {
          kind,
          code: o.code,
          label: o.label,
          numericMin: o.numericMin ?? null,
          numericMax: o.numericMax ?? null,
          note: o.note ?? null,
          sortOrder: i * 10,
        },
      });
      written += 1;
    }
  }
  return written;
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seedComplianceOptions(prisma)
    .then((n) => console.log(`Seeded ${n} compliance options.`))
    .catch((e) => { console.error(e); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
