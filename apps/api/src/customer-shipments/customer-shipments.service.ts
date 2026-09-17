import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CarriersService } from '../carriers/carriers.service';
import { MailService } from '../mail/mail.service';
import { formatReference } from '../customers/customer-reference';
import { LOGISTICS, NOT_LOGISTICS, hasType } from '../customers/customer-types';
import {
  missingForFulfilment, planCustomerAction, planStaffAction, type CustomerAction, type ShipmentStatus, type StaffAction,
} from './customer-shipment-state';

/**
 * Shipments filed by the companies we ship for.
 *
 * The rules about who may do what live in customer-shipment-state.ts, tested; this is the part that
 * touches the database, and it asks that module before every change rather than restating any of it.
 *
 * Two things happen here that happen nowhere else. A reference is allocated by incrementing the
 * customer's counter INSIDE the transaction that writes the shipment, because counting existing
 * shipments cannot be made safe against two people filing at the same moment. And filing raises the
 * notification and the email — the first caller either of those has ever had.
 */

export interface AddressInput {
  name?: string | null; company?: string | null; vatNumber?: string | null;
  line1?: string | null; line2?: string | null; line3?: string | null;
  city?: string | null; region?: string | null; postalCode?: string | null; countryIso?: string | null;
  phone?: string | null; email?: string | null;
}

export interface ParcelInput {
  weightKg: number;
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
  goodsDescription?: string | null;
  customerReference?: string | null;
  declaredValue?: number | null;
  insurance?: boolean | null;
  /** Worked out by the caller from the declared value — never taken from a browser. */
  insuranceAmount?: number | null;
  dangerousGoods?: boolean | null;
  batteryType?: string | null;
  priorityHandling?: boolean | null;
}

export interface ShipmentInput {
  customerReference?: string | null;
  serialNumbers?: string[] | null;
  deliveryInstructions?: string | null;
  requestedDate?: string | null;
  goodsDescription?: string | null;
  goodsValue?: number | null;
  goodsCurrency?: string | null;
  notes?: string | null;
  from?: AddressInput;
  to?: AddressInput;
  parcels?: ParcelInput[];
}

export interface FulfilInput {
  shippingServiceId?: string | null;
  trackingNumber?: string | null;
  shippedAt?: string | null;
  costCents?: number | null;
  chargeCents?: number | null;
  chargeCurrency?: string | null;
  notes?: string | null;
}

const INCLUDE = {
  customer: { select: { id: true, name: true, referencePrefix: true } },
  shippingService: { select: { id: true, name: true, trackingUrlTemplate: true } },
  parcels: { orderBy: { createdAt: 'asc' } },
  documents: { orderBy: { uploadedAt: 'asc' } },
  /**
   * What the carrier last said, for the carriers we can ask. The same rows, sweep and cadence as
   * our own shipments — a customer watching their parcel sees what we see.
   */
  tracking: {
    select: {
      statusCode: true, statusDescription: true, deliveredAt: true, estimatedDeliveryAt: true,
      lastScanAt: true, lastScanDescription: true, lastScanLocation: true,
      exceptionCode: true, exceptionDescription: true, checkedAt: true, found: true,
    },
  },
} satisfies Prisma.CustomerShipmentInclude;

@Injectable()
export class CustomerShipmentsService {
  private readonly logger = new Logger(CustomerShipmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
    private readonly carriers: CarriersService,
  ) {}

  // ── filing ───────────────────────────────────────────────────────────────────────────────────

