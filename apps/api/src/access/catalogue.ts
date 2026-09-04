/**
 * What a person can be given access to.
 *
 * The catalogue lives in code rather than the database on purpose: it has to be versioned with the
 * guards that read it. A permission key stored in a row can outlive the route it once protected,
 * and nothing would fail — the grant would simply stop meaning anything, which is the failure mode
 * this whole exercise exists to end.
 *
 * Two kinds of grant, because they answer different questions:
 *
 *   AREAS ask "what part of the platform may this person work in", and are graded — no access,
 *   read, or change.
 *
 *   CAPABILITIES ask "may this person do the dangerous thing", and are simply on or off. They are
 *   kept out of the grades because they do not follow from being an editor. Someone who books
 *   goods in all day has every reason to edit stock and no reason at all to push prices to a live
 *   marketplace, and folding the second into the first is how an ordinary edit right turns into an
 *   outage. On 4 August a bad push emptied roughly 5,000 listings; that action now has a switch of
 *   its own that nobody holds by default.
 */

export const ACCESS_LEVELS = ['none', 'view', 'edit'] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

/** Ordered, so `edit` satisfies a requirement of `view` without anyone writing that rule twice. */
const LEVEL_RANK: Record<AccessLevel, number> = { none: 0, view: 1, edit: 2 };
export const meetsLevel = (held: AccessLevel, required: AccessLevel) => LEVEL_RANK[held] >= LEVEL_RANK[required];

export interface AreaDef {
  key: string;
  label: string;
  /** Nav group, so the Access page reads in the same order as the sidebar. */
  group: string;
  /** Shown under the area name. Says what is inside it, and why it is one unit. */
  description: string;
}

/**
 * The 15 areas.
 *
 * Where several screens are named by one area, splitting them would produce a grant nobody could
 * act on — someone who may adjust stock but not see the warehouse it sits in, or edit a product
 * without knowing whether it is sellable. Those bundles are stated in each description so the
 * reasoning survives the next person who wonders why Warehouses has no switch of its own.
 */
export const AREAS: AreaDef[] = [
  {
    key: 'sales_transactions',
    label: 'Sales transactions',
    group: 'Sales',
    description: 'Orders, resolutions, returns and refunds.',
  },
  {
    key: 'shipments',
    label: 'Shipments & fulfilment',
    group: 'Sales',
    description:
      'Outbound and pending fulfilment, dispatched elsewhere, and FBA shipments with their costs. One area: recording a shipment changes its order’s fulfilment status, and an FBA shipment’s cost feeds the profit on every order fulfilled from it.',
  },
  {
    key: 'products',
    label: 'Products & catalogue',
    group: 'Catalogue & inventory',
    description:
      'Product cards, taxonomy, documents, compliance and availability. Availability is derived from products, so separating them would leave someone able to edit a product without seeing whether it can be sold.',
  },
  {
    key: 'inventory',
    label: 'Inventory & warehouses',
    group: 'Catalogue & inventory',
    description:
      'Stock on hand, transfers, manual adjustments, serial numbers, stock owed — and the warehouses themselves. Inseparable: an adjustment needs a warehouse, a serial is a unit of stock, and a transfer is two adjustments.',
  },
  {
    key: 'purchasing',
    label: 'Procurement & purchase orders',
    group: 'Purchasing',
    description: 'What we decide to buy, and the orders raised for it.',
  },
  {
    key: 'receiving',
    label: 'Receiving & vendor returns',
    group: 'Purchasing',
    description:
      'Goods receipts and returns to vendor. Both move stock and both move average cost. Deliberately separate from purchase orders: ordering and receiving are done by different people, and that is a boundary worth having.',
  },
  {
    key: 'pricing',
    label: 'Pricing',
    group: 'Pricing & channels',
    description: 'Individual and bulk pricing, and profit tiers — one engine behind two screens.',
  },
  {
    key: 'channel_listings',
    label: 'Channel listings',
    group: 'Pricing & channels',
    description: 'What is listed on which marketplace. Publishing itself is a separate capability.',
  },
  {
    key: 'repricing',
    label: 'Amazon repricing',
    group: 'Pricing & channels',
    description: 'Strategies, floors and the decision log. Its own area because it sets prices on a live marketplace.',
  },
  {
    key: 'expenses',
    label: 'Expenses',
    group: 'Money',
    description: 'Expenses with their names, tags and categories — the last three are only reference data for the first.',
  },
  {
    key: 'analytics',
    label: 'Analytics',
    group: 'Money',
    description:
      'Sales, profitability, products, countries and returns. Read-only by nature; the figures it shows are governed by the cost & profit capability.',
  },
  {
    key: 'integrations',
    label: 'Integrations',
    group: 'Setup',
    description: 'Marketplace connections and syncing. Credentials are a separate capability.',
  },
  {
    key: 'global_settings',
    label: 'Global settings',
    group: 'Setup',
    description: 'Countries, VAT classes, shipping services, sales channels, attributes and the rest of the reference data.',
  },
  {
    key: 'activity',
    label: 'Activity log',
    group: 'Setup',
    description: 'Who changed what, and when.',
  },
  {
    key: 'administration',
    label: 'Administration',
    group: 'Setup',
    description:
      'Users, roles, companies, and modules & sharing. Grants the ability to change other people’s access, so it is worth holding to a shorter list than the rest.',
  },
];

