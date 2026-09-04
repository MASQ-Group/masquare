import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { TransfersService, normaliseSerials, nextTransferReference, parseSerials } from './transfers.service';

/**
 * Transfers move real stock out of one warehouse and into another in a single transaction, so the
 * rules that refuse a bad move are the whole safety story. Every one of them fails silently if
 * dropped: the move still succeeds, the balances still add up, and the damage only surfaces later
 * as stock that is in the wrong place or counted twice.
 *
 * The prisma double throws on $transaction, which makes "refused before anything was written" a
 * property the tests can actually assert rather than assume.
 */

const MAIN = { id: 'w-main', name: 'Main Warehouse', isActive: true, companyId: 'co-1' };
const OFFICE = { id: 'w-office', name: 'Office', isActive: true, companyId: 'co-1' };
const OTHER_CO = { id: 'w-mt', name: 'Multitrade Store', isActive: true, companyId: 'co-2' };

const WIDGET = { id: 'p-1', mainSku: 'RE-S8540', title: 'Widget', serialTracked: false };
const TRACKED = { id: 'p-2', mainSku: 'RE-TRACKED', title: 'Tracked thing', serialTracked: true };

function service(opts: {
  warehouses?: any[];
  products?: any[];
  levels?: { productId: string; warehouseId: string; quantityOnHand: number }[];
  serials?: any[];
} = {}) {
  const writes: string[] = [];
  const prisma: any = {
    warehouse: { findMany: async () => opts.warehouses ?? [MAIN, OFFICE] },
    product: { findMany: async () => opts.products ?? [WIDGET, TRACKED] },
    productSkuAlias: { findMany: async () => [] },
    stockLevel: { findMany: async () => opts.levels ?? [] },
    serialNumber: { findMany: async () => opts.serials ?? [] },
    user: { findMany: async () => [] },
    $transaction: async () => {
      writes.push('transaction');
      throw new Error('a refusal must happen before any write');
    },
  };
  const stock: any = { applyDeltaWithin: async () => ({}) };
  const activity: any = { record: async () => {} };
  return { svc: new TransfersService(prisma, stock, activity), writes };
}

describe('serial parsing', () => {
  it('accepts whatever separator someone reached for', () => {
    expect(parseSerials('SN-1, SN-2; SN-3 | SN-4\nSN-5')).toEqual(['SN-1', 'SN-2', 'SN-3', 'SN-4', 'SN-5']);
  });

  it('treats an empty or absent cell as no serials rather than one blank one', () => {
    expect(parseSerials('')).toEqual([]);
    expect(parseSerials(null)).toEqual([]);
    expect(parseSerials('   ')).toEqual([]);
  });

  it('refuses a list naming the same unit twice — one unit cannot move twice', () => {
    expect(() => normaliseSerials(['SN-1', 'SN-2', 'SN-1'], 'SKU')).toThrow(BadRequestException);
  });
});

describe('transfer reference', () => {
  const year = new Date().getUTCFullYear();

  it('starts at 00001 for the year', async () => {
    const tx: any = { stockTransfer: { findFirst: async () => null } };
    expect(await nextTransferReference(tx)).toBe(`TRF-${year}-00001`);
  });

  it('continues from the highest existing suffix, not from a count', async () => {
    // A count would reissue a number after a deletion; two transfers would then share a reference.
    const tx: any = { stockTransfer: { findFirst: async () => ({ reference: `TRF-${year}-00417` }) } };
    expect(await nextTransferReference(tx)).toBe(`TRF-${year}-00418`);
  });
});

describe('transfer refusals', () => {
  const line = { productId: WIDGET.id, quantity: 5 };

  it('refuses a move to the same warehouse', async () => {
    const { svc, writes } = service();
    await expect(svc.create({ fromWarehouseId: MAIN.id, toWarehouseId: MAIN.id, lines: [line] })).rejects.toThrow(
      /same warehouse/i,
    );
    expect(writes).toEqual([]);
  });

  it('refuses a move between companies, which is a sale rather than a transfer', async () => {
    const { svc, writes } = service({ warehouses: [MAIN, OTHER_CO] });
    await expect(
      svc.create({ fromWarehouseId: MAIN.id, toWarehouseId: OTHER_CO.id, lines: [line] }),
    ).rejects.toThrow(/different companies/i);
    expect(writes).toEqual([]);
  });

  it('refuses an inactive source', async () => {
    const { svc } = service({ warehouses: [{ ...MAIN, isActive: false }, OFFICE] });
    await expect(svc.create({ fromWarehouseId: MAIN.id, toWarehouseId: OFFICE.id, lines: [line] })).rejects.toThrow(
      /inactive/i,
    );
  });

  it('refuses an empty transfer', async () => {
    const { svc } = service();
    await expect(svc.create({ fromWarehouseId: MAIN.id, toWarehouseId: OFFICE.id, lines: [] })).rejects.toThrow(
      /at least one product/i,
    );
  });

  it('refuses the same product on two lines instead of silently summing them', async () => {
    // Both lines would be applied, so a sheet saying 5 would move 10.
    const { svc } = service();
    await expect(
      svc.create({ fromWarehouseId: MAIN.id, toWarehouseId: OFFICE.id, lines: [line, { ...line, quantity: 3 }] }),
    ).rejects.toThrow(/more than one line/i);
  });

  it('refuses a zero or negative quantity', async () => {
    const { svc } = service();
    for (const quantity of [0, -2]) {
      await expect(
        svc.create({ fromWarehouseId: MAIN.id, toWarehouseId: OFFICE.id, lines: [{ productId: WIDGET.id, quantity }] }),
      ).rejects.toThrow(/above zero/i);
    }
  });

  it('requires serials for a tracked product', async () => {
    const { svc } = service();
    await expect(
      svc.create({ fromWarehouseId: MAIN.id, toWarehouseId: OFFICE.id, lines: [{ productId: TRACKED.id, quantity: 2 }] }),
    ).rejects.toThrow(/serial-tracked/i);
  });

  it('refuses a quantity that disagrees with the serials named', async () => {
    // One of the two is wrong and there is no way to tell which, so neither is assumed.
    const { svc } = service();
    await expect(
      svc.create({
        fromWarehouseId: MAIN.id,
        toWarehouseId: OFFICE.id,
        lines: [{ productId: TRACKED.id, quantity: 3, serials: ['SN-1', 'SN-2'] }],
      }),
    ).rejects.toThrow(/quantity is 3 but 2 serials were named/i);
  });

  it('refuses serials on a product that is not tracked', async () => {
    const { svc } = service();
    await expect(
      svc.create({
        fromWarehouseId: MAIN.id,
        toWarehouseId: OFFICE.id,
        lines: [{ productId: WIDGET.id, quantity: 1, serials: ['SN-1'] }],
      }),
    ).rejects.toThrow(/not serial-tracked/i);
  });
});