  /**
   * File a shipment. Used by the portal, and by us on a customer's behalf when they telephone.
   *
   * `actorId` is whoever filed it — a customer's person or one of ours — and is also who does NOT
   * get told about it.
   */
  async file(customerId: string, input: ShipmentInput, actorId?: string) {
    const parcels = (input.parcels ?? []).filter((p) => Number(p.weightKg) > 0);
    if (parcels.length === 0) throw new BadRequestException('A shipment needs at least one parcel with a weight.');

    const created = await this.prisma.$transaction(async (tx) => {
      /**
       * The reference, allocated by incrementing the customer's own counter.
       *
       * `increment` returns the new value from the database itself, so two people filing at the same
       * instant get two different numbers — which counting rows could never guarantee.
       */
      const customer = await tx.customer.update({
        where: { id: customerId },
        data: { referenceSeq: { increment: 1 } },
        select: { id: true, name: true, referencePrefix: true, referenceSeq: true, active: true, deletedAt: true, types: true },
      });
      // Refusing throws, which rolls the increment back with everything else in the transaction.
      if (customer.deletedAt || !customer.active) throw new ConflictException('That customer is not active.');
      if (!hasType(customer, LOGISTICS) || !customer.referencePrefix) throw new ConflictException(NOT_LOGISTICS);

      return tx.customerShipment.create({
        data: {
          customerId,
          reference: formatReference(customer.referencePrefix, customer.referenceSeq),
          customerReference: text(input.customerReference),
          serialNumbers: (input.serialNumbers ?? []).map((v) => v.trim()).filter(Boolean),
          deliveryInstructions: text(input.deliveryInstructions),
          status: 'SUBMITTED',
          requestedDate: date(input.requestedDate),
          goodsDescription: text(input.goodsDescription),
          goodsValue: input.goodsValue != null ? new Prisma.Decimal(input.goodsValue) : null,
          goodsCurrency: text(input.goodsCurrency)?.toUpperCase() ?? null,
          notes: text(input.notes),
          ...addressFields('from', input.from),
          ...addressFields('to', input.to),
          createdById: actorId ?? null,
          parcels: {
            create: parcels.map((p) => parcelData(p)),
          },
        },
        include: INCLUDE,
      });
    });

    await this.announce(created.reference, created.customer.name, parcels.length, created.id, actorId);
    return created;
  }

  // ── reading ──────────────────────────────────────────────────────────────────────────────────

  /** The queues our team works from: what is waiting, and what has gone. */
  async list(params: { queue?: string; q?: string; customerId?: string; take?: number; skip?: number } = {}) {
    const take = Math.max(1, Math.min(200, Number(params.take) || 50));
    const skip = Math.max(0, Number(params.skip) || 0);
    const term = params.q?.trim();

    const statuses = params.queue === 'fulfilled'
      ? ['FULFILLED', 'ARCHIVED']
      : params.queue === 'closed'
        ? ['CANCELLED']
        : ['SUBMITTED', 'NEEDS_INFO'];

    const where: Prisma.CustomerShipmentWhereInput = {
      deletedAt: null,
      status: { in: statuses },
      ...(params.customerId ? { customerId: params.customerId } : {}),
      ...(term
        ? {
          OR: [
            { reference: { contains: term, mode: 'insensitive' } },
            { customerReference: { contains: term, mode: 'insensitive' } },
            { trackingNumber: { contains: term, mode: 'insensitive' } },
            { toName: { contains: term, mode: 'insensitive' } },
            { toCompany: { contains: term, mode: 'insensitive' } },
            { customer: { name: { contains: term, mode: 'insensitive' } } },
          ],
        }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.customerShipment.findMany({
        where,
        include: INCLUDE,
        // Waiting work oldest first — a queue is worked from the front. Everything else newest first.
        orderBy: params.queue === 'fulfilled' || params.queue === 'closed' ? { fulfilledAt: 'desc' } : { createdAt: 'asc' },
        take,
        skip,
      }),
      this.prisma.customerShipment.count({ where }),
    ]);
    return { items, total };
  }

  /** How many are waiting, for the tab badge. */
  async pendingCount(): Promise<number> {
    return this.prisma.customerShipment.count({ where: { deletedAt: null, status: { in: ['SUBMITTED', 'NEEDS_INFO'] } } });
  }

