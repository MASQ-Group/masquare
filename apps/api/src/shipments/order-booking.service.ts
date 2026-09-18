import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CarriersService, type CustomsItemInput } from '../carriers/carriers.service';
import { CYPRUS_SERVICE_TYPES, SERVICE_LABELS, customsLane } from '../carriers/fedex-rate';
import type { InvoiceSource } from '../carriers/fedex-customs';
import type { ShipParcel } from '../carriers/fedex-ship';
import { batteriesFor } from '../customer-shipments/booking-plan';
import { orderCustomsItems, suggestedParcelKg } from './order-booking';

/** One box as the booking screen sends it. */
export interface OrderParcelInput {
  weightKg: number;
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
  /** A battery packing instruction key, as on the logistics form, or nothing. */
  batteryType?: string | null;
}

export interface OrderBookInput {
  accountId?: string;
  serviceType?: string;
  shipDate?: string;
  dutiesPaidBy?: 'sender' | 'recipient';
  labelImageType?: 'PDF' | 'ZPLII';
  invoice?: InvoiceSource | null;
  parcels?: OrderParcelInput[];
  items?: CustomsItemInput[];
  /** A person's confirmation that declared lithium batteries are Section II. */
  batteriesSectionII?: boolean;
  /** Our carrier for the shipment row — what gives the order its tracking link and the sweep. */
  shippingServiceId?: string | null;
  /** The quoted cost of the service booked, in EUR. A quote until accounting reviews it. */
  costEur?: number | null;
  /** Close the order off as fully shipped. Unticked when more of it will follow. */
  markShipped?: boolean;
  /** Confirmed by a person: this order already has a live label, and a second is wanted. */
  another?: boolean;
}

/** The documents kept for a booking, for printing. Never the bytes, and never what it cost. */
const BOOKING_SELECT = {
  id: true, environment: true, status: true, serviceType: true, serviceName: true,
  masterTrackingNumber: true, labelFormat: true, createdAt: true, cancelledAt: true,
  documents: {
    select: { id: true, kind: true, docType: true, pieceIndex: true, sizeBytes: true },
    orderBy: [{ kind: 'desc' as const }, { pieceIndex: 'asc' as const }],
  },
};

/**
 * Booking one of our own orders with FedEx, and recording the shipment it becomes.
 *
 * The carriers service sends the request and keeps the booking, its reply and its documents. What is
 * decided here is what is about the ORDER: which lines it declares, whether it is already booked,
 * and — once FedEx has returned a tracking number on production — the shipment row that marks it
 * sent, which is what the fulfilment worklist, the tracking sweep and the profit figures all read.
 */
@Injectable()
export class OrderBookingService {
  constructor(private readonly prisma: PrismaService, private readonly carriers: CarriersService) {}

  private async order(transactionId: string, companyIds?: string[]) {
    const tx = await this.prisma.salesTransaction.findFirst({
      where: { id: transactionId, deletedAt: null, ...(companyIds ? { companyId: { in: companyIds } } : {}) },
      select: {
        id: true, transactionRef: true, companyId: true, currency: true, resolution: true,
        destinationCountry: { select: { isoCode: true } },
        deliveryAddress: { select: { countryIso: true, purgedAt: true } },
        items: {
          where: { deletedAt: null },
          select: {
            sku: true, quantity: true, netSalesAmount: true,
            product: {
              select: {
                title: true, hsCode: true, countryOfOrigin: true, packageWeightKg: true, productWeightKg: true,
                batteryTypeRef: { select: { label: true } },
              },
            },
          },
        },
      },
    });
    if (!tx) throw new NotFoundException('Sales transaction not found');
    return tx;
  }

  private async isoByName(): Promise<Map<string, string>> {
    const rows = await this.prisma.country.findMany({ where: { deletedAt: null }, select: { name: true, isoCode: true } });
    return new Map(rows.filter((r) => r.name && r.isoCode).map((r) => [r.name.toLowerCase(), r.isoCode.toUpperCase()]));
  }

  private async euCountries(): Promise<Set<string>> {
    const rows = await this.prisma.country.findMany({ where: { euVatZone: true, deletedAt: null }, select: { isoCode: true } });
    return new Set(rows.map((r) => (r.isoCode ?? '').toUpperCase()).filter(Boolean));
  }

