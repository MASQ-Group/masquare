import type { GrantSet } from './catalogue';

/**
 * The roles the platform ships with.
 *
 * Starting points, not a straitjacket: a role is assigned and then narrowed or widened per person
 * on their own Access tab. They exist because setting fifteen areas and six capabilities by hand
 * for every new person is how access ends up copied from whoever was hired last, drift included.
 *
 * Each one is written to the job rather than to the org chart. The test is not "is this person
 * senior" but "does this work require it" — which is why Warehouse edits stock but cannot see
 * margins, and why no role except Operations may write to a marketplace.
 */

export interface DefaultRole {
  key: string;
  name: string;
  description: string;
  grants: GrantSet;
}

export const DEFAULT_ROLES: DefaultRole[] = [
  {
    key: 'operations',
    name: 'Operations',
    description:
      'Runs the day to day across sales, stock and channels. The broadest role short of platform admin — it cannot change other people’s access.',
    grants: {
      areas: {
        sales_transactions: 'edit',
        shipments: 'edit',
        products: 'edit',
        inventory: 'edit',
        purchasing: 'edit',
        receiving: 'edit',
        pricing: 'edit',
        channel_listings: 'edit',
        repricing: 'edit',
        expenses: 'view',
        analytics: 'view',
        integrations: 'view',
        global_settings: 'edit',
        activity: 'view',
        administration: 'none',
      },
      capabilities: {
        marketplace_write: true,
        bulk_import: true,
        delete_records: true,
        trigger_sync: true,
        unlock_transactions: true,
        manage_credentials: false,
      },
    },
  },
  {
    key: 'warehouse',
    name: 'Warehouse',
    description:
      'Books goods in, moves and counts stock, and despatches orders. Sees what to pick and where it goes — not what it cost or what it earns.',
    grants: {
      areas: {
        sales_transactions: 'view',
        shipments: 'edit',
        products: 'view',
        inventory: 'edit',
        purchasing: 'view',
        receiving: 'edit',
        pricing: 'none',
        channel_listings: 'none',
        repricing: 'none',
        expenses: 'none',
        analytics: 'none',
        integrations: 'none',
        global_settings: 'none',
        activity: 'none',
        administration: 'none',
      },
      capabilities: {
        // Stock and shipment sheets are a normal part of the job, so the import switch is on.
        bulk_import: true,
        // Deliberately off: this role has every reason to move stock and none to erase it or push
        // it to a marketplace.
        marketplace_write: false,
        delete_records: false,
        trigger_sync: false,
        unlock_transactions: false,
        manage_credentials: false,
      },
    },
  },
  {
    key: 'buyer',
    name: 'Buyer',
    description: 'Decides what to order and at what cost. Needs to see stock and margins; does not need to move either.',
    grants: {
      areas: {
        sales_transactions: 'view',
        shipments: 'none',
        products: 'edit',
        inventory: 'view',
        purchasing: 'edit',
        receiving: 'view',
        pricing: 'edit',
        channel_listings: 'view',
        repricing: 'view',
        expenses: 'none',
        analytics: 'view',
        integrations: 'none',
        global_settings: 'view',
        activity: 'none',
        administration: 'none',
      },
      capabilities: {
        bulk_import: true,
        marketplace_write: false,
        delete_records: false,
        trigger_sync: false,
        unlock_transactions: false,
        manage_credentials: false,
      },
    },
  },
  {
    key: 'finance',
    name: 'Finance',
    description:
      'Owns the money side: expenses, VAT, profitability and the record of what happened. Reads the operational areas rather than working in them.',
    grants: {
      areas: {
        sales_transactions: 'edit',
        shipments: 'view',
        products: 'view',
        inventory: 'view',
        purchasing: 'view',
        receiving: 'view',
        pricing: 'view',
        channel_listings: 'none',
        repricing: 'none',
        expenses: 'edit',
        analytics: 'view',
        integrations: 'none',
        global_settings: 'view',
        activity: 'view',
        administration: 'none',
      },
      capabilities: {
        // A correction to a settled order is exactly this role's work.
        unlock_transactions: true,
        bulk_import: true,
        marketplace_write: false,
        delete_records: false,
        trigger_sync: false,
        manage_credentials: false,
      },
    },
  },
  {
    key: 'sync_operator',
    name: 'Sync operator',
    description:
      'Fetches orders from the marketplaces on demand, and nothing else. Sees the connections and can run a sync; cannot schedule one, edit or remove a connection, pull older orders, preview listings or touch mapping.',
    grants: {
      areas: {
        sales_transactions: 'view',
        shipments: 'view',
        products: 'none',
        inventory: 'none',
        purchasing: 'none',
        receiving: 'none',
        pricing: 'none',
        channel_listings: 'none',
        repricing: 'none',
        expenses: 'none',
        analytics: 'none',
        // View, not Edit. Edit is what unlocks scheduling, auto-sync, editing and removing a
        // connection, mapping and listing previews — everything this role must not reach. The one
        // action it does need comes from the capability below instead.
        integrations: 'view',
        global_settings: 'none',
        activity: 'none',
        administration: 'none',
      },
      capabilities: {
        trigger_sync: true,
        marketplace_write: false,
        bulk_import: false,
        delete_records: false,
        unlock_transactions: false,
        manage_credentials: false,
      },
    },
  },
  {
    key: 'read_only',
    name: 'Read only',
    description: 'Sees everything operational and changes nothing. For someone being shown the platform, or covering a handover.',
    grants: {
      areas: {
        sales_transactions: 'view',
        shipments: 'view',
        products: 'view',
        inventory: 'view',
        purchasing: 'view',
        receiving: 'view',
        pricing: 'view',
        channel_listings: 'view',
        repricing: 'view',
        expenses: 'view',
        analytics: 'view',
        integrations: 'none',
        global_settings: 'view',
        activity: 'view',
        administration: 'none',
      },
      capabilities: {
        // Read-only means read-only: no bulk anything and nothing that leaves our database.
        marketplace_write: false,
        bulk_import: false,
        delete_records: false,
        trigger_sync: false,
        unlock_transactions: false,
        manage_credentials: false,
      },
    },
  },
];

export const DEFAULT_ROLE_KEYS = DEFAULT_ROLES.map((r) => r.key);
