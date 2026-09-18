import type { ShipParcel, ShipParty } from '../carriers/fedex-ship';
import type { CustomsItemInput } from '../carriers/carriers.service';
import { fedexPhone } from '../carriers/fedex-phone';

/**
 * A customer's shipment, as the pieces of a FedEx booking.
 *
 * The rules of the arrangement, in one place:
 *
 *  - WE are the shipper. The account FedEx bills and the sender on the label are ours, whoever the
 *    goods belong to. That part is not built here — it is the carrier account's own address.
 *  - The goods leave from our warehouse, or from a collection address given on the shipment. A
 *    collection address travels as FedEx's `origin`, beside us rather than instead of us.
 *  - The commercial invoice is issued in the CUSTOMER's name: the goods are theirs, and so is the sale.
 *  - Each box is one customs line: its goods, how many, what they are worth, what the box weighs,
 *    where they were made and their HS code. The line weighs what the box weighs, so FedEx's rule
 *    that the items weigh what the shipment weighs holds without anybody adding anything up.
 *
 * PURE. Takes plain rows, returns plain objects; the service does the reading and the writing.
 */

/** The columns of a customer shipment this needs. */
export interface ShipmentForBooking {
  reference: string;
  goodsDescription: string | null;
  goodsCurrency: string | null;
  toName: string | null; toCompany: string | null; toVatNumber: string | null;
  toLine1: string | null; toLine2: string | null; toLine3: string | null;
  toCity: string | null; toRegion: string | null; toPostalCode: string | null; toCountryIso: string | null;
  toPhone: string | null; toEmail: string | null;
  fromName: string | null; fromCompany: string | null;
  fromLine1: string | null; fromLine2: string | null;
  fromCity: string | null; fromRegion: string | null; fromPostalCode: string | null; fromCountryIso: string | null;
  fromPhone: string | null; fromEmail: string | null;
  parcels: ParcelForBooking[];
}

export interface ParcelForBooking {
  id: string;
  weightKg: number | string | { toString(): string };
  lengthCm: number | string | { toString(): string } | null;
  widthCm: number | string | { toString(): string } | null;
  heightCm: number | string | { toString(): string } | null;
  goodsDescription: string | null;
  declaredValue: number | string | { toString(): string } | null;
  quantity: number;
  hsCode: string | null;
  countryOfOrigin: string | null;
  dangerousGoods: boolean;
  batteryType: string | null;
}

/** What our team may correct on a box at booking time: its customs line, nothing about the box itself. */
export interface ParcelCustomsEdit {
  id: string;
  goodsDescription?: string | null;
  quantity?: number | null;
  declaredValue?: number | null;
  hsCode?: string | null;
  countryOfOrigin?: string | null;
}

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(String(v));
  return Number.isFinite(n) ? n : null;
};
const text = (v: string | null | undefined): string | null => {
  const s = (v ?? '').trim();
  return s === '' ? null : s;
};

/**
 * The box's lithium batteries, as FedEx declares them — or why the platform will not.
 *
 * Batteries packed with or inside equipment are the ordinary consumer case (IATA Section II) and
 * travel as a declared parcel. Batteries on their own, and "other" dangerous goods, need the full
 * dangerous-goods paperwork, which is booked with FedEx directly by somebody trained to sign it.
 */
export function batteriesFor(batteryType: string | null | undefined):
  | { ok: true; batteries: NonNullable<ShipParcel['batteries']> }
  | { ok: false; reason: string } {
  switch (batteryType) {
    case 'li_ion_in_equipment': return { ok: true, batteries: { packing: 'CONTAINED_IN_EQUIPMENT', material: 'LITHIUM_ION' } };
    case 'li_ion_with_equipment': return { ok: true, batteries: { packing: 'PACKED_WITH_EQUIPMENT', material: 'LITHIUM_ION' } };
    case 'li_metal_in_equipment': return { ok: true, batteries: { packing: 'CONTAINED_IN_EQUIPMENT', material: 'LITHIUM_METAL' } };
    case 'li_metal_with_equipment': return { ok: true, batteries: { packing: 'PACKED_WITH_EQUIPMENT', material: 'LITHIUM_METAL' } };
    case 'li_ion_alone':
    case 'li_metal_alone':
      return { ok: false, reason: 'batteries shipped on their own are fully regulated dangerous goods' };
    default:
      return { ok: false, reason: 'the dangerous goods are not a battery type the platform can declare' };
  }
}

/** Each box with our team's corrections laid over it. Corrections for boxes not on the shipment are ignored. */
export function withEdits(parcels: readonly ParcelForBooking[], edits: readonly ParcelCustomsEdit[] | null | undefined): ParcelForBooking[] {
  const byId = new Map((edits ?? []).map((e) => [e.id, e]));
  return parcels.map((p) => {
    const e = byId.get(p.id);
    if (!e) return p;
    return {
      ...p,
      ...(e.goodsDescription !== undefined ? { goodsDescription: text(e.goodsDescription) } : {}),
      ...(e.quantity !== undefined && e.quantity != null && Number.isInteger(Number(e.quantity)) && Number(e.quantity) >= 1 ? { quantity: Number(e.quantity) } : {}),
      ...(e.declaredValue !== undefined ? { declaredValue: num(e.declaredValue) } : {}),
      ...(e.hsCode !== undefined ? { hsCode: text(e.hsCode) } : {}),
      ...(e.countryOfOrigin !== undefined ? { countryOfOrigin: text(e.countryOfOrigin)?.toUpperCase() ?? null } : {}),
    };
  });
}

