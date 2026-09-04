import { describe, expect, it } from 'vitest';
import { AdjustmentsService } from './adjustments.service';

/**
 * A manual adjustment is the one place stock appears or vanishes on somebody's word alone, so the
 * rules here are what stand between a typo and a write-off.
 *
 * The case worth being most careful about is a serial-tracked product: `set` would have to mean
 * "these are all the serials present", and a paste that came up short would scrap every unit it
 * failed to mention while reporting success. It is refused, and that refusal is pinned below.
 */

const MAIN = { id: 'w-main', name: 'Main Warehouse', isActive: true };
const WIDGET = { id: 'p-1', mainSku: 'RE-S8540', title: 'Widget', serialTracked: false };
const TRACKED = { id: 'p-2', mainSku: 'RE-TRACKED', title: 'Tracked thing', serialTracked: true };

function service(opts: {
  product?: any;
  warehouse?: any;
  warehouses?: any[];
  products?: any[];
  onHand?: number;
  levels?: { productId: string; warehouseId: string; quantityOnHand: number }[];
} = {}) {
  const deltas: number[] = [];
  const prisma: any = {
    product: {
      findFirst: async () => (opts.product === undefined ? WIDGET : opts.product),
      findMany: async () => opts.products ?? [WIDGET, TRACKED],
    },
    warehouse: {
      findFirst: async () => (opts.warehouse === undefined ? MAIN : opts.warehouse),
      findMany: async () => opts.warehouses ?? [MAIN],
    },
    productSkuAlias: { findMany: async () => [] },
    stockLevel: {
      findUnique: async () => (opts.onHand === undefined ? null : { quantityOnHand: opts.onHand }),
      findMany: async () => opts.levels ?? [],
    },
    $transaction: async (fn: any) =>
      fn({
        serialNumber: { findMany: async () => [], createMany: async () => {}, updateMany: async () => {} },
      }),
  };
  const stock: any = {
    applyDeltaWithin: async (_tx: any, args: any) => {
      deltas.push(args.qtyDelta);
      return { productId: args.productId, warehouseId: args.warehouseId, quantityOnHand: 0, qtyDelta: args.qtyDelta };
    },
  };
  const activity: any = { record: async () => {} };
  return { svc: new AdjustmentsService(prisma, stock, activity), deltas };
}

const base = { productId: WIDGET.id, warehouseId: MAIN.id, reason: 'adjustment' as const };

describe('quantity adjustments', () => {
  it('derives the delta from the stated true count', async () => {
    const { svc, deltas } = service({ onHand: 12 });
    await svc.adjust({ ...base, mode: 'set', quantity: 20 });
    expect(deltas).toEqual([8]);
  });

  it('goes negative when the recount is lower', async () => {
    const { svc, deltas } = service({ onHand: 12 });
    await svc.adjust({ ...base, mode: 'set', quantity: 5 });
    expect(deltas).toEqual([-7]);
  });

  it('writes nothing when the count already matches — not every save is an event', async () => {
    const { svc, deltas } = service({ onHand: 12 });
    const res = await svc.adjust({ ...base, mode: 'set', quantity: 12 });
    expect(res.changed).toBe(false);
    expect(deltas).toEqual([]);
  });

  it('treats add and remove as the change itself, not the target', async () => {
    const add = service({ onHand: 12 });
    await add.svc.adjust({ ...base, mode: 'add', quantity: 3 });
    expect(add.deltas).toEqual([3]);

    const remove = service({ onHand: 12 });
    await remove.svc.adjust({ ...base, mode: 'remove', quantity: 3 });
    expect(remove.deltas).toEqual([-3]);
  });

  it('allows a recount to zero but refuses a negative one', async () => {
    const ok = service({ onHand: 4 });
    await expect(ok.svc.adjust({ ...base, mode: 'set', quantity: 0 })).resolves.toBeTruthy();

    const bad = service({ onHand: 4 });
    await expect(bad.svc.adjust({ ...base, mode: 'set', quantity: -1 })).rejects.toThrow(/cannot be negative/i);
  });

  it('refuses adding or removing nothing', async () => {
    const { svc } = service({ onHand: 4 });
    await expect(svc.adjust({ ...base, mode: 'add', quantity: 0 })).rejects.toThrow(/above zero/i);
  });

  it('refuses a fractional quantity', async () => {
    const { svc } = service({ onHand: 4 });
    await expect(svc.adjust({ ...base, mode: 'set', quantity: 2.5 })).rejects.toThrow(/whole number/i);
  });

  it('refuses serials on a product that is not tracked', async () => {
    const { svc } = service({ onHand: 4 });
    await expect(svc.adjust({ ...base, mode: 'add', quantity: 1, serials: ['SN-1'] })).rejects.toThrow(
      /not serial-tracked/i,
    );
  });

  it('refuses to touch an inactive warehouse', async () => {
    const { svc } = service({ warehouse: { ...MAIN, isActive: false } });
    await expect(svc.adjust({ ...base, mode: 'set', quantity: 1 })).rejects.toThrow(/inactive/i);
  });
});