  /** What the booking screen starts from. */
  async options(transactionId: string, companyIds?: string[]) {
    const tx = await this.order(transactionId, companyIds);
    const [accounts, eu, names, bookings] = await Promise.all([
      this.carriers.accountsForBooking(tx.companyId ?? null),
      this.euCountries(),
      this.isoByName(),
      this.bookings(transactionId),
    ]);
    const destination = tx.deliveryAddress?.countryIso ?? tx.destinationCountry?.isoCode ?? null;
    const items = orderCustomsItems(tx.items, tx.currency, names);
    return {
      transactionRef: tx.transactionRef,
      accounts: accounts.map((a) => ({ ...a, customs: customsLane(a.originCountry, destination, eu) })),
      services: CYPRUS_SERVICE_TYPES.map((value) => ({ value, label: SERVICE_LABELS[value] ?? value })),
      items,
      suggestedParcelKg: suggestedParcelKg(items),
      /**
       * The products on it the catalogue says carry batteries, so the screen can ask for the
       * declaration rather than letting a battery parcel go as ordinary freight.
       */
      batteryProducts: tx.items
        .filter((l) => l.product?.batteryTypeRef)
        .map((l) => ({ sku: l.sku, battery: l.product!.batteryTypeRef!.label })),
      bookings,
    };
  }