export interface CapabilityDef {
  key: string;
  label: string;
  description: string;
  /** Shown in the UI as a warning rather than a hint. */
  dangerous?: boolean;
}

export const CAPABILITIES: CapabilityDef[] = [
  {
    key: 'cost_profit',
    label: 'See cost & profit',
    description:
      'Purchase costs, margins, profitability analytics and repricing floors. Without it the same screens still work, with the money columns hidden — someone counting stock needs the quantity, not the markup.',
  },
  {
    key: 'marketplace_write',
    label: 'Write to marketplaces',
    description:
      'Publish and withdraw listings, push prices and stock, and let the repricer write live. This is the action that emptied roughly 5,000 listings on 4 August; it does not follow from being able to edit a listing, so it is not bundled with one.',
    dangerous: true,
  },
  {
    key: 'bulk_import',
    label: 'Bulk import & mass update',
    description:
      'Every spreadsheet import, bulk pricing apply and mass recalculation. One file can change thousands of rows, which is a different risk from editing a record at a time.',
    dangerous: true,
  },
  {
    key: 'delete_records',
    label: 'Delete & void',
    description: 'Removing orders, products, shipments and the like. Editing a record and erasing it are different decisions.',
    dangerous: true,
  },
  {
    key: 'unlock_transactions',
    label: 'Unlock locked sales transactions',
    description: 'Reopen an order that has been locked against editing.',
  },
  {
    key: 'manage_credentials',
    label: 'Manage integration credentials',
    description: 'Enter or replace marketplace keys and tokens. Separate from using an integration that is already connected.',
    dangerous: true,
  },
];

export const AREA_KEYS = AREAS.map((a) => a.key);
export const CAPABILITY_KEYS = CAPABILITIES.map((c) => c.key);

export const isAreaKey = (k: string): boolean => AREA_KEYS.includes(k);
export const isCapabilityKey = (k: string): boolean => CAPABILITY_KEYS.includes(k);
export const isAccessLevel = (v: unknown): v is AccessLevel => ACCESS_LEVELS.includes(v as AccessLevel);

/** Areas in sidebar order, grouped, for rendering the Access page. */
export function areasByGroup(): { group: string; areas: AreaDef[] }[] {
  const out: { group: string; areas: AreaDef[] }[] = [];
  for (const area of AREAS) {
    const cur = out.find((g) => g.group === area.group);
    if (cur) cur.areas.push(area);
    else out.push({ group: area.group, areas: [area] });
  }
  return out;
}

// ---------------------------------------------------------------- grant shapes

/** What a role holds, and what a user's overrides may say. Sparse: an absent key means "not set". */
export interface GrantSet {
  areas: Partial<Record<string, AccessLevel>>;
  /** Explicitly true or false, so an override can revoke as well as grant. */
  capabilities: Partial<Record<string, boolean>>;
}

export const EMPTY_GRANTS: GrantSet = { areas: {}, capabilities: {} };

/**
 * Everything resolved, with no gaps.
 *
 * The resolver fills every area and capability, so a caller never has to decide what an absent key
 * means. That question is answered once, here, and the answer is "no".
 */
export interface EffectiveAccess {
  areas: Record<string, AccessLevel>;
  capabilities: Record<string, boolean>;
  isAdmin: boolean;
}
