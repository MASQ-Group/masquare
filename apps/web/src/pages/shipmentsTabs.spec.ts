import { describe, expect, it } from 'vitest';
import { SHIPMENT_TABS, isCustomerTab, resolveTab } from './shipmentsTabs';

describe('resolveTab', () => {
  it('accepts every tab the page actually offers', () => {
    // The regression this file exists for: the customer queues were offered by the header and
    // rejected by the guard, so clicking them fell back to Pending and looked like a dead tab.
    for (const tab of SHIPMENT_TABS) {
      expect(resolveTab(tab.key), tab.key).toBe(tab.key);
    }
  });

  it('keeps both customer queues', () => {
    expect(resolveTab('customer-pending')).toBe('customer-pending');
    expect(resolveTab('customer-fulfilled')).toBe('customer-fulfilled');
  });

  it('falls back rather than trusting a key no branch matches', () => {
    // Persisted by an earlier build under the old spelling.
    expect(resolveTab('despatched')).toBe('pending');
    expect(resolveTab('')).toBe('pending');
    expect(resolveTab(null)).toBe('pending');
    expect(resolveTab(undefined)).toBe('pending');
    expect(resolveTab('anything else')).toBe('pending');
  });
});

describe('isCustomerTab', () => {
  it('is true for the two queues of shipments somebody else asked us to send', () => {
    expect(isCustomerTab('customer-pending')).toBe(true);
    expect(isCustomerTab('customer-fulfilled')).toBe(true);
  });

  it('is false for our own orders', () => {
    expect(isCustomerTab('pending')).toBe(false);
    expect(isCustomerTab('dispatched')).toBe(false);
    expect(isCustomerTab('fba')).toBe(false);
    expect(isCustomerTab('all')).toBe(false);
  });
});

describe('the list itself', () => {
  it('has no duplicate keys', () => {
    const keys = SHIPMENT_TABS.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives every tab a label somebody can read', () => {
    for (const tab of SHIPMENT_TABS) {
      expect(tab.label.trim().length, tab.key).toBeGreaterThan(0);
    }
  });
});
