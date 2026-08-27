// Canonical columns for the shipment export/import sheet. `key` is what the API uses;
// `label` is the sheet header. `sample` seeds the template. Context columns (channel,
// destination, SKUs) are informational — read on export, ignored on import.
export interface ShipmentColumn {
  key: string;
  label: string;
  sample: string;
  context?: boolean;
  /**
   * Values this column accepts, when they are fixed. Columns whose options come from the platform
   * (shipping services) are filled in at download time instead — the list has to be the one that
   * exists then, not one baked in when this file was written.
   */
  options?: string[];
}

export const SHIPMENT_COLUMNS: ShipmentColumn[] = [
  { key: 'transactionRef', label: 'Transaction ID', sample: 'T6BWXDB' },
  { key: 'salesChannel', label: 'Sales channel', sample: 'OnBuy UK', context: true },
  { key: 'destination', label: 'Destination', sample: 'United Kingdom', context: true },
  { key: 'skus', label: 'SKUs', sample: 'RE-S8540; RE-AC8820', context: true },
  { key: 'type', label: 'Type', sample: 'outbound', options: ['outbound', 'inbound'] },
  { key: 'shipmentDate', label: 'Ship date', sample: '2026-07-07' },
  { key: 'shippingService', label: 'Shipping service', sample: 'Cyprus Postal Service' },
  { key: 'trackingNumber', label: 'Tracking number', sample: 'CP001142795CY' },
  { key: 'shippingCostEur', label: 'Shipping cost (EUR)', sample: '3.50' },
  { key: 'costBorneBy', label: 'Cost borne by', sample: 'company', options: ['company', 'customer'] },
  { key: 'dutyImportEur', label: 'Duty/import (EUR)', sample: '0.00' },
  { key: 'comments', label: 'Comments', sample: '' },
  { key: 'markShipped', label: 'Mark fully shipped', sample: 'yes', options: ['yes', 'no'] },
];

/** Header row (labels) for the export/template sheet. */
export const SHIPMENT_HEADER = SHIPMENT_COLUMNS.map((c) => c.label);

/** Turn an export row (keyed by column key) into an ordered array of cell values. */
export function shipmentRowToCells(row: Record<string, string | number>): (string | number)[] {
  return SHIPMENT_COLUMNS.map((c) => row[c.key] ?? '');
}

/** Map arbitrary sheet headers to known column keys (case-insensitive, by label or key). */
export function mapShipmentHeaders(headers: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const h of headers) {
    const lower = h.trim().toLowerCase();
    const col = SHIPMENT_COLUMNS.find((c) => c.label.toLowerCase() === lower || c.key.toLowerCase() === lower);
    if (col) map[h] = col.key;
  }
  return map;
}
