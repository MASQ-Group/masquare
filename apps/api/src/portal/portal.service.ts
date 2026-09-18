import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CustomerShipmentsService, type ShipmentInput } from '../customer-shipments/customer-shipments.service';
import { LOGISTICS, hasType } from '../customers/customer-types';
import { BATTERY_TYPES, formToInput, problemsWith, type ShipmentForm } from './../customer-shipments/shipment-form';
import { buildTrackingUrl } from '../carriers/tracking-url';

export interface ProductInput {
  name?: string;
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
  weightKg?: number | null;
  declaredValue?: number | null;
  currency?: string | null;
  dangerousGoods?: boolean | null;
  batteryType?: string | null;
  active?: boolean;
}

/** A number as the column takes it, or nothing. */
const dec = (v: number | null | undefined) =>
  v != null && Number.isFinite(Number(v)) ? new Prisma.Decimal(Number(v)) : null;

/**
 * What a logistics customer's own people can see and do.
 *
 * Every method takes the signed-in person's customer id and scopes to it — there is no method here
 * that can be asked about somebody else's shipment, and none that takes a customer id from the
 * caller. That is the whole security model of the portal, and it is deliberately boring.
 *
 * The responses are built field by field rather than returned from the database as they come. It
 * costs a few lines and buys the one guarantee that matters: what WE paid the carrier is not in
 * this file at all, so no future edit can leak it by forgetting to remove it.
 */