  async get(id: string) {
    const row = await this.prisma.customerShipment.findFirst({ where: { id, deletedAt: null }, include: INCLUDE });
    if (!row) throw new NotFoundException('Shipment not found');
    return row;
  }

  // ── our side ─────────────────────────────────────────────────────────────────────────────────

  /**
   * Record what we booked: the carrier, the tracking number, what it cost us and what they pay.
   *
   * Everything here is typed by a person from a carrier's own website today. When FedEx and Cyprus
   * Post can be booked from the platform, that fills these same fields instead — which is why the
   * shape is "what was booked" rather than "what to book".
   */
  async fulfil(id: string, input: FulfilInput, actorId?: string) {
    const shipment = await this.get(id);
    const plan = planStaffAction(shipment.status as ShipmentStatus, 'fulfil');
    if (!plan.ok) throw new ConflictException(plan.reason);

    const gaps = missingForFulfilment({ shippingServiceId: input.shippingServiceId, trackingNumber: input.trackingNumber });
    if (gaps.length) throw new BadRequestException(`Still needed: ${gaps.join(' and ')}.`);

    await this.prisma.customerShipment.update({
      where: { id },
      data: {
        status: 'FULFILLED',
        shippingServiceId: input.shippingServiceId,
        trackingNumber: (input.trackingNumber ?? '').trim(),
        shippedAt: date(input.shippedAt) ?? new Date(),
        fulfilledAt: new Date(),
        fulfilledById: actorId ?? null,
        costCents: input.costCents ?? null,
        chargeCents: input.chargeCents ?? null,
        chargeCurrency: (input.chargeCurrency ?? 'EUR').toUpperCase(),
        ...(input.notes !== undefined ? { notes: text(input.notes) } : {}),
        infoRequest: null,
      },
    });
    return this.get(id);
  }

  /** Correct a shipment we have already recorded — a mistyped tracking number, a changed charge. */
  async amend(id: string, input: FulfilInput, actorId?: string) {
    const shipment = await this.get(id);
    const plan = planStaffAction(shipment.status as ShipmentStatus, 'edit');
    if (!plan.ok) throw new ConflictException(plan.reason);

    await this.prisma.customerShipment.update({
      where: { id },
      data: {
        ...(input.shippingServiceId !== undefined ? { shippingServiceId: input.shippingServiceId || null } : {}),
        ...(input.trackingNumber !== undefined ? { trackingNumber: text(input.trackingNumber) } : {}),
        ...(input.shippedAt !== undefined ? { shippedAt: date(input.shippedAt) } : {}),
        ...(input.costCents !== undefined ? { costCents: input.costCents } : {}),
        ...(input.chargeCents !== undefined ? { chargeCents: input.chargeCents } : {}),
        ...(input.chargeCurrency !== undefined ? { chargeCurrency: (input.chargeCurrency ?? 'EUR').toUpperCase() } : {}),
        ...(input.notes !== undefined ? { notes: text(input.notes) } : {}),
      },
    });
    void actorId;
    return this.get(id);
  }

  /** Hand it back with a question. It returns to their list, theirs to answer. */
  async requestInfo(id: string, question: string) {
    const shipment = await this.get(id);
    const plan = planStaffAction(shipment.status as ShipmentStatus, 'request_info');
    if (!plan.ok) throw new ConflictException(plan.reason);
    const text_ = question.trim();
    if (!text_) throw new BadRequestException('Say what is needed, or they cannot answer it.');

    await this.prisma.customerShipment.update({ where: { id }, data: { status: 'NEEDS_INFO', infoRequest: text_ } });
    return this.get(id);
  }

  /**
   * Ask the carrier about this one now, rather than waiting for the sweep.
   *
   * Only FedEx can be asked at all; for anyone else the answer is honestly nothing, and the screen
   * keeps showing the tracking link out to the carrier instead.
   */
  async refreshTracking(id: string) {
    const shipment = await this.get(id);
    if (!shipment.trackingNumber) throw new BadRequestException('This shipment has no tracking number yet.');
    const result = await this.carriers.refreshTracking({ customerShipmentIds: [id], force: true });
    return { ...result, shipment: await this.get(id) };
  }

