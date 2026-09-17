import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { formatReference, normalisePrefix } from './customer-reference';
import { CUSTOMER_TYPES, LOGISTICS, missingForTypes, normaliseTypes } from './customer-types';

/**
 * The companies we provide services to.
 *
 * General on purpose: a customer is one record, and what we do for them is a list of types. Each
 * type brings its own requirements — a logistics customer needs a reference prefix, because their
 * shipments are numbered from it — and nothing here assumes which types a customer has.
 */

export interface CustomerInput {
  name?: string;
  legalName?: string | null;
  vatNumber?: string | null;
  eori?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  addressCity?: string | null;
  addressRegion?: string | null;
  addressPostalCode?: string | null;
  addressCountryIso?: string | null;
  /** Keys from the customer-type catalogue. */
  types?: string[];
  /** Logistics only. */
  referencePrefix?: string | null;
  companyId?: string | null;
  active?: boolean;
  notes?: string | null;
}

export interface ContactInput {
  name?: string;
  surname?: string | null;
  email?: string | null;
  phone?: string | null;
  role?: string | null;
}

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  /** The services a customer can take, for the form that chooses them. */
  types() {
    return CUSTOMER_TYPES;
  }

  async list(params: { q?: string; active?: string; type?: string } = {}) {
    const term = params.q?.trim();
    const items = await this.prisma.customer.findMany({
      where: {
        deletedAt: null,
        ...(params.active === 'true' ? { active: true } : params.active === 'false' ? { active: false } : {}),
        ...(params.type ? { types: { has: params.type } } : {}),
        ...(term
          ? {
            OR: [
              { name: { contains: term, mode: 'insensitive' as const } },
              { legalName: { contains: term, mode: 'insensitive' as const } },
              { vatNumber: { contains: term, mode: 'insensitive' as const } },
              { referencePrefix: { contains: term, mode: 'insensitive' as const } },
            ],
          }
          : {}),
      },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      include: {
        company: { select: { id: true, officialName: true } },
        contactPersons: { where: { deletedAt: null }, orderBy: { name: 'asc' } },
      },
    });
    return items.map((c) => this.shape(c));
  }

  async get(id: string) {
    const row = await this.prisma.customer.findFirst({
      where: { id, deletedAt: null },
      include: {
        company: { select: { id: true, officialName: true } },
        contactPersons: { where: { deletedAt: null }, orderBy: { name: 'asc' } },
      },
    });
    if (!row) throw new NotFoundException('Customer not found');
    return this.shape(row);
  }

  async create(dto: CustomerInput, actorId?: string) {
    const name = (dto.name ?? '').trim();
    if (!name) throw new BadRequestException('A customer name is required.');
    const types = normaliseTypes(dto.types);
    if (!types.ok) throw new BadRequestException(types.reason);
    const prefix = await this.resolvePrefix(types.types, dto.referencePrefix, null);

    const row = await this.prisma.customer.create({
      data: {
        ...this.fields(dto),
        name,
        types: types.types,
        referencePrefix: prefix,
        createdById: actorId ?? null,
        updatedById: actorId ?? null,
      },
      select: { id: true },
    });
    return this.get(row.id);
  }

  async update(id: string, dto: CustomerInput, actorId?: string) {
    const current = await this.prisma.customer.findFirst({ where: { id, deletedAt: null }, select: { id: true, referencePrefix: true, referenceSeq: true, types: true } });
    if (!current) throw new NotFoundException('Customer not found');

    const data: Prisma.CustomerUpdateInput = { ...this.fields(dto), updatedById: actorId ?? null };
    if (dto.name !== undefined) {
      const name = (dto.name ?? '').trim();
      if (!name) throw new BadRequestException('A customer name is required.');
      data.name = name;
    }
    let types = current.types;
    if (dto.types !== undefined) {
      const next = normaliseTypes(dto.types);
      if (!next.ok) throw new BadRequestException(next.reason);
      /**
       * A service with history cannot simply be switched off: their shipments are numbered from the
       * prefix and their people sign in through it. Removing the type would strand both, so it is
       * refused once anything has been issued — mark the customer inactive instead.
       */
      if (current.types.includes(LOGISTICS) && !next.types.includes(LOGISTICS) && current.referenceSeq > 0) {
        throw new ConflictException(
          `They have ${current.referenceSeq} logistics shipment${current.referenceSeq === 1 ? '' : 's'} on record, so they stay a logistics customer. Mark them inactive to stop new ones.`,
        );
      }
      types = next.types;
      data.types = types;
    }

    const wanted = dto.referencePrefix !== undefined ? dto.referencePrefix : current.referencePrefix;
    const prefix = await this.resolvePrefix(types, wanted, current);
    if (prefix !== current.referencePrefix) data.referencePrefix = prefix;

    await this.prisma.customer.update({ where: { id }, data });
    return this.get(id);
  }

  /**
   * Remove a customer.
   *
   * Soft, like everything else that is referenced: their shipments, their charges and their people
   * all point at this row, and a hard delete would take the history of work we were paid for with it.
   */
  async remove(id: string, actorId?: string) {
    const row = await this.prisma.customer.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!row) throw new NotFoundException('Customer not found');
    await this.prisma.customer.update({ where: { id }, data: { deletedAt: new Date(), active: false, updatedById: actorId ?? null } });
    return { removed: true };
  }

  // ── contact people ───────────────────────────────────────────────────────────────────────────

  async addContact(customerId: string, dto: ContactInput) {
    await this.get(customerId);
    const name = (dto.name ?? '').trim();
    if (!name) throw new BadRequestException('A contact needs a name.');
    await this.prisma.customerContactPerson.create({
      data: { customerId, name, surname: dto.surname ?? null, email: dto.email ?? null, phone: dto.phone ?? null, role: dto.role ?? null },
    });
    return this.get(customerId);
  }

  async updateContact(customerId: string, contactId: string, dto: ContactInput) {
    const contact = await this.prisma.customerContactPerson.findFirst({ where: { id: contactId, customerId, deletedAt: null }, select: { id: true } });
    if (!contact) throw new NotFoundException('Contact not found');
    await this.prisma.customerContactPerson.update({
      where: { id: contactId },
      data: {
        ...(dto.name !== undefined ? { name: (dto.name ?? '').trim() || undefined } : {}),
        ...(dto.surname !== undefined ? { surname: dto.surname } : {}),
        ...(dto.email !== undefined ? { email: dto.email } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
        ...(dto.role !== undefined ? { role: dto.role } : {}),
      },
    });
    return this.get(customerId);
  }

  async removeContact(customerId: string, contactId: string) {
    const contact = await this.prisma.customerContactPerson.findFirst({ where: { id: contactId, customerId, deletedAt: null }, select: { id: true } });
    if (!contact) throw new NotFoundException('Contact not found');
    await this.prisma.customerContactPerson.update({ where: { id: contactId }, data: { deletedAt: new Date() } });
    return this.get(customerId);
  }

  // ── internals ────────────────────────────────────────────────────────────────────────────────

  /** A customer as the screens read it. A next reference only means something for logistics. */
  private shape<T extends { referencePrefix: string | null; referenceSeq: number }>(c: T) {
    return { ...c, nextReference: c.referencePrefix ? formatReference(c.referencePrefix, c.referenceSeq + 1) : null };
  }

  /**
   * The prefix this customer should hold, given its types.
   *
   * Required for logistics, and cleared for everyone else — a prefix left on somebody who is no longer
   * a logistics customer would reserve two letters nobody can use. Fixed once a reference has been
   * issued under it: those references are on paperwork, and changing the prefix would leave the
   * customer quoting letters that no longer name them.
   */
  private async resolvePrefix(
    types: readonly string[],
    raw: string | null | undefined,
    current: { id: string; referencePrefix: string | null; referenceSeq: number } | null,
  ): Promise<string | null> {
    const gaps = missingForTypes(types, { referencePrefix: raw });
    if (gaps.length) throw new BadRequestException(gaps.join(' '));
    if (!types.includes(LOGISTICS)) return current && current.referenceSeq > 0 ? current.referencePrefix : null;

    const prefix = normalisePrefix(raw);
    if (!prefix.ok) throw new BadRequestException(prefix.reason);
    if (current?.referencePrefix && prefix.prefix !== current.referencePrefix && current.referenceSeq > 0) {
      throw new ConflictException(
        `Their shipments are already numbered ${current.referencePrefix}-…, and those references are on paperwork. The prefix cannot be changed now.`,
      );
    }
    if (prefix.prefix !== current?.referencePrefix) await this.assertPrefixFree(prefix.prefix, current?.id);
    return prefix.prefix;
  }

  /**
   * Names the customer already holding it, rather than reporting a unique-index violation.
   *
   * Removed customers are included: the database index still holds their prefix, and a soft-deleted
   * customer's references are still on somebody's paperwork.
   */
  private async assertPrefixFree(prefix: string, exceptId?: string) {
    const taken = await this.prisma.customer.findFirst({ where: { referencePrefix: prefix, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { name: true } });
    if (taken) throw new ConflictException(`The prefix ${prefix} is already ${taken.name}’s. Every reference has to name one customer, so pick another.`);
  }

  /** The plain fields, each written only when the caller said something about it. */
  private fields(dto: CustomerInput) {
    const text = (v: string | null | undefined) => (v === undefined ? undefined : (v ?? '').trim() || null);
    return {
      ...(dto.legalName !== undefined ? { legalName: text(dto.legalName) } : {}),
      ...(dto.vatNumber !== undefined ? { vatNumber: text(dto.vatNumber) } : {}),
      ...(dto.eori !== undefined ? { eori: text(dto.eori) } : {}),
      ...(dto.email !== undefined ? { email: text(dto.email) } : {}),
      ...(dto.phone !== undefined ? { phone: text(dto.phone) } : {}),
      ...(dto.website !== undefined ? { website: text(dto.website) } : {}),
      ...(dto.addressLine1 !== undefined ? { addressLine1: text(dto.addressLine1) } : {}),
      ...(dto.addressLine2 !== undefined ? { addressLine2: text(dto.addressLine2) } : {}),
      ...(dto.addressCity !== undefined ? { addressCity: text(dto.addressCity) } : {}),
      ...(dto.addressRegion !== undefined ? { addressRegion: text(dto.addressRegion) } : {}),
      ...(dto.addressPostalCode !== undefined ? { addressPostalCode: text(dto.addressPostalCode) } : {}),
      ...(dto.addressCountryIso !== undefined ? { addressCountryIso: (dto.addressCountryIso ?? '').trim().toUpperCase() || null } : {}),
      ...(dto.notes !== undefined ? { notes: text(dto.notes) } : {}),
      ...(dto.active !== undefined ? { active: dto.active } : {}),
      ...(dto.companyId !== undefined ? { companyId: dto.companyId || null } : {}),
    };
  }
}
