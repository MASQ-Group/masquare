import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../common/current-user.decorator';

export type SearchScope =
  | 'all'
  | 'products'
  | 'sales-transactions'
  | 'sales-channels'
  | 'countries'
  | 'shipping-services'
  | 'companies'
  | 'users';

export interface SearchHit {
  id: string;
  label: string;
  sub?: string | null;
}

const TAKE = 5;

/** Cross-module search behind the top-bar command palette. Each module returns
 *  up to five hits; the client decides how to present and navigate them. */
@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(q: string, scope: SearchScope, user: AuthUser) {
    const term = q.trim();
    if (term.length < 2) return { groups: [] };
    const contains = { contains: term, mode: 'insensitive' as const };
    const want = (s: SearchScope) => scope === 'all' || scope === s;

    const [products, transactions, channels, countries, services, companies, users] = await Promise.all([
      want('products')
        ? this.prisma.product.findMany({
            where: {
              deletedAt: null,
              OR: [
                { mainSku: contains }, { title: contains }, { ean: contains }, { upc: contains },
                { vendorSku: contains }, { manufacturerSku: contains },
                { aliases: { some: { deletedAt: null, skuValue: contains } } },
              ],
            },
            select: { id: true, mainSku: true, title: true },
            take: TAKE,
          })
        : [],
      want('sales-transactions')
        ? this.prisma.salesTransaction.findMany({
            where: {
              deletedAt: null,
              OR: [
                { transactionRef: contains },
                { items: { some: { deletedAt: null, sku: contains } } },
              ],
            },
            select: { id: true, transactionRef: true, date: true, salesChannel: { select: { name: true } } },
            orderBy: { date: 'desc' },
            take: TAKE,
          })
        : [],
      want('sales-channels')
        ? this.prisma.salesChannel.findMany({
            where: { deletedAt: null, name: contains },
            select: { id: true, name: true, nativeCurrency: true },
            take: TAKE,
          })
        : [],
      want('countries')
        ? this.prisma.country.findMany({
            where: { deletedAt: null, OR: [{ name: contains }, { isoCode: contains }] },
            select: { id: true, name: true, isoCode: true },
            take: TAKE,
          })
        : [],
      want('shipping-services')
        ? this.prisma.shippingService.findMany({
            where: { deletedAt: null, name: contains },
            select: { id: true, name: true },
            take: TAKE,
          })
        : [],
      want('companies') && user.isAdmin
        ? this.prisma.company.findMany({
            where: { deletedAt: null, OR: [{ officialName: contains }, { registrationNumber: contains }] },
            select: { id: true, officialName: true, registrationNumber: true },
            take: TAKE,
          })
        : [],
      want('users') && user.isAdmin
        ? this.prisma.user.findMany({
            where: { deletedAt: null, OR: [{ fullName: contains }, { email: contains }] },
            select: { id: true, fullName: true, email: true },
            take: TAKE,
          })
        : [],
    ]);

    const groups: { module: SearchScope; items: SearchHit[] }[] = [];
    const push = (module: SearchScope, items: SearchHit[]) => { if (items.length) groups.push({ module, items }); };

    push('products', products.map((p) => ({ id: p.id, label: p.title, sub: p.mainSku })));
    push('sales-transactions', transactions.map((t) => ({
      id: t.id,
      label: t.transactionRef,
      sub: [t.salesChannel?.name, t.date.toISOString().slice(0, 10)].filter(Boolean).join(' · '),
    })));
    push('sales-channels', channels.map((c) => ({ id: c.id, label: c.name, sub: c.nativeCurrency })));
    push('countries', countries.map((c) => ({ id: c.id, label: c.name, sub: c.isoCode })));
    push('shipping-services', services.map((s) => ({ id: s.id, label: s.name })));
    push('companies', companies.map((c) => ({ id: c.id, label: c.officialName, sub: c.registrationNumber })));
    push('users', users.map((u) => ({ id: u.id, label: u.fullName, sub: u.email })));

    return { groups };
  }
}