  /** Undo a fulfilment that was not one. */
  async reopen(id: string) {
    const shipment = await this.get(id);
    const plan = planStaffAction(shipment.status as ShipmentStatus, 'reopen');
    if (!plan.ok) throw new ConflictException(plan.reason);
    await this.prisma.customerShipment.update({
      where: { id },
      data: { status: 'SUBMITTED', fulfilledAt: null, fulfilledById: null, archivedAt: null },
    });
    return this.get(id);
  }

  async cancel(id: string) {
    const shipment = await this.get(id);
    const plan = planStaffAction(shipment.status as ShipmentStatus, 'cancel');
    if (!plan.ok) throw new ConflictException(plan.reason);
    await this.prisma.customerShipment.update({ where: { id }, data: { status: 'CANCELLED' } });
    return this.get(id);
  }

  // ── their side, used by the portal ───────────────────────────────────────────────────────────

  /** A customer's own action on their own shipment. The caller has already proved it is theirs. */
  async customerAction(id: string, action: CustomerAction, patch?: ShipmentInput) {
    const shipment = await this.get(id);
    const plan = planCustomerAction(shipment.status as ShipmentStatus, action);
    if (!plan.ok) throw new ConflictException(plan.reason);

    if (action === 'edit' || action === 'resubmit') {
      const parcels = (patch?.parcels ?? []).filter((p) => Number(p.weightKg) > 0);
      await this.prisma.$transaction(async (tx) => {
        await tx.customerShipment.update({
          where: { id },
          data: {
            ...(patch?.customerReference !== undefined ? { customerReference: text(patch.customerReference) } : {}),
            ...(patch?.serialNumbers !== undefined ? { serialNumbers: (patch.serialNumbers ?? []).map((v) => v.trim()).filter(Boolean) } : {}),
            ...(patch?.deliveryInstructions !== undefined ? { deliveryInstructions: text(patch.deliveryInstructions) } : {}),
            ...(patch?.requestedDate !== undefined ? { requestedDate: date(patch.requestedDate) } : {}),
            ...(patch?.goodsDescription !== undefined ? { goodsDescription: text(patch.goodsDescription) } : {}),
            ...(patch?.goodsValue !== undefined ? { goodsValue: patch.goodsValue != null ? new Prisma.Decimal(patch.goodsValue) : null } : {}),
            ...(patch?.goodsCurrency !== undefined ? { goodsCurrency: text(patch.goodsCurrency)?.toUpperCase() ?? null } : {}),
            ...(patch?.notes !== undefined ? { notes: text(patch.notes) } : {}),
            ...(patch?.from ? addressFields('from', patch.from) : {}),
            ...(patch?.to ? addressFields('to', patch.to) : {}),
            // Answering the question is what clears it, so a shipment cannot sit in their list
            // showing a request they have already dealt with.
            ...(action === 'resubmit' ? { status: 'SUBMITTED' as const, infoRequest: null } : {}),
          },
        });
        if (parcels.length) {
          await tx.customerShipmentParcel.deleteMany({ where: { shipmentId: id } });
          await tx.customerShipmentParcel.createMany({
            data: parcels.map((p) => ({ shipmentId: id, ...parcelData(p) })),
          });
        }
      });
      if (action === 'resubmit') {
        const s = await this.get(id);
        await this.announce(s.reference, s.customer.name, s.parcels.length, s.id, undefined, 'answered our question on');
      }
      return this.get(id);
    }

    const data: Prisma.CustomerShipmentUpdateInput =
      action === 'cancel' ? { status: 'CANCELLED' } : { status: 'ARCHIVED', archivedAt: new Date() };
    await this.prisma.customerShipment.update({ where: { id }, data });
    return this.get(id);
  }