/** Whoever receives it. */
export function recipientParty(s: ShipmentForBooking): ShipParty {
  return {
    contact: {
      personName: text(s.toName) ?? text(s.toCompany),
      companyName: text(s.toCompany),
      phoneNumber: fedexPhone(s.toPhone, s.toCountryIso),
      emailAddress: text(s.toEmail),
    },
    address: {
      streetLines: [s.toLine1, s.toLine2, s.toLine3].map(text).filter((x): x is string => !!x),
      city: text(s.toCity),
      stateOrProvinceCode: text(s.toRegion),
      postalCode: text(s.toPostalCode),
      countryCode: text(s.toCountryIso)?.toUpperCase() ?? null,
    },
    /**
     * Their VAT number, where they gave one — a business delivery clears customs faster with it.
     * Sent under the same TIN type as an EORI elsewhere, with the same caveat: see EORI_TIN_TYPE.
     */
    ...(text(s.toVatNumber) ? { tins: [{ tinType: 'BUSINESS_NATIONAL', number: text(s.toVatNumber)! }] } : {}),
  };
}

/** The collection address, or null when the goods are at our warehouse. */
export function collectionParty(s: ShipmentForBooking): ShipParty | null {
  if (!text(s.fromLine1) && !text(s.fromCity) && !text(s.fromPostalCode)) return null;
  return {
    contact: {
      personName: text(s.fromName) ?? text(s.fromCompany),
      companyName: text(s.fromCompany),
      phoneNumber: fedexPhone(s.fromPhone, s.fromCountryIso),
      emailAddress: text(s.fromEmail),
    },
    address: {
      streetLines: [s.fromLine1, s.fromLine2].map(text).filter((x): x is string => !!x),
      city: text(s.fromCity),
      stateOrProvinceCode: text(s.fromRegion),
      postalCode: text(s.fromPostalCode),
      countryCode: text(s.fromCountryIso)?.toUpperCase() ?? null,
    },
  };
}

/** The boxes, as FedEx weighs and measures them, with any batteries declared. */
export function shipParcels(parcels: readonly ParcelForBooking[]): ShipParcel[] {
  return parcels.map((p) => {
    const batteries = p.dangerousGoods ? batteriesFor(p.batteryType) : null;
    return {
      weightKg: num(p.weightKg) ?? 0,
      lengthCm: num(p.lengthCm),
      widthCm: num(p.widthCm),
      heightCm: num(p.heightCm),
      ...(batteries?.ok ? { batteries: batteries.batteries } : {}),
    };
  });
}

/** One customs line per box. Its weight is the box's, by construction — see the header. */
export function customsItems(s: ShipmentForBooking, parcels: readonly ParcelForBooking[]): CustomsItemInput[] {
  const currency = (text(s.goodsCurrency) ?? 'EUR').toUpperCase();
  return parcels.map((p) => ({
    description: text(p.goodsDescription) ?? text(s.goodsDescription) ?? '',
    quantity: p.quantity >= 1 ? p.quantity : 1,
    value: num(p.declaredValue) ?? 0,
    currency,
    weightKg: num(p.weightKg) ?? 0,
    countryOfOrigin: text(p.countryOfOrigin)?.toUpperCase() ?? null,
    hsCode: text(p.hsCode),
  }));
}

/**
 * Why the platform cannot book these boxes, or nothing.
 *
 * Dangerous goods beyond Section II lithium batteries, and Section II batteries nobody has confirmed
 * are within the small-battery limits. The confirmation is a person's, not the platform's: whether a
 * battery is Section II depends on its watt-hours, which no form here asks for.
 */
export function dangerousGoodsRefusal(parcels: readonly ParcelForBooking[], confirmedSectionII: boolean): string | null {
  const numbered = (i: number) => (parcels.length === 1 ? 'The package' : `Package ${i + 1}`);
  for (const [i, p] of parcels.entries()) {
    if (!p.dangerousGoods) continue;
    const b = batteriesFor(p.batteryType);
    if (!b.ok) return `${numbered(i)} cannot be booked from the platform: ${b.reason}. Book it with FedEx directly and record it with "Mark as sent".`;
  }
  if (parcels.some((p) => p.dangerousGoods) && !confirmedSectionII) {
    return 'Confirm the lithium batteries are within IATA Section II (small consumer batteries) before booking — FedEx is told they are.';
  }
  return null;
}

/** Whose name the commercial invoice carries: the customer's registered name where we hold one. */
export const invoiceIssuer = (customer: { name: string; legalName?: string | null }): string =>
  text(customer.legalName) ?? customer.name;
