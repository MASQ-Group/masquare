import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { SalesTransactionItemDto } from './dto/sales-transaction.dto';

/**
 * Sales lines can carry a fraction of a unit.
 *
 * Some goods are sold by length or weight, so 1.5 is a real order line. The validator used to
 * demand a whole number and rejected the whole transaction.
 */
const make = (quantity: unknown) =>
  plainToInstance(SalesTransactionItemDto, { sku: 'SKU-1', quantity, netSalesAmount: 10 });

const errorsOn = async (quantity: unknown) => {
  const found = await validate(make(quantity));
  return found.filter((e) => e.property === 'quantity');
};

describe('sales line quantity', () => {
  it('accepts a fraction', async () => {
    expect(await errorsOn(1.5)).toHaveLength(0);
    expect(await errorsOn(0.5)).toHaveLength(0);
    expect(await errorsOn(2.25)).toHaveLength(0);
  });

  it('still accepts whole units', async () => {
    expect(await errorsOn(1)).toHaveLength(0);
    expect(await errorsOn(40)).toHaveLength(0);
  });

  it('rejects zero and negatives — neither is a sale', async () => {
    expect(await errorsOn(0)).not.toHaveLength(0);
    expect(await errorsOn(-1)).not.toHaveLength(0);
  });

  it('stops at three decimal places, so float noise cannot reach the revenue arithmetic', async () => {
    expect(await errorsOn(1.125)).toHaveLength(0);
    expect(await errorsOn(1.1255)).not.toHaveLength(0);
  });
});