  // ── telling somebody ─────────────────────────────────────────────────────────────────────────

  /**
   * The bell and the email. Neither may break the filing that caused it — a customer's shipment is
   * not lost because our mail server was.
   */
  private async announce(reference: string, customerName: string, parcels: number, shipmentId: string, actorId?: string, verb = 'filed') {
    const title = `${customerName} ${verb} shipment ${reference}`;
    const body = `${parcels} parcel${parcels === 1 ? '' : 's'}. It is waiting in Shipments → Customer shipments.`;

    await this.notifications.notify(
      // Whoever can actually act on it: a notification to somebody who cannot open the tab is noise.
      { area: 'shipments', level: 'edit', actorId },
      { kind: 'customer_shipment_filed', title, body, link: '/shipments?tab=customer-pending', relatedType: 'customer_shipment', relatedId: shipmentId, dedupeKey: `customer_shipment:${shipmentId}` },
    );

    const settings = await this.prisma.platformSettings.findFirst({ select: { logisticsAlertUserId: true } });
    if (!settings?.logisticsAlertUserId) return;
    const recipient = await this.prisma.user.findFirst({
      // Staff only, checked here rather than trusted from the setting. A customer's person named in
      // this field by mistake would otherwise be emailed every OTHER customer's shipments.
      where: { id: settings.logisticsAlertUserId, deletedAt: null, status: 'active', customerId: null },
      select: { email: true, fullName: true },
    });
    if (!recipient) return;

    await this.mail.send({
      to: recipient.email,
      subject: title,
      text: [`${title}.`, '', body, '', 'It is in the platform under Shipments → Customer shipments.'].join('\n'),
      kind: 'notification',
      relatedType: 'customer_shipment',
      relatedId: shipmentId,
    });
  }
}

/**
 * One package, as its columns.
 *
 * Written once and used by both the filing and the customer's own edit, because a field added to
 * one and forgotten in the other is a field that silently empties itself when somebody corrects a
 * shipment.
 */
function parcelData(p: ParcelInput) {
  const dec = (v: number | null | undefined) => (v != null && Number.isFinite(Number(v)) ? new Prisma.Decimal(v) : null);
  return {
    weightKg: new Prisma.Decimal(p.weightKg),
    lengthCm: dec(p.lengthCm),
    widthCm: dec(p.widthCm),
    heightCm: dec(p.heightCm),
    goodsDescription: text(p.goodsDescription),
    customerReference: text(p.customerReference),
    declaredValue: dec(p.declaredValue),
    insurance: !!p.insurance,
    insuranceAmount: dec(p.insuranceAmount),
    dangerousGoods: !!p.dangerousGoods,
    batteryType: p.dangerousGoods ? text(p.batteryType) : null,
    priorityHandling: !!p.priorityHandling,
  };
}

const text = (v: string | null | undefined): string | null => {
  const s = (v ?? '').trim();
  return s === '' ? null : s;
};

const date = (v: string | null | undefined): Date | null => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** One address, flattened onto the columns that hold it. */
function addressFields(side: 'from' | 'to', a?: AddressInput) {
  if (!a) return {};
  const key = (suffix: string) => `${side}${suffix}` as const;
  return {
    [key('Name')]: text(a.name),
    [key('Company')]: text(a.company),
    ...(side === 'to' ? { toVatNumber: text(a.vatNumber) } : {}),
    [key('Line1')]: text(a.line1),
    [key('Line2')]: text(a.line2),
    ...(side === 'to' ? { toLine3: text(a.line3) } : {}),
    [key('City')]: text(a.city),
    [key('Region')]: text(a.region),
    [key('PostalCode')]: text(a.postalCode),
    [key('CountryIso')]: text(a.countryIso)?.toUpperCase() ?? null,
    [key('Phone')]: text(a.phone),
    [key('Email')]: text(a.email),
  };
}
