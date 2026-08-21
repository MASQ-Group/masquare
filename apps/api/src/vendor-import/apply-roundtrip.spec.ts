import { describe, it, expect } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { VendorImportService } from './vendor-import.service';

// Apply -> verify -> roll back -> verify, against the real database on a throwaway vendor and
// product. A rollback that does not actually restore is worse than no rollback at all, so the
// round trip is checked rather than assumed.
const RUNNABLE = !!process.env.DATABASE_URL;

/** A one-sheet workbook, built in memory so no fixture file is needed. */
async function buildSheet(rows: (string | number)[][]): Promise<Buffer> {
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Prices');
  return XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
}

describe('apply and roll back', () => {
  it.skipIf(!RUNNABLE)('restores every field to what it was', async () => {
    const prisma = new PrismaClient();
    const svc = new VendorImportService(prisma as any);
    const stamp = Date.now();
    const sku = `ZZ-ROUNDTRIP-${stamp}`;
    let vendorId = '';
    let productId = '';

    try {
      const vendor = await prisma.vendor.create({ data: { name: `ZZ Test Vendor ${stamp}`, currency: 'EUR', mapIncludesVat: true } });
      vendorId = vendor.id;
      const product = await prisma.product.create({
        data: { mainSku: sku, title: 'Round-trip fixture', purchaseCostAmount: 10, purchaseCostCurrency: 'EUR', mapAmount: 20, mapCurrency: 'EUR', ean: '1111111111116' },
      });
      productId = product.id;
      await prisma.productAvailability.create({ data: { productId, quantity: 5, lastSource: 'manual' } });

      const buf = await buildSheet([
        ['SKU', 'BARCODE', 'STOCK', 'DL.PRICE', 'SRP'],
        [sku, '2222222222229', 42, 12.5, 25],
      ]);
      const file = { originalname: 'roundtrip.xlsx', buffer: buf };
      const mapping = { sku: 0, ean: 1, availability: 2, purchaseCost: 3, map: 4 };

      // Preview must not write.
      const pv = await svc.preview(file as any, vendorId, mapping as any, 'EUR');
      expect(pv.summary.total).toBe(4); // cost, map, availability, ean
      const untouched = await prisma.product.findUnique({ where: { id: productId }, select: { purchaseCostAmount: true } });
      expect(Number(untouched!.purchaseCostAmount)).toBe(10);

      const applied = await svc.apply(file as any, vendorId, mapping as any, 'EUR', undefined, undefined, undefined);
      expect(applied.applied).toBeGreaterThan(0);

      const after = await prisma.product.findUnique({
        where: { id: productId },
        select: { purchaseCostAmount: true, mapAmount: true, ean: true, availability: { select: { quantity: true } } },
      });
      expect(Number(after!.purchaseCostAmount)).toBe(12.5);
      expect(Number(after!.mapAmount)).toBe(25);
      expect(after!.ean).toBe('2222222222229');
      expect(after!.availability?.quantity).toBe(42);

      // Re-applying the same file now proposes nothing.
      const second = await svc.preview(file as any, vendorId, mapping as any, 'EUR');
      expect(second.summary.total).toBe(0);

      await svc.rollback(applied.runId);
      const restored = await prisma.product.findUnique({
        where: { id: productId },
        select: { purchaseCostAmount: true, mapAmount: true, ean: true, availability: { select: { quantity: true } } },
      });
      expect(Number(restored!.purchaseCostAmount)).toBe(10);
      expect(Number(restored!.mapAmount)).toBe(20);
      expect(restored!.ean).toBe('1111111111116');
      expect(restored!.availability?.quantity).toBe(5);

      // Rolling back twice is refused rather than silently repeated.
      await expect(svc.rollback(applied.runId)).rejects.toThrow();

      // --- brand discount: the discounted figure is what reaches the product ---
      const brand = await prisma.brand.create({ data: { name: `ZZ Brand ${stamp}` } });
      await prisma.product.update({ where: { id: productId }, data: { brandId: brand.id } });
      try {
        const disc = { [brand.id]: 25 };
        const dp = await svc.preview(file as any, vendorId, mapping as any, 'EUR', undefined, disc);
        const costChange = dp.changes.find((c) => c.field === 'purchaseCost')!;
        expect(costChange.newValue).toBe('9.375 EUR'); // 12.50 less 25%
        expect(costChange.note).toContain('25%');

        const run2 = await svc.apply(file as any, vendorId, mapping as any, 'EUR', undefined, undefined, undefined, disc);
        const discounted = await prisma.product.findUnique({ where: { id: productId }, select: { purchaseCostAmount: true } });
        expect(Number(discounted!.purchaseCostAmount)).toBe(9.375);

        const stored = await prisma.vendorImportRun.findUnique({ where: { id: run2.runId }, select: { brandDiscounts: true } });
        expect(stored!.brandDiscounts).toEqual(disc); // recorded, so the run can be explained later

        await svc.rollback(run2.runId);
      } finally {
        await prisma.product.update({ where: { id: productId }, data: { brandId: null } }).catch(() => {});
        await prisma.brand.delete({ where: { id: brand.id } }).catch(() => {});
      }
    } finally {
      if (productId) {
        await prisma.availabilityLedger.deleteMany({ where: { productId } });
        await prisma.productAvailability.deleteMany({ where: { productId } });
        await prisma.vendorImportChange.deleteMany({ where: { productId } });
      }
      if (vendorId) await prisma.vendorImportRun.deleteMany({ where: { vendorId } });
      if (productId) await prisma.product.delete({ where: { id: productId } }).catch(() => {});
      if (vendorId) await prisma.vendor.delete({ where: { id: vendorId } }).catch(() => {});
      await prisma.$disconnect();
    }
  });
});