  /** Every FedEx booking on this order, newest first, with its documents for printing. */
  async bookings(transactionId: string) {
    return this.prisma.carrierBooking.findMany({
      where: { transactionId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: BOOKING_SELECT,
    });
  }

  /** What FedEx would charge us for these boxes, per service. Nothing is booked. */
  async quote(transactionId: string, input: { accountId?: string; parcels?: OrderParcelInput[] }, companyIds?: string[]) {
    const tx = await this.prisma.salesTransaction.findFirst({
      where: { id: transactionId, deletedAt: null, ...(companyIds ? { companyId: { in: companyIds } } : {}) },
      select: {
        currency: true,
        destinationCountry: { select: { isoCode: true } },
        deliveryAddress: { select: { postalCode: true, countryIso: true, isBusiness: true, purgedAt: true } },
        items: { where: { deletedAt: null }, select: { netSalesAmount: true, product: { select: { title: true } } } },
      },
    });
    if (!tx) throw new NotFoundException('Sales transaction not found');
    if (!input.accountId) throw new BadRequestException('Choose the FedEx account to quote on.');
    const parcels = (input.parcels ?? []).filter((p) => Number(p.weightKg) > 0);
    if (!parcels.length) throw new BadRequestException('Give every parcel a weight to quote.');
    const addr = tx.deliveryAddress && !tx.deliveryAddress.purgedAt ? tx.deliveryAddress : null;
    const value = tx.items.reduce((t, i) => t + Number(i.netSalesAmount ?? 0), 0);
    const r = await this.carriers.rateQuote(input.accountId, {
      recipient: {
        postalCode: addr?.postalCode ?? null,
        countryIso: addr?.countryIso ?? tx.destinationCountry?.isoCode ?? null,
        residential: addr?.isBusiness == null ? null : !addr.isBusiness,
      },
      parcels: parcels.map((p) => ({ weightKg: Number(p.weightKg), lengthCm: p.lengthCm ?? null, widthCm: p.widthCm ?? null, heightCm: p.heightCm ?? null })),
      customsValue: value > 0 ? { amount: Math.round(value * 100) / 100, currency: (tx.currency ?? 'EUR').toUpperCase() } : null,
      goodsDescription: tx.items[0]?.product?.title ?? null,
    }, companyIds);
    return { ok: r.ok, message: r.message, quote: r.quote, customs: r.customs };
  }

  /**
   * Book it. In order, each step before the next because each is what makes the next safe:
   *
   *  1. The order is ours to book, not cancelled, and the account belongs to its company.
   *  2. A live production label already on the order is a second charge for the same goods unless a
   *     person says otherwise — orders do ship in several consignments, so it is asked, not refused.
   *  3. Batteries are declared only as Section II, and only once a person confirms they are.
   *  4. FedEx is asked; the carriers service records the booking whatever else happens.
   *  5. On production, with a tracking number back, the shipment row is written and the booking
   *     pointed at it. On sandbox nothing is recorded against the order but the test booking.
   */
  async book(transactionId: string, input: OrderBookInput, actorId?: string, companyIds?: string[]) {
    const tx = await this.order(transactionId, companyIds);
    if (tx.resolution === 'cancelled') throw new ConflictException('This order is cancelled.');

    if (!input.accountId) throw new BadRequestException('Choose the FedEx account to book on.');
    if (!input.serviceType) throw new BadRequestException('Choose the FedEx service.');
    if (!input.shipDate || !/^\d{4}-\d{2}-\d{2}$/.test(input.shipDate)) throw new BadRequestException('Choose the date it is handed to FedEx.');
    if (input.dutiesPaidBy !== 'sender' && input.dutiesPaidBy !== 'recipient') {
      throw new BadRequestException('Say who pays duties and taxes at the border.');
    }

    const account = await this.prisma.carrierAccount.findFirst({
      where: { id: input.accountId, deletedAt: null },
      select: { id: true, environment: true, companyId: true },
    });
    if (!account) throw new NotFoundException('Carrier account not found');
    // The order's company pays for its carriage, so its own account is the one billed.
    if (tx.companyId && account.companyId !== tx.companyId) {
      throw new BadRequestException('That FedEx account belongs to another of our companies. Book on this order’s company’s account.');
    }
    const production = account.environment === 'production';

    if (production) {
      const live = await this.prisma.carrierBooking.findMany({
        where: { transactionId, deletedAt: null, environment: 'production', status: { not: 'cancelled' } },
        select: { masterTrackingNumber: true },
      });
      if (live.length && !input.another) {
        const numbers = live.map((b) => b.masterTrackingNumber).filter(Boolean).join(', ');
        // Coded, so the screen can ask the question and send again rather than show an error.
        throw new ConflictException({
          statusCode: 409,
          code: 'ALREADY_BOOKED',
          message: `This order already has a FedEx label${numbers ? ` (${numbers})` : ''}. Book another only if more of it is going separately.`,
        });
      }
      if (!input.shippingServiceId) throw new BadRequestException('Choose which of our carriers this went with, so the order gets its tracking.');
    }

    // 3. Batteries, box by box.
    const parcels: ShipParcel[] = [];
    for (const [i, p] of (input.parcels ?? []).entries()) {
      let batteries: ShipParcel['batteries'] = null;
      if (p.batteryType) {
        const b = batteriesFor(p.batteryType);
        if (!b.ok) throw new BadRequestException(`Parcel ${i + 1} cannot be booked from the platform: ${b.reason}. Book it with FedEx directly.`);
        batteries = b.batteries;
      }
      parcels.push({
        weightKg: Number(p.weightKg),
        lengthCm: p.lengthCm ?? null,
        widthCm: p.widthCm ?? null,
        heightCm: p.heightCm ?? null,
        ...(batteries ? { batteries } : {}),
      });
    }
    if (parcels.some((p) => p.batteries) && !input.batteriesSectionII) {
      throw new BadRequestException('Confirm the lithium batteries are within IATA Section II (small consumer batteries) before booking — FedEx is told they are.');
    }

    // 4.
    const result = await this.carriers.book(account.id, {
      transactionId,
      serviceType: input.serviceType,
      shipDate: input.shipDate,
      parcels,
      dutiesPaidBy: input.dutiesPaidBy,
      goodsDescription: input.items?.[0]?.description ?? null,
      labelImageType: input.labelImageType ?? 'PDF',
      items: input.items ?? [],
      invoice: input.invoice ?? null,
      quoted: input.costEur != null ? { amount: input.costEur, currency: 'EUR' } : null,
    }, actorId, companyIds);

    // 5.
    const tracking = result.ok ? result.booking?.masterTrackingNumber ?? null : null;
    let shipmentId: string | null = null;
    if (result.ok && result.booking && production && tracking) {
      const markShipped = input.markShipped !== false;
      shipmentId = await this.prisma.$transaction(async (t) => {
        const shipment = await t.shipment.create({
          data: {
            transactionId,
            type: 'outbound',
            shipmentDate: new Date(`${input.shipDate}T12:00:00Z`),
            shippingServiceId: input.shippingServiceId ?? null,
            trackingNumber: tracking,
            // FedEx's quote for the service booked. Left unreviewed: it is still a quote until
            // accounting checks it against the invoice, exactly as a quoted price typed by hand is.
            shippingCostEur: input.costEur ?? null,
            costBorneBy: 'company',
            comments: 'Booked with FedEx from the platform',
            createdById: actorId ?? null,
          },
          select: { id: true },
        });
        await t.carrierBooking.update({ where: { id: result.booking!.id }, data: { shipmentId: shipment.id } });
        if (markShipped) await t.salesTransaction.update({ where: { id: transactionId }, data: { fulfilmentStatus: 'shipped' } });
        return shipment.id;
      });
    }

    return {
      ok: result.ok,
      status: result.status,
      message: result.ok
        ? production
          ? tracking
            ? null
            : 'Booked, but no tracking number could be read from FedEx’s reply, so no shipment was recorded. The reply is stored against the booking.'
          : 'Booked on SANDBOX: a test label, no real shipment. Nothing was recorded against the order.'
        : result.message,
      customs: result.customs,
      environment: account.environment,
      shipmentId,
      booking: result.booking,
      bookings: await this.bookings(transactionId),
      request: result.request,
      response: result.ok ? null : result.response,
    };
  }
}
