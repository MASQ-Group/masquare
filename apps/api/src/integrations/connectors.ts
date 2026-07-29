/**
 * Connector definitions drive the dynamic "add integration" form.
 *
 * Each channel family (Amazon, eBay, OnBuy) declares:
 *  - `marketplaces`: the sub-channels a user can create an integration for
 *    (e.g. Amazon UK, Amazon DE). Each sub-channel is its own integration with
 *    its own credentials.
 *  - `fields`: the API fields required for that family. Secret fields are
 *    encrypted at rest and write-only.
 */

export interface ConnectorField {
  key: string;
  label: string;
  type: 'text' | 'url' | 'textarea' | 'select';
  secret: boolean;
  required: boolean;
  group?: string;
  placeholder?: string;
  help?: string;
  options?: { value: string; label: string }[]; // for type 'select'
}

export interface ConnectorMarketplace {
  id: string; // stored on the integration, e.g. 'UK'
  label: string; // e.g. 'Amazon UK'
  meta?: Record<string, string>; // region/endpoint/marketplaceId used by sync + test
}

export interface ConnectorDef {
  type: string; // 'amazon' | 'ebay' | 'onbuy'
  label: string;
  description: string;
  testable: boolean;
  marketplaces: ConnectorMarketplace[];
  fields: ConnectorField[];
}

// --- Amazon (Selling Partner API, LWA auth) -------------------------------
const AMZ_EU = 'https://sellingpartnerapi-eu.amazon.com';
const AMZ_NA = 'https://sellingpartnerapi-na.amazon.com';
const AMZ_FE = 'https://sellingpartnerapi-fe.amazon.com';
const amzMkt = (id: string, label: string, region: string, endpoint: string, marketplaceId: string): ConnectorMarketplace =>
  ({ id, label, meta: { region, endpoint, marketplaceId } });

const AMAZON: ConnectorDef = {
  type: 'amazon',
  label: 'Amazon',
  description: 'Amazon Selling Partner API (SP-API) — sales and inventory. One integration per marketplace.',
  testable: true,
  marketplaces: [
    // North America region (endpoint: sellingpartnerapi-na.amazon.com)
    amzMkt('US', 'Amazon US', 'na', AMZ_NA, 'ATVPDKIKX0DER'),
    amzMkt('CA', 'Amazon CA', 'na', AMZ_NA, 'A2EUQ1WTGCTBG2'),
    amzMkt('MX', 'Amazon MX', 'na', AMZ_NA, 'A1AM78C64UM0Y8'),
    amzMkt('BR', 'Amazon BR', 'na', AMZ_NA, 'A2Q3Y263D00KWC'),
    // Europe region (endpoint: sellingpartnerapi-eu.amazon.com)
    amzMkt('UK', 'Amazon UK', 'eu', AMZ_EU, 'A1F83G8C2ARO7P'),
    amzMkt('IE', 'Amazon IE', 'eu', AMZ_EU, 'A28R8C7NBKEWEA'),
    amzMkt('DE', 'Amazon DE', 'eu', AMZ_EU, 'A1PA6795UKMFR9'),
    amzMkt('FR', 'Amazon FR', 'eu', AMZ_EU, 'A13V1IB3VIYZZH'),
    amzMkt('IT', 'Amazon IT', 'eu', AMZ_EU, 'APJ6JRA9NG5V4'),
    amzMkt('ES', 'Amazon ES', 'eu', AMZ_EU, 'A1RKKUPIHCS9HS'),
    amzMkt('NL', 'Amazon NL', 'eu', AMZ_EU, 'A1805IZSGTT6HS'),
    amzMkt('BE', 'Amazon BE', 'eu', AMZ_EU, 'AMEN7PMS3EDWL'),
    amzMkt('SE', 'Amazon SE', 'eu', AMZ_EU, 'A2NODRKZP88ZB9'),
    amzMkt('PL', 'Amazon PL', 'eu', AMZ_EU, 'A1C3SOZRARQ6R3'),
    amzMkt('TR', 'Amazon TR', 'eu', AMZ_EU, 'A33AVAJ2PDY3EV'),
    amzMkt('EG', 'Amazon EG', 'eu', AMZ_EU, 'ARBP9OOSHTCHU'),
    amzMkt('SA', 'Amazon SA', 'eu', AMZ_EU, 'A17E79C6D8DWNP'),
    amzMkt('AE', 'Amazon AE (UAE)', 'eu', AMZ_EU, 'A2VIGQ35RCS4UG'),
    amzMkt('IN', 'Amazon IN', 'eu', AMZ_EU, 'A21TJRUUN4KGV'),
    amzMkt('ZA', 'Amazon ZA', 'eu', AMZ_EU, 'AE08WJ6YKNBMC'),
    // Far East region (endpoint: sellingpartnerapi-fe.amazon.com)
    amzMkt('JP', 'Amazon JP', 'fe', AMZ_FE, 'A1VC38T7YXB528'),
    amzMkt('AU', 'Amazon AU', 'fe', AMZ_FE, 'A39IBJ37TRP1C6'),
    amzMkt('SG', 'Amazon SG', 'fe', AMZ_FE, 'A19VAU5U5O7RUS'),
  ],
  fields: [
    { key: 'appId', label: 'Application ID', type: 'text', secret: false, required: false, group: 'Application', placeholder: 'amzn1.sp.solution.…', help: 'Your SP-API app ID from Developer Central. The same value for every Amazon marketplace.' },
    { key: 'lwaClientId', label: 'LWA Client ID (Client identifier)', type: 'text', secret: false, required: true, group: 'Application', placeholder: 'amzn1.application-oa2-client.…', help: 'App-level — the same value for every Amazon integration.' },
    { key: 'sellerId', label: 'Seller ID (Merchant token)', type: 'text', secret: false, required: false, group: 'Application' },
    { key: 'lwaClientSecret', label: 'LWA Client Secret', type: 'text', secret: true, required: false, group: 'LWA credentials', help: 'App-level — the same value for every Amazon integration.' },
    { key: 'refreshToken', label: 'Refresh Token', type: 'text', secret: true, required: false, group: 'LWA credentials', help: 'From one authorization. It covers every marketplace in that authorization — e.g. one North-America token for US, CA & MX; a separate token for UAE. Use the same token on each marketplace that authorization covers.' },
  ],
};