describe('serial-tracked adjustments', () => {
  const tracked = { ...base, productId: TRACKED.id };

  it('refuses `set`, because it would write off every unit not named', async () => {
    const { svc, deltas } = service({ product: TRACKED });
    await expect(svc.adjust({ ...tracked, mode: 'set', quantity: 3 })).rejects.toThrow(/Add or remove the specific serial/i);
    expect(deltas).toEqual([]);
  });

  it('requires the serials to be named', async () => {
    const { svc } = service({ product: TRACKED });
    await expect(svc.adjust({ ...tracked, mode: 'add', quantity: 2 })).rejects.toThrow(/name the serial numbers/i);
  });

  it('takes the quantity from the list rather than the number typed', async () => {
    const { svc, deltas } = service({ product: TRACKED });
    await svc.adjust({ ...tracked, mode: 'add', serials: ['SN-1', 'SN-2', 'SN-3'] });
    expect(deltas).toEqual([3]);
  });

  it('refuses a quantity that disagrees with the list', async () => {
    const { svc } = service({ product: TRACKED });
    await expect(svc.adjust({ ...tracked, mode: 'add', quantity: 5, serials: ['SN-1'] })).rejects.toThrow(
      /Quantity is 5 but 1 serial was named/,
    );
  });

  it('refuses a list naming the same unit twice', async () => {
    const { svc } = service({ product: TRACKED });
    await expect(svc.adjust({ ...tracked, mode: 'add', serials: ['SN-1', 'SN-1'] })).rejects.toThrow(/listed twice/i);
  });

  it('removes by the count of named serials', async () => {
    // The double reports the serials as registered and in this warehouse.
    const prisma: any = {
      product: { findFirst: async () => TRACKED },
      warehouse: { findFirst: async () => MAIN },
      $transaction: async (fn: any) =>
        fn({
          serialNumber: {
            findMany: async () => [
              { id: 's1', serial: 'SN-1', status: 'in_stock', warehouseId: MAIN.id },
              { id: 's2', serial: 'SN-2', status: 'in_stock', warehouseId: MAIN.id },
            ],
            createMany: async () => {},
            updateMany: async () => {},
          },
        }),
    };
    const deltas: number[] = [];
    const stock: any = {
      applyDeltaWithin: async (_tx: any, a: any) => { deltas.push(a.qtyDelta); return { quantityOnHand: 0, qtyDelta: a.qtyDelta }; },
    };
    const svc = new AdjustmentsService(prisma, stock, { record: async () => {} } as any);
    await svc.adjust({ ...tracked, mode: 'remove', serials: ['SN-1', 'SN-2'] });
    expect(deltas).toEqual([-2]);
  });

  it('refuses to remove a serial that is registered somewhere else', async () => {
    const prisma: any = {
      product: { findFirst: async () => TRACKED },
      warehouse: { findFirst: async () => MAIN },
      $transaction: async (fn: any) =>
        fn({
          serialNumber: {
            findMany: async () => [{ id: 's1', serial: 'SN-1', status: 'in_stock', warehouseId: 'w-elsewhere' }],
            createMany: async () => {},
            updateMany: async () => {},
          },
        }),
    };
    const svc = new AdjustmentsService(prisma, { applyDeltaWithin: async () => ({}) } as any, { record: async () => {} } as any);
    await expect(svc.adjust({ ...tracked, mode: 'remove', serials: ['SN-1'] })).rejects.toThrow(/Not in Main Warehouse/);
  });

  it('refuses to add a serial that is already on file', async () => {
    const prisma: any = {
      product: { findFirst: async () => TRACKED },
      warehouse: { findFirst: async () => MAIN },
      $transaction: async (fn: any) =>
        fn({
          serialNumber: {
            findMany: async () => [{ id: 's1', serial: 'SN-1', status: 'sold', warehouseId: null }],
            createMany: async () => {},
            updateMany: async () => {},
          },
        }),
    };
    const svc = new AdjustmentsService(prisma, { applyDeltaWithin: async () => ({}) } as any, { record: async () => {} } as any);
    await expect(svc.adjust({ ...tracked, mode: 'add', serials: ['SN-1'] })).rejects.toThrow(/Already registered/i);
  });
});

