/**
 * Connector definitions drive the dynamic "add integration" form. Each channel
 * declares its fields; the frontend renders them and marks secret fields as
 * write-only. Adding a channel (Amazon, eBay) = adding a definition here — no
 * schema or storage changes.
 */

export interface ConnectorField {
  key: string;
  label: string;
  type: 'text' | 'url' | 'textarea';
  secret: boolean; // encrypted at rest + write-only
  required: boolean;
  group?: string; // visual grouping in the form
  placeholder?: string;
  help?: string;
}

export interface ConnectorDef {
  type: string;
  label: string;
  description: string;
  /** Whether "Test connection" can run for this connector. */
  testable: boolean;
  fields: ConnectorField[];
}

const ONBUY: ConnectorDef = {
  type: 'onbuy',
  label: 'OnBuy UK',
  description: 'OnBuy marketplace API — retrieves sales and inventory data.',
  testable: true,
  fields: [
    { key: 'url', label: 'API URL', type: 'url', secret: false, required: true, group: 'Connection', placeholder: 'https://api.onbuy.com/v2' },
    { key: 'sellerId', label: 'Seller ID', type: 'text', secret: false, required: true, group: 'Connection' },
    { key: 'sellerEntityId', label: 'Seller Entity ID', type: 'text', secret: false, required: true, group: 'Connection' },
    { key: 'siteIds', label: 'Site IDs', type: 'text', secret: false, required: false, group: 'Connection', help: 'Comma-separated if more than one.' },
    { key: 'liveConsumerKey', label: 'Consumer Key', type: 'text', secret: true, required: false, group: 'Live keys' },
    { key: 'liveSecretKey', label: 'Secret Key', type: 'text', secret: true, required: false, group: 'Live keys' },
    { key: 'testConsumerKey', label: 'Consumer Key', type: 'text', secret: true, required: false, group: 'Test keys' },
    { key: 'testSecretKey', label: 'Secret Key', type: 'text', secret: true, required: false, group: 'Test keys' },
  ],
};

const CONNECTORS: ConnectorDef[] = [ONBUY];

export const listConnectors = (): ConnectorDef[] => CONNECTORS;
export const getConnector = (type: string): ConnectorDef | undefined => CONNECTORS.find((c) => c.type === type);
export const configFieldKeys = (c: ConnectorDef): string[] => c.fields.filter((f) => !f.secret).map((f) => f.key);
export const secretFieldKeys = (c: ConnectorDef): string[] => c.fields.filter((f) => f.secret).map((f) => f.key);