// --- eBay (Sell APIs, OAuth) ----------------------------------------------
const ebayMkt = (id: string, label: string, marketplaceId: string): ConnectorMarketplace => ({ id, label, meta: { marketplaceId } });

const EBAY: ConnectorDef = {
  type: 'ebay',
  label: 'eBay',
  description: 'eBay Sell APIs (OAuth) — sales and inventory. One integration per marketplace.',
  testable: true,
  marketplaces: [
    ebayMkt('GB', 'eBay UK', 'EBAY_GB'),
    ebayMkt('DE', 'eBay DE', 'EBAY_DE'),
    ebayMkt('FR', 'eBay FR', 'EBAY_FR'),
    ebayMkt('IT', 'eBay IT', 'EBAY_IT'),
    ebayMkt('ES', 'eBay ES', 'EBAY_ES'),
    ebayMkt('IE', 'eBay IE', 'EBAY_IE'),
    ebayMkt('US', 'eBay US', 'EBAY_US'),
    ebayMkt('AU', 'eBay AU', 'EBAY_AU'),
    ebayMkt('CA', 'eBay CA', 'EBAY_CA'),
  ],
  fields: [
    { key: 'env', label: 'Environment', type: 'select', secret: false, required: true, group: 'Application', options: [{ value: 'production', label: 'Production' }, { value: 'sandbox', label: 'Sandbox' }] },
    { key: 'appId', label: 'App ID (Client ID)', type: 'text', secret: false, required: true, group: 'Application' },
    { key: 'devId', label: 'Dev ID', type: 'text', secret: false, required: false, group: 'Application' },
    { key: 'ruName', label: 'Redirect URL name (RuName)', type: 'text', secret: false, required: false, group: 'Application' },
    { key: 'certId', label: 'Cert ID (Client Secret)', type: 'text', secret: true, required: false, group: 'OAuth credentials' },
    { key: 'refreshToken', label: 'OAuth Refresh Token', type: 'text', secret: true, required: false, group: 'OAuth credentials', help: 'User access token from the OAuth consent flow.' },
    { key: 'ebayWriteEnabled', label: 'Enable stock push (inventory write)', type: 'select', secret: false, required: false, group: 'OAuth credentials',
      options: [{ value: '', label: 'No — read-only' }, { value: 'true', label: 'Yes — allow quantity updates' }],
      help: 'Turn on only after supplying a Refresh Token granted with the sell.inventory scope. Otherwise leave off — the token stays read-only and pushes are skipped.' },
  ],
};

// --- OnBuy (v2 API) --------------------------------------------------------
const ONBUY: ConnectorDef = {
  type: 'onbuy',
  label: 'OnBuy',
  description: 'OnBuy marketplace API (v2) — sales and inventory.',
  testable: true,
  marketplaces: [{ id: 'UK', label: 'OnBuy UK', meta: { siteId: '2000' } }],
  fields: [
    { key: 'url', label: 'API URL', type: 'url', secret: false, required: true, group: 'Connection', placeholder: 'https://api.onbuy.com/v2/' },
    { key: 'sellerId', label: 'Seller ID', type: 'text', secret: false, required: true, group: 'Connection' },
    { key: 'sellerEntityId', label: 'Seller Entity ID', type: 'text', secret: false, required: true, group: 'Connection' },
    { key: 'siteIds', label: 'Site IDs', type: 'text', secret: false, required: false, group: 'Connection', help: 'Comma-separated if more than one.' },
    { key: 'liveConsumerKey', label: 'Consumer Key', type: 'text', secret: true, required: false, group: 'Live keys' },
    { key: 'liveSecretKey', label: 'Secret Key', type: 'text', secret: true, required: false, group: 'Live keys' },
    { key: 'testConsumerKey', label: 'Consumer Key', type: 'text', secret: true, required: false, group: 'Test keys' },
    { key: 'testSecretKey', label: 'Secret Key', type: 'text', secret: true, required: false, group: 'Test keys' },
  ],
};

const CONNECTORS: ConnectorDef[] = [AMAZON, EBAY, ONBUY];

export const listConnectors = (): ConnectorDef[] => CONNECTORS;
export const getConnector = (type: string): ConnectorDef | undefined => CONNECTORS.find((c) => c.type === type);
export const getMarketplace = (type: string, id?: string | null): ConnectorMarketplace | undefined =>
  id ? getConnector(type)?.marketplaces.find((m) => m.id === id) : undefined;
export const configFieldKeys = (c: ConnectorDef): string[] => c.fields.filter((f) => !f.secret).map((f) => f.key);
export const secretFieldKeys = (c: ConnectorDef): string[] => c.fields.filter((f) => f.secret).map((f) => f.key);