describe('adjustment import validation', () => {
  it('accepts the wording a person would type for each action', async () => {
    const { svc } = service({ levels: [{ productId: WIDGET.id, warehouseId: MAIN.id, quantityOnHand: 100 }] });
    const res = await svc.importValidate([
      { sku: 'RE-S8540', warehouse: 'Main Warehouse', action: 'Set', quantity: '10' },
      { sku: 'RE-S8540', warehouse: 'Main Warehouse', action: 'ADD', quantity: '1' },
      { sku: 'RE-S8540', warehouse: 'Main Warehouse', action: 'Remove', quantity: '1' },
      { sku: 'RE-S8540', warehouse: 'Main Warehouse', action: 'Recount', quantity: '5' },
    ]);
    expect(res.rows.map((r) => r.mode)).toEqual(['set', 'add', 'remove', 'set']);
    expect(res.errorCount).toBe(0);
  });

  it('rejects an action it does not recognise instead of guessing', async () => {
    const { svc } = service();
    const res = await svc.importValidate([{ sku: 'RE-S8540', warehouse: 'Main Warehouse', action: 'Fix', quantity: '1' }]);
    expect(res.rows[0].errors.join(' ')).toMatch(/not an action/i);
  });

  it('catches a removal that would take the balance below zero, counting the rows above', async () => {
    const { svc } = service({ levels: [{ productId: WIDGET.id, warehouseId: MAIN.id, quantityOnHand: 10 }] });
    const res = await svc.importValidate([
      { sku: 'RE-S8540', warehouse: 'Main Warehouse', action: 'Remove', quantity: '6' },
      { sku: 'RE-S8540', warehouse: 'Main Warehouse', action: 'Remove', quantity: '6' },
    ]);
    expect(res.rows[0].valid).toBe(true);
    expect(res.rows[1].valid).toBe(false);
    expect(res.rows[1].errors[0]).toMatch(/holds 4 /);
  });

  it('re-bases the running balance after a Set rather than adding to it', async () => {
    const { svc } = service({ levels: [{ productId: WIDGET.id, warehouseId: MAIN.id, quantityOnHand: 3 }] });
    const res = await svc.importValidate([
      { sku: 'RE-S8540', warehouse: 'Main Warehouse', action: 'Set', quantity: '50' },
      { sku: 'RE-S8540', warehouse: 'Main Warehouse', action: 'Remove', quantity: '40' },
    ]);
    // Without re-basing, row 3 would be measured against the original 3 and wrongly rejected.
    expect(res.errorCount).toBe(0);
  });

  it('refuses Set on a serial-tracked row', async () => {
    const { svc } = service();
    const res = await svc.importValidate([
      { sku: 'RE-TRACKED', warehouse: 'Main Warehouse', action: 'Set', quantity: '3', serials: 'SN-1 SN-2 SN-3' },
    ]);
    expect(res.rows[0].errors.join(' ')).toMatch(/use Add or Remove/i);
  });

  it('defaults a blank reason rather than failing the row', async () => {
    const { svc } = service({ levels: [{ productId: WIDGET.id, warehouseId: MAIN.id, quantityOnHand: 5 }] });
    const res = await svc.importValidate([{ sku: 'RE-S8540', warehouse: 'Main Warehouse', action: 'Add', quantity: '1' }]);
    expect(res.rows[0].reason).toBe('adjustment');
    expect(res.rows[0].valid).toBe(true);
  });

  it('rejects a reason that is not one of ours', async () => {
    const { svc } = service();
    const res = await svc.importValidate([
      { sku: 'RE-S8540', warehouse: 'Main Warehouse', action: 'Add', quantity: '1', reason: 'shrinkage' },
    ]);
    expect(res.rows[0].errors.join(' ')).toMatch(/not a reason/i);
  });

  it('refuses to commit anything when one row is bad', async () => {
    const { svc } = service({ levels: [{ productId: WIDGET.id, warehouseId: MAIN.id, quantityOnHand: 50 }] });
    await expect(
      svc.importCommit([
        { sku: 'RE-S8540', warehouse: 'Main Warehouse', action: 'Add', quantity: '1' },
        { sku: 'RE-S8540', warehouse: 'Main Warehouse', action: 'Add', quantity: 'lots' },
      ]),
    ).rejects.toThrow(/Row 3.*nothing was imported/s);
  });
});
