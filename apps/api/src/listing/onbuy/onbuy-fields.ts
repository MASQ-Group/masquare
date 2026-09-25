import type { AspectRecord } from '../../gather/provenance';
import { eligibleValues } from '../../gather/provenance';
import { comparable } from '../../gather/value-match';

/**
 * What an OnBuy category asks a new product for, and how researched answers become OnBuy's request.
 *
 * Two kinds of field, both per category (docs.api.onbuy.com):
 *   - FEATURES — OnBuy's own option lists (Colour, Size, Keywords…). An answer must be one of the
 *     options and is sent as its option id. A category can mark one as required.
 *   - TECHNICAL DETAILS — measurements in groups (Seat Width, in m/cm/mm/in). Sent as a number and
 *     one of the detail's units. Never marked required.
 *
 * Answers are the same evidence records eBay keeps (AspectRecord), folded by the same rules, and only
 * payload-eligible ones are sent: a held-back suggestion is not an answer.
 *
 * PURE.
 */

export interface OnbuyFeatureField {
  kind: 'feature';
  name: string;
  featureId: string;
  required: boolean;
  options: { id: string; name: string }[];
}

export interface OnbuyTechnicalField {
  kind: 'technical';
  name: string;
  detailId: string;
  group: string;
  units: string[];
}

export type OnbuyField = OnbuyFeatureField | OnbuyTechnicalField;

/** The category's fields, named uniquely: a technical detail that shares a feature's name is prefixed with its group. */
export function parseOnbuyFields(featureRows: any[], technicalRows: any[]): OnbuyField[] {
  const features: OnbuyFeatureField[] = (featureRows ?? [])
    .map((f: any) => ({
      kind: 'feature' as const,
      name: String(f?.name ?? '').trim(),
      featureId: f?.feature_id != null ? String(f.feature_id) : '',
      required: f?.required === true || f?.required === 1 || f?.required === '1',
      options: (Array.isArray(f?.options) ? f.options : [])
        .map((o: any) => ({ id: o?.option_id != null ? String(o.option_id) : '', name: String(o?.name ?? '').trim() }))
        .filter((o: { id: string; name: string }) => o.id && o.name),
    }))
    .filter((f) => f.name && f.featureId);

  const taken = new Set(features.map((f) => f.name.toLowerCase()));
  const technical: OnbuyTechnicalField[] = [];
  for (const g of technicalRows ?? []) {
    const group = String(g?.group_name ?? '').trim();
    for (const d of Array.isArray(g?.options) ? g.options : []) {
      const base = String(d?.name ?? '').trim();
      const detailId = d?.detail_id != null ? String(d.detail_id) : '';
      if (!base || !detailId) continue;
      const name = taken.has(base.toLowerCase()) && group ? `${group} › ${base}` : base;
      if (taken.has(name.toLowerCase())) continue;
      taken.add(name.toLowerCase());
      technical.push({
        kind: 'technical', name, detailId, group,
        units: (Array.isArray(d?.units) ? d.units : []).map((u: unknown) => String(u).trim()).filter(Boolean),
      });
    }
  }
  return [...features, ...technical];
}

/** Units as sources write them, to the spelling OnBuy lists. */
const UNIT_WORDS: Record<string, string> = {
  millimetre: 'mm', millimetres: 'mm', millimeter: 'mm', millimeters: 'mm',
  centimetre: 'cm', centimetres: 'cm', centimeter: 'cm', centimeters: 'cm',
  metre: 'm', metres: 'm', meter: 'm', meters: 'm',
  inch: 'in', inches: 'in', '"': 'in', '″': 'in',
  kilogram: 'kg', kilograms: 'kg', kgs: 'kg', gram: 'g', grams: 'g', gr: 'g',
  pound: 'lb', pounds: 'lb', lbs: 'lb', litre: 'l', litres: 'l', liter: 'l', liters: 'l',
  millilitre: 'ml', millilitres: 'ml', milliliter: 'ml', milliliters: 'ml',
  watt: 'w', watts: 'w', volt: 'v', volts: 'v',
};