describe('transfer import validation', () => {
  const sheet = (rows: any[]) => rows;

  it('walks the running balance so an over-draw is caught on the row that causes it', async () => {
    // Each row alone fits in the 15 on hand; together they do not. Checking rows against the
    // database independently would pass all three and fail half-way through the commit.
    const { svc } = service({ levels: [{ productId: WIDGET.id, warehouseId: MAIN.id, quantityOnHand: 15 }] });
    const res = await svc.importValidate(
      sheet([
        { sku: 'RE-S8540', fromWarehouse: 'Main Warehouse', toWarehouse: 'Office', quantity: '10' },
        { sku: 'RE-S8540', fromWarehouse: 'Main Warehouse', toWarehouse: 'Office', quantity: '4' },
        { sku: 'RE-S8540', fromWarehouse: 'Main Warehouse', toWarehouse: 'Office', quantity: '3' },
      ]),
    );
    expect(res.rows[0].valid).toBe(true);
    expect(res.rows[1].valid).toBe(true);
    expect(res.rows[2].valid).toBe(false);
    expect(res.rows[2].errors[0]).toMatch(/has 1 .* available at this row/);
  });

  it('reports the sheet row number, counting the header', async () => {
    const { svc } = service();
    const res = await svc.importValidate(sheet([{ sku: 'NOPE', fromWarehouse: 'Main Warehouse', toWarehouse: 'Office', quantity: '1' }]));
    expect(res.rows[0].row).toBe(2);
    expect(res.rows[0].errors[0]).toMatch(/not in the catalogue/i);
  });

  it('rejects an unknown warehouse name rather than guessing', async () => {
    const { svc } = service();
    const res = await svc.importValidate(sheet([{ sku: 'RE-S8540', fromWarehouse: 'Storeroom', toWarehouse: 'Office', quantity: '1' }]));
    expect(res.rows[0].errors[0]).toMatch(/No active warehouse named "Storeroom"/);
  });

  it('catches the same serial being moved twice in one file', async () => {
    const { svc } = service();
    const res = await svc.importValidate(
      sheet([
        { sku: 'RE-TRACKED', fromWarehouse: 'Main Warehouse', toWarehouse: 'Office', serials: 'SN-1 SN-2' },
        { sku: 'RE-TRACKED', fromWarehouse: 'Main Warehouse', toWarehouse: 'Office', serials: 'SN-2' },
      ]),
    );
    expect(res.rows[1].valid).toBe(false);
    expect(res.rows[1].errors.join(' ')).toMatch(/SN-2 is moved twice/);
  });

  it('derives the quantity of a tracked row from its serials', async () => {
    const { svc } = service();
    const res = await svc.importValidate(
      sheet([{ sku: 'RE-TRACKED', fromWarehouse: 'Main Warehouse', toWarehouse: 'Office', serials: 'SN-1, SN-2, SN-3' }]),
    );
    expect(res.rows[0].quantity).toBe(3);
    expect(res.rows[0].serials).toEqual(['SN-1', 'SN-2', 'SN-3']);
  });

  it('flags a same-warehouse row and a cross-company row', async () => {
    const { svc } = service({ warehouses: [MAIN, OFFICE, OTHER_CO] });
    const res = await svc.importValidate(
      sheet([
        { sku: 'RE-S8540', fromWarehouse: 'Main Warehouse', toWarehouse: 'Main Warehouse', quantity: '1' },
        { sku: 'RE-S8540', fromWarehouse: 'Main Warehouse', toWarehouse: 'Multitrade Store', quantity: '1' },
      ]),
    );
    expect(res.rows[0].errors.join(' ')).toMatch(/same warehouse/i);
    expect(res.rows[1].errors.join(' ')).toMatch(/different companies/i);
  });

  it('refuses to commit anything when a single row is bad', async () => {
    // Row 2 is fine and would otherwise be applied; the point is that row 3 stops it too.
    const { svc } = service({ levels: [{ productId: WIDGET.id, warehouseId: MAIN.id, quantityOnHand: 50 }] });
    await expect(
      svc.importCommit(sheet([
        { sku: 'RE-S8540', fromWarehouse: 'Main Warehouse', toWarehouse: 'Office', quantity: '1' },
        { sku: 'NOPE', fromWarehouse: 'Main Warehouse', toWarehouse: 'Office', quantity: '1' },
      ])),
    ).rejects.toThrow(/Row 3.*nothing was imported/s);
  });
});