@Injectable()
export class PortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shipments: CustomerShipmentsService,
  ) {}

  /** Who they are, and what their lists hold. */
  async home(customerId: string) {
    const customer = await this.customer(customerId);
    const [active, archived] = await Promise.all([
      this.prisma.customerShipment.count({ where: { customerId, deletedAt: null, status: { in: ['SUBMITTED', 'NEEDS_INFO', 'FULFILLED'] } } }),
      this.prisma.customerShipment.count({ where: { customerId, deletedAt: null, status: { in: ['ARCHIVED', 'CANCELLED'] } } }),
    ]);
    const needsInfo = await this.prisma.customerShipment.count({ where: { customerId, deletedAt: null, status: 'NEEDS_INFO' } });
    return {
      customer: { name: customer.name, referencePrefix: customer.referencePrefix },
      counts: { active, archived, needsInfo },
      batteryTypes: BATTERY_TYPES,
      /** What a shipment they file next would be called, so the form can show it. */
      nextReference: null as string | null,
    };
  }

  /** Every country we hold, for the address picker. Reference data, no customer in it. */
  async countries() {
    return this.prisma.country.findMany({
      where: { deletedAt: null },
      select: { id: true, isoCode: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Their shipments.
   *
   * Two lists, as they asked for: what is still going on, and what they have archived. Newest first
   * — unlike our queue, which is worked oldest first, because this is a record rather than a job.
   */
  async list(customerId: string, params: { view?: string; q?: string } = {}) {
    const archived = params.view === 'archived';
    const term = params.q?.trim();
    const rows = await this.prisma.customerShipment.findMany({
      where: {
        customerId,
        deletedAt: null,
        status: archived ? { in: ['ARCHIVED', 'CANCELLED'] } : { in: ['SUBMITTED', 'NEEDS_INFO', 'FULFILLED'] },
        ...(term
          ? {
            OR: [
              { reference: { contains: term, mode: 'insensitive' } },
              { customerReference: { contains: term, mode: 'insensitive' } },
              { trackingNumber: { contains: term, mode: 'insensitive' } },
              { toName: { contains: term, mode: 'insensitive' } },
              { toCompany: { contains: term, mode: 'insensitive' } },
            ],
          }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: INCLUDE,
      take: 200,
    });
    return rows.map((r) => this.view(r));
  }

  async get(customerId: string, id: string) {
    const row = await this.prisma.customerShipment.findFirst({ where: { id, customerId, deletedAt: null }, include: INCLUDE });
    // Not found rather than forbidden: whether a shipment exists is not something to confirm to
    // somebody it does not belong to.
    if (!row) throw new NotFoundException('Shipment not found');
    return this.view(row);
  }

  /** File one. The form's rules are checked here as well as on the screen that drew it. */
  async file(customerId: string, userId: string, form: ShipmentForm) {
    await this.assertCanFile(customerId);
    const problems = problemsWith(form);
    if (problems.length) throw new BadRequestException(problems.join(' '));

    const created = await this.shipments.file(customerId, formToInput(form), userId);
    return this.get(customerId, created.id);
  }

  /** Correct one we have not acted on yet, or answer a question and send it back. */
  async update(customerId: string, id: string, form: ShipmentForm, opts: { resubmit?: boolean } = {}) {
    await this.own(customerId, id);
    const problems = problemsWith(form);
    if (problems.length) throw new BadRequestException(problems.join(' '));

    await this.shipments.customerAction(id, opts.resubmit ? 'resubmit' : 'edit', formToInput(form));
    return this.get(customerId, id);
  }

  async cancel(customerId: string, id: string) {
    await this.own(customerId, id);
    await this.shipments.customerAction(id, 'cancel');
    return this.get(customerId, id);
  }

  async archive(customerId: string, id: string) {
    await this.own(customerId, id);
    await this.shipments.customerAction(id, 'archive');
    return this.get(customerId, id);
  }

  // ── their own catalogue of goods ─────────────────────────────────────────────────────────────

  async products(customerId: string) {
    return this.prisma.customerProduct.findMany({
      where: { customerId, deletedAt: null },
      // Named field by field, like every other response here: whoever adds a column next has to
      // decide it belongs in the portal rather than have it sent because it exists.
      select: {
        id: true, name: true,
        lengthCm: true, widthCm: true, heightCm: true, weightKg: true,
        declaredValue: true, currency: true,
        dangerousGoods: true, batteryType: true, active: true,
      },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
  }

  async saveProduct(customerId: string, id: string | null, input: ProductInput, userId?: string) {
    const name = (input.name ?? '').trim();
    if (!name) throw new BadRequestException('A product needs a name.');

    const data = {
      name,
      lengthCm: dec(input.lengthCm),
      widthCm: dec(input.widthCm),
      heightCm: dec(input.heightCm),
      weightKg: dec(input.weightKg),
      declaredValue: dec(input.declaredValue),
      currency: (input.currency ?? 'EUR').toUpperCase(),
      dangerousGoods: !!input.dangerousGoods,
      // The battery type belongs to the dangerous answer; keeping it after a No would carry a
      // packing instruction onto a product that no longer claims to need one.
      batteryType: input.dangerousGoods ? (input.batteryType ?? null) : null,
      ...(input.active !== undefined ? { active: !!input.active } : {}),
    };

    if (id) {
      // Scoped to the customer, so an id from somewhere else changes nothing.
      const existing = await this.prisma.customerProduct.findFirst({ where: { id, customerId, deletedAt: null }, select: { id: true } });
      if (!existing) throw new NotFoundException('Product not found');
      await this.prisma.customerProduct.update({ where: { id }, data });
    } else {
      await this.prisma.customerProduct.create({ data: { ...data, customerId, createdById: userId ?? null } });
    }
    return this.products(customerId);
  }

  /**
   * Remove a product.
   *
   * Soft, because shipments already filed copied its values rather than pointing at it — but a
   * product somebody has used should not vanish from their history of choices either.
   */
  async removeProduct(customerId: string, id: string) {
    const existing = await this.prisma.customerProduct.findFirst({ where: { id, customerId, deletedAt: null }, select: { id: true } });
    if (!existing) throw new NotFoundException('Product not found');
    await this.prisma.customerProduct.update({ where: { id }, data: { deletedAt: new Date(), active: false } });
    return this.products(customerId);
  }

  // ── internals ────────────────────────────────────────────────────────────────────────────────

  private async customer(customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, deletedAt: null },
      select: { id: true, name: true, referencePrefix: true, active: true, types: true },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  /** Filing needs an active customer who still takes the logistics service. */
  private async assertCanFile(customerId: string) {
    const customer = await this.customer(customerId);
    if (!customer.active || !hasType(customer, LOGISTICS)) {
      throw new ForbiddenException('This account cannot file shipments at the moment. Please contact maSquare.');
    }
  }

  /** Prove the shipment is theirs before anything is done to it. */
  private async own(customerId: string, id: string) {
    const row = await this.prisma.customerShipment.findFirst({ where: { id, customerId, deletedAt: null }, select: { id: true } });
    if (!row) throw new NotFoundException('Shipment not found');
    return row;
  }

  /** The form, as the shipment service takes it. */
  /**
   * One shipment, as the customer may see it.
   *
   * Built field by field. What the carrier charged us is not read here and not returned, so the two
   * money figures cannot be confused by anybody editing this later — only theirs is present.
   */
  private view(s: ShipmentRow) {
    return {
      id: s.id,
      reference: s.reference,
      orderReference: s.customerReference,
      serialNumbers: s.serialNumbers,
      status: s.status,
      /** What we have asked them for, when we have. Cleared when they answer. */
      infoRequest: s.infoRequest,
      createdAt: s.createdAt,
      deliveryInstructions: s.deliveryInstructions,

      recipient: {
        companyName: s.toCompany,
        vatNumber: s.toVatNumber,
        contactName: s.toName,
        phone: s.toPhone,
        email: s.toEmail,
      },
      address: {
        countryIso: s.toCountryIso,
        postalCode: s.toPostalCode,
        city: s.toCity,
        state: s.toRegion,
        line1: s.toLine1,
        line2: s.toLine2,
        line3: s.toLine3,
      },
      packages: s.parcels.map((p) => ({
        id: p.id,
        lengthCm: p.lengthCm,
        widthCm: p.widthCm,
        heightCm: p.heightCm,
        weightKg: p.weightKg,
        goodsDescription: p.goodsDescription,
        customerReference: p.customerReference,
        declaredValue: p.declaredValue,
        insurance: p.insurance,
        insuranceAmount: p.insuranceAmount,
        dangerousGoods: p.dangerousGoods,
        batteryType: p.batteryType,
        priorityHandling: p.priorityHandling,
      })),
      currency: s.goodsCurrency ?? 'EUR',

      /** What we booked, once we have. */
      carrier: s.shippingService?.name ?? null,
      trackingNumber: s.trackingNumber,
      trackingUrl: buildTrackingUrl(s.shippingService?.trackingUrlTemplate, s.trackingNumber),
      shippedAt: s.shippedAt,
      /** Where the parcel is, for the carriers we can ask. */
      tracking: s.tracking
        ? {
          status: s.tracking.statusDescription,
          deliveredAt: s.tracking.deliveredAt,
          estimatedDeliveryAt: s.tracking.estimatedDeliveryAt,
          lastScanAt: s.tracking.lastScanAt,
          lastScanDescription: s.tracking.lastScanDescription,
          lastScanLocation: s.tracking.lastScanLocation,
          exception: s.tracking.exceptionDescription,
        }
        : null,

      /** What THEY pay. What it cost us is deliberately absent from this whole file. */
      charge: s.chargeCents != null ? { amount: s.chargeCents / 100, currency: s.chargeCurrency } : null,
      archivedAt: s.archivedAt,
    };
  }
}

const INCLUDE = {
  parcels: { orderBy: { createdAt: 'asc' } },
  shippingService: { select: { name: true, trackingUrlTemplate: true } },
  tracking: {
    select: {
      statusDescription: true, deliveredAt: true, estimatedDeliveryAt: true,
      lastScanAt: true, lastScanDescription: true, lastScanLocation: true, exceptionDescription: true,
    },
  },
} satisfies Prisma.CustomerShipmentInclude;

type ShipmentRow = Prisma.CustomerShipmentGetPayload<{ include: typeof INCLUDE }>;