/** "45 cm", "45cm", "4,5 kg" → number and unit in OnBuy's spelling, or why not. */
export function readMeasurement(value: string, units: string[]): { value: string; unit: string } | { why: string } {
  const m = value.trim().match(/^(-?\d+(?:[.,]\d+)?)\s*([^\d\s].*)?$/);
  if (!m) return { why: 'not a single number with a unit' };
  const number = m[1].replace(',', '.');
  const raw = (m[2] ?? '').trim().toLowerCase().replace(/\.$/, '');
  if (!raw) {
    if (units.length === 1) return { value: number, unit: units[0] };
    return { why: `no unit — OnBuy takes ${units.join(', ')}` };
  }
  const said = UNIT_WORDS[raw] ?? raw;
  const unit = units.find((u) => u.toLowerCase() === said);
  return unit ? { value: number, unit } : { why: `unit ${m[2]!.trim()} is not one OnBuy takes here (${units.join(', ')})` };
}

export interface ResolvedOnbuyFields {
  features: { option_id: number }[];
  /** `unit` only where OnBuy says the detail has one; a detail with no units takes plain text. */
  technical: { detail_id: number; value: string; unit?: string }[];
  /** Required features with no usable answer, by name. */
  missing: string[];
  /** Answers that exist but cannot be sent, and why. */
  rejected: { name: string; value: string; why: string }[];
}

/** Researched answers → OnBuy's `features` and `technical_detail`. */
export function resolveOnbuyFields(fields: OnbuyField[], records: Record<string, AspectRecord>): ResolvedOnbuyFields {
  const answers = eligibleValues(records);
  const out: ResolvedOnbuyFields = { features: [], technical: [], missing: [], rejected: [] };
  for (const f of fields) {
    const value = answers[f.name];
    if (f.kind === 'feature') {
      const option = value != null ? f.options.find((o) => comparable(o.name) === comparable(value)) : undefined;
      if (option) out.features.push({ option_id: Number(option.id) });
      else if (value != null) out.rejected.push({ name: f.name, value, why: 'not one of OnBuy’s options for it' });
      if (!option && f.required) out.missing.push(f.name);
      continue;
    }
    if (value == null) continue;
    /**
     * A technical detail with NO units is not a measurement - it is free text.
     *
     * Every detail used to go through the measurement reader, which checks the unit against the
     * field's list. With an empty list nothing can ever match, so every answer was rejected whatever
     * it said: Colour "Black" came back as "not a single number with a unit", and Capacity "9.2 L"
     * as "unit L is not one OnBuy takes here ()" - with the allowed units printed as an empty pair
     * of brackets, which was the tell. A list we do not have is not a list that forbids everything.
     */
    if (!f.units.length) {
      out.technical.push({ detail_id: Number(f.detailId), value: value.trim() });
      continue;
    }
    const m = readMeasurement(value, f.units);
    if ('why' in m) out.rejected.push({ name: f.name, value, why: m.why });
    else out.technical.push({ detail_id: Number(f.detailId), value: m.value, unit: m.unit });
  }
  return out;
}

/** Facts other fields already carry, left out of the spec table so OnBuy's page does not repeat them. */
const NOT_IN_TABLE = new Set(['brand', 'mpn', 'ean', 'upc', 'gtin', 'manufacturer part number']);

/**
 * OnBuy's free "product data" table, from the specifics already verified for eBay — facts that passed
 * the evidence checks once, so nothing is researched twice. At most 50 rows.
 */
export function onbuyProductData(verified: Record<string, string>, groups: Record<string, string> = {}): { label: string; value: string; group?: string }[] {
  return Object.entries(verified)
    .filter(([label, value]) => value.trim() && !NOT_IN_TABLE.has(label.trim().toLowerCase()))
    .slice(0, 50)
    .map(([label, value]) => ({ label, value: value.trim(), ...(groups[label] ? { group: groups[label] } : {}) }));
}

/** OnBuy safety (GPSR) text as stored on the plan. */
export interface OnbuySafety {
  warnings: string | null;
  usageInstructions: string | null;
  ingredients: string | null;
}

export const SAFETY_LIMIT = 3000;

export function normaliseSafety(raw: unknown): OnbuySafety {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, SAFETY_LIMIT) : null);
  return { warnings: text(r.warnings), usageInstructions: text(r.usageInstructions), ingredients: text(r.ingredients) };
}

/** OnBuy's `safety_content`, or nothing when every part is empty. */
export function onbuySafetyBody(s: OnbuySafety): Record<string, string> | null {
  const body: Record<string, string> = {};
  if (s.warnings) body.warnings = s.warnings;
  if (s.usageInstructions) body.usage_instructions = s.usageInstructions;
  if (s.ingredients) body.ingredients = s.ingredients;
  return Object.keys(body).length ? body : null;
}

/** OnBuy's title limit; about 70 characters is what it recommends. */
export const ONBUY_TITLE_MAX = 150;
