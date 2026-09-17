import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { formatReference, normalisePrefix } from './customer-reference';

/**
 * The companies we provide logistics services to.
 *
 * A customer is the tenant of the portal: their people sign in against this row, their shipments are
 * numbered from its prefix, and their invoices belong to the company named on it. Nearly every
 * question the portal will ask is answered here, which is why it exists before any of the portal
 * does.
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
  referencePrefix?: string;
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

  async list(params: { q?: string; active?: string } = {}) {
    const term = params.q?.trim();
    const items = await this.prisma.customer.findMany({
      where: {
        deletedAt: null,
        ...(params.active === 'true' ? { active: true } : params.active === 'false' ? { active: false } : {}),
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
    // The next reference each customer would hand out, which is the question people actually ask of
    // a prefix — "what number are they on".
    return items.map((c) => ({ ...c, nextReference: formatReference(c.referencePrefix, c.referenceSeq + 1) }));
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
    return { ...row, nextReference: formatReference(row.referencePrefix, row.referenceSeq + 1) };
  }

  async create(dto: CustomerInput, actorId?: string) {
    const name = (dto.name ?? '').trim();
    if (!name) throw new BadRequestException('A customer name is required.');
    const prefix = normalisePrefix(dto.referencePrefix);
    if (!prefix.ok) throw new BadRequestException(prefix.reason);
    await this.assertPrefixFree(prefix.prefix);

    const row = await this.prisma.customer.create({
      data: {
        ...this.fields(dto),
        name,
        referencePrefix: prefix.prefix,
        createdById: actorId ?? null,
        updatedById: actorId ?? null,
      },
      select: { id: true },
    });
    return this.get(row.id);
  }

  async update(id: string, dto: CustomerInput, actorId?: string) {
    const current = await this.prisma.customer.findFirst({ where: { id, deletedAt: null }, select: { id: true, referencePrefix: true, referenceSeq: true } });
    if (!current) throw new NotFoundException('Customer not found');

    const data: Prisma.CustomerUpdateInput = { ...this.fields(dto), updatedById: actorId ?? null };
    if (dto.name !== undefined) {
      const name = (dto.name ?? '').trim();
      if (!name) throw new BadRequestException('A customer name is required.');
      data.name = name;
    }
    if (dto.referencePrefix !== undefined) {
      const prefix = normalisePrefix(dto.referencePrefix);
      if (!prefix.ok) throw new BadRequestException(prefix.reason);
      if (prefix.prefix !== current.referencePrefix) {
        /**
         * The prefix is part of every reference already handed out.
         *
         * Changing it after shipments exist would leave the customer holding paperwork quoting a
         * prefix that no longer names them, and the numbering would carry on from where the old one
         * stopped. Refused while any reference has been issued; free to correct before that.
         */
        if (current.referenceSeq > 0) {
          throw new ConflictException(
            `Their shipments are already numbered ${current.referencePrefix}-…, and those references are on paperwork. The prefix cannot be changed now.`,
          );
        }
        await this.assertPrefixFree(prefix.prefix);
        data.referencePrefix = prefix.prefix;
      }
    }

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

  /** Names the customer already holding it, rather than reporting a unique-index violation. */
  private async assertPrefixFree(prefix: string) {
    const taken = await this.prisma.customer.findFirst({ where: { referencePrefix: prefix, deletedAt: null }, select: { name: true } });
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
