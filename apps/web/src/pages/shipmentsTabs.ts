/**
 * The tabs on the Shipments page — the one list, in display order.
 *
 * There used to be three lists: the union type, the guard that validates the remembered tab, and
 * the array the header renders. Adding the two customer queues updated the type and the header and
 * missed the guard, so clicking either one stored the choice, failed the guard and fell straight
 * back to Pending. The tabs looked dead, and nothing in the code looked wrong.
 *
 * Now the type is derived from this array and the guard reads it, so the three cannot disagree. A
 * new tab is one entry here; leaving it out of the counts below is a type error rather than a tab
 * that quietly does nothing.
 *
 * PURE.
 */

export const SHIPMENT_TABS = [
  { key: 'pending', label: 'Pending fulfilment', attention: true },
  { key: 'dispatched', label: 'Dispatched elsewhere' },
  { key: 'fba', label: 'FBA shipments', attention: true },
  // The queue that replaces the shared spreadsheet, with the badge that replaces its notification:
  // what a customer has filed and nobody has acted on yet.
  { key: 'customer-pending', label: 'Customer shipments', attention: true },
  { key: 'customer-fulfilled', label: 'Customer fulfilled' },
  { key: 'all', label: 'All shipments' },
] as const;

export type ShipmentTab = (typeof SHIPMENT_TABS)[number]['key'];

/** Whether this tab shows customer shipments rather than our own orders. */
export const isCustomerTab = (tab: ShipmentTab): boolean => tab === 'customer-pending' || tab === 'customer-fulfilled';

/**
 * The tab to show, given whatever was remembered from last time.
 *
 * Anything unrecognised falls back: 'despatched' was persisted by an earlier build under the old
 * spelling, and restoring a key no branch matches renders an empty page with no tab selected.
 */
export function resolveTab(stored: string | null | undefined): ShipmentTab {
  return SHIPMENT_TABS.some((t) => t.key === stored) ? (stored as ShipmentTab) : 'pending';
}
