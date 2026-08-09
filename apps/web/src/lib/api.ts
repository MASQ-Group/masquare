import axios from 'axios';

const TOKEN_KEY = 'masquare.token';
const ACTIVE_COMPANY_KEY = 'masquare.activeCompanyId';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  // Active company scope — the API enforces it against the user's grants (company isolation).
  const companyId = localStorage.getItem(ACTIVE_COMPANY_KEY);
  if (companyId) {
    config.headers = config.headers ?? {};
    config.headers['x-company-id'] = companyId;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err?.response?.status === 401 && !location.pathname.startsWith('/login')) {
      localStorage.removeItem(TOKEN_KEY);
      location.href = '/login';
    }
    return Promise.reject(err);
  },
);

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

// ---- Types ----
export interface CompanyRef {
  id: string;
  officialName: string;
  registrationNumber?: string | null;
  addressCountry?: string | null;
}
export interface ModuleRef {
  key: string;
  name: string;
  status?: string | null;
}
export interface Me {
  id: string;
  fullName: string;
  email: string;
  isAdmin: boolean;
  status: string;
  companies: CompanyRef[];
  modules: ModuleRef[];
}

export interface Company {
  id: string;
  officialName: string;
  registrationNumber?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  addressCity?: string | null;
  addressRegion?: string | null;
  addressPostalCode?: string | null;
  addressCountry?: string | null;
  email?: string | null;
  website?: string | null;
  phoneLandline?: string | null;
  phoneMobile?: string | null;
  vatRegistrations: { id: string; country: string; vatNumber: string }[];
  contactPersons: {
    id: string;
    name: string;
    surname?: string | null;
    email?: string | null;
    phone?: string | null;
    role?: string | null;
  }[];
}

export interface User {
  id: string;
  fullName: string;
  email: string;
  isAdmin: boolean;
  status: 'active' | 'disabled';
  companyIds: string[];
  moduleIds: string[];
}

export interface ModuleCatalogItem {
  id: string;
  key: string;
  name: string;
  status?: string | null;
  isCore: boolean;
  shareable: boolean;
  enabledCompanyIds: string[];
  sharedCompanyIds: string[];
}

// ---- Endpoints ----
export const authApi = {
  login: (email: string, password: string) =>
    api.post<{ accessToken: string; user: Me }>('/auth/login', { email, password }).then((r) => r.data),
  me: () => api.get<Me>('/auth/me').then((r) => r.data),
};

export const companiesApi = {
  list: () => api.get<Company[]>('/companies').then((r) => r.data),
  get: (id: string) => api.get<Company>(`/companies/${id}`).then((r) => r.data),
  create: (body: Partial<Company>) => api.post<Company>('/companies', body).then((r) => r.data),
  update: (id: string, body: Partial<Company>) =>
    api.patch<Company>(`/companies/${id}`, body).then((r) => r.data),
  remove: (id: string) => api.delete(`/companies/${id}`).then((r) => r.data),
};

export const usersApi = {
  list: () => api.get<User[]>('/users').then((r) => r.data),
  create: (body: Partial<User> & { password?: string }) =>
    api.post<User>('/users', body).then((r) => r.data),
  update: (id: string, body: Partial<User> & { password?: string }) =>
    api.patch<User>(`/users/${id}`, body).then((r) => r.data),
  remove: (id: string) => api.delete(`/users/${id}`).then((r) => r.data),
};

export const modulesApi = {
  list: () => api.get<ModuleCatalogItem[]>('/modules').then((r) => r.data),
  setParticipants: (key: string, companyIds: string[]) =>
    api.put<ModuleCatalogItem[]>(`/modules/${key}/participants`, { companyIds }).then((r) => r.data),
};

// ---- Module 2: Global Settings ----
export interface VendorContact {
  id?: string;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  contactType?: 'person' | 'department' | null;
  contactRole?: string | null;
}
export type VendorVatTreatment = 'standard' | 'reverse_charge' | 'outside_scope';
/** How an ancillary cost is spread over the received lines. */
export type AllocationMethod = 'weight' | 'volumetric' | 'quantity' | 'value';
export const ALLOCATION_LABELS: Record<AllocationMethod, string> = {
  weight: 'Actual weight',
  volumetric: 'Volumetric weight',
  quantity: 'Quantity',
  value: 'Value',
};
export interface Vendor {
  id: string;
  name: string;
  vatNumber?: string | null;
  /** Decides whether this vendor's purchase orders carry VAT. */
  vatTreatment?: VendorVatTreatment;
  /** Currency this vendor invoices in — new POs default to it. */
  currency?: string;
  vatNumberValid?: boolean | null;
  vatNumberCheckedAt?: string | null;
  vatNumberCheckedName?: string | null;
  addressLine1?: string | null;
  addressCity?: string | null;
  addressCountry?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  contacts: VendorContact[];
}
export interface Brand { id: string; name: string; website?: string | null }
export interface ProductType { id: string; name: string }
export interface FulfilmentType { id: string; name: string; code?: string | null; active: boolean }
export interface Category { id: string; name: string; parentId: string | null; sortOrder: number }
export interface AttributeValue { id: string; value: string }
export interface Attribute {
  id: string;
  name: string;
  inputType: 'predefined' | 'free_text';
  allowMultiple: boolean;
  values: AttributeValue[];
}
export interface PlatformSettings {
  id: string;
  measurementSystem: 'metric' | 'imperial';
  dateFormat: 'ddmmyyyy' | 'mmddyyyy' | 'yyyymmdd';
  salesTxStandardColumns: string[] | null;
  bodyFont: string;
  monoFont: string;
  deductStockOnSale: boolean;
  applyChannelResolutions: boolean;
  autoAdjustAvailabilityOnSale: boolean;
}
export type VatTaxTreatment = 'standard' | 'reduced' | 'zero' | 'exempt';
export interface VatClass {
  id: string;
  name: string;
  ratePct: number;
  /** Zero-rated and Exempt are both 0% but stay distinct on a VAT return. */
  taxTreatment: VatTaxTreatment;
  sortOrder: number;
  isDefault: boolean;
}
export type VatClassLite = Pick<VatClass, 'id' | 'name' | 'ratePct' | 'taxTreatment'>;
export interface ProductClass {
  id: string;
  name: string;
  sortOrder: number;
  isDefault: boolean;
}

const crud = <T,>(path: string) => ({
  list: (q?: string) => api.get<T[]>(path, { params: q ? { q } : undefined }).then((r) => r.data),
  create: (body: Partial<T>) => api.post<T>(path, body).then((r) => r.data),
  update: (id: string, body: Partial<T>) => api.patch<T>(`${path}/${id}`, body).then((r) => r.data),
  remove: (id: string) => api.delete(`${path}/${id}`).then((r) => r.data),
});

export const vendorsApi = {
  ...crud<Vendor>('/vendors'),
  get: (id: string) => api.get<Vendor>(`/vendors/${id}`).then((r) => r.data),
  /** Advisory EU VIES check — never blocks saving. */
  verifyVat: (id: string) =>
    api
      .post<{ valid: boolean | null; name?: string | null; checkedAt: string; message: string }>(`/vendors/${id}/verify-vat`, {})
      .then((r) => r.data),
};
export const brandsApi = crud<Brand>('/brands');
export const productTypesApi = crud<ProductType>('/product-types');

// ---- Channel listings (what's live on each marketplace) ----
export interface ChannelListingChannel {
  id: string; name: string; marketplace: string | null; channelType: string;
  salesChannelId: string | null; countryIso: string | null;
  currency: string | null; color: string; listingCount: number; lastPulledAt: string | null;
}
export interface ChannelListingCell {
  integrationId: string; channelSku: string; asin: string | null; listed: boolean;
  price: number | null; currency: string | null; quantity: number | null; fulfilmentChannel: string | null; status: string;
  profitEur: number | null; marginPct: number | null; loss: boolean;
}
export interface ChannelListingRow {
  productId: string; sku: string; title: string; brand: string | null;
  masterStock: number | null; listedCount: number; cells: Record<string, ChannelListingCell>;
}
export interface ChannelListingsDashboard { items: ChannelListingRow[]; total: number; page: number; pageSize: number }
export interface ChannelListingDetailChannel {
  integrationId: string; name: string; color: string; currency: string | null; countryIso: string | null; listed: boolean;
  price: number | null; priceCurrency: string | null; quantity: number | null; fulfilmentChannel: string | null; status: string | null;
  profitEur: number | null; marginPct: number | null; loss: boolean; lastPulledAt: string | null;
}
export interface ChannelListingDetail {
  productId: string; sku: string; title: string; brand: string | null;
  masterStock: number | null; listedCount: number; channelCount: number; unitsLive: number; lastSyncedAt: string | null;
  channels: ChannelListingDetailChannel[];
}
export interface ChannelSyncResult { channels: { integrationId: string; name: string; ok: boolean; pulled?: number; message?: string }[]; total: number }
export interface ChannelPushRow { productId: string; channelKey: string; channel: string; channelType: string; marketplace: string; countryIso: string; channelSku: string; currentQty: number | null; targetQty: number; ok: boolean; message: string }
export interface ChannelPushResult { dryRun: boolean; count: number; ok: number; failed: number; results: ChannelPushRow[] }
export interface ChannelIdentifier { channelType: string; channelName: string; marketplace: string | null; countryIso: string | null; channelSku: string; identifierType: string; identifier: string | null }

export const channelListingsApi = {
  channels: () => api.get<ChannelListingChannel[]>('/channel-listings/channels').then((r) => r.data),
  dashboard: (params: { q?: string; channelId?: string; brandId?: string; vendorId?: string; productTypeId?: string; page?: number; pageSize?: number } = {}) =>
    api.get<ChannelListingsDashboard>('/channel-listings', { params }).then((r) => r.data),
  sync: (integrationIds?: string[]) =>
    api.post<ChannelSyncResult>('/channel-listings/sync', integrationIds?.length ? { integrationIds } : {}).then((r) => r.data),
  detail: (productId: string) => api.get<ChannelListingDetail>(`/channel-listings/product/${productId}`).then((r) => r.data),
  identifiers: (productId: string) => api.get<ChannelIdentifier[]>(`/channel-listings/product/${productId}/identifiers`).then((r) => r.data),
  push: (productIds: string[], dryRun: boolean, channels?: string[]) =>
    api.post<ChannelPushResult>('/channel-listings/push', { productIds, dryRun, ...(channels && channels.length ? { channels } : {}) }).then((r) => r.data),
};

// ---- Channel availability (sellable quantity broadcast to sales channels) ----
export interface AvailabilityRow {
  productId: string; mainSku: string; title: string;
  brand: string | null; vendor: string | null; productType: string | null;
  quantity: number | null; lastSource: string | null; updatedAt: string | null;
}
export interface AvailabilityLedgerRow {
  id: string; delta: number; newQuantity: number; reason: string; note: string | null; refType: string | null; createdAt: string;
}
export interface AvailabilityListResponse { items: AvailabilityRow[]; total: number; page: number; pageSize: number }
export const availabilityApi = {
  list: (params: { q?: string; brandId?: string; vendorId?: string; productTypeId?: string; unset?: boolean; page?: number; pageSize?: number } = {}) =>
    api.get<AvailabilityListResponse>('/availability', { params }).then((r) => r.data),
  // Every product id matching the filter — backs "select all N across pages".
  ids: (params: { q?: string; brandId?: string; vendorId?: string; productTypeId?: string; unset?: boolean } = {}) =>
    api.get<string[]>('/availability/ids', { params }).then((r) => r.data),
  get: (productId: string) =>
    api.get<AvailabilityRow & { ledger: AvailabilityLedgerRow[] }>(`/availability/${productId}`).then((r) => r.data),
  setQuantity: (productId: string, quantity: number, note?: string) =>
    api.post<AvailabilityRow & { ledger: AvailabilityLedgerRow[] }>(`/availability/${productId}`, { quantity, note }).then((r) => r.data),
};
export const fulfilmentTypesApi = crud<FulfilmentType>('/fulfilment-types');
export const vatClassesApi = crud<VatClass>('/vat-classes');
export const productClassesApi = crud<ProductClass>('/product-classes');

export const categoriesApi = {
  list: () => api.get<Category[]>('/categories').then((r) => r.data),
  create: (body: { name: string; parentId?: string | null }) =>
    api.post<Category>('/categories', body).then((r) => r.data),
  update: (id: string, body: { name?: string }) =>
    api.patch<Category>(`/categories/${id}`, body).then((r) => r.data),
  move: (id: string, body: { parentId: string | null; sortOrder?: number }) =>
    api.put<Category>(`/categories/${id}/move`, body).then((r) => r.data),
  remove: (id: string) => api.delete(`/categories/${id}`).then((r) => r.data),
};

export const attributesApi = {
  list: (q?: string) => api.get<Attribute[]>('/attributes', { params: q ? { q } : undefined }).then((r) => r.data),
  create: (body: { name: string; inputType: 'predefined' | 'free_text'; values?: string[] }) =>
    api.post<Attribute>('/attributes', body).then((r) => r.data),
  update: (id: string, body: { name?: string; inputType?: 'predefined' | 'free_text'; values?: string[] }) =>
    api.patch<Attribute>(`/attributes/${id}`, body).then((r) => r.data),
  addValue: (id: string, value: string) =>
    api.post<AttributeValue>(`/attributes/${id}/values`, { value }).then((r) => r.data),
  remove: (id: string) => api.delete(`/attributes/${id}`).then((r) => r.data),
};

export const settingsApi = {
  get: () => api.get<PlatformSettings>('/settings').then((r) => r.data),
  update: (body: Partial<PlatformSettings>) => api.put<PlatformSettings>('/settings', body).then((r) => r.data),
};

// ---- Module 3: Products ----
export interface Money { amount: number | null; currency: string }
export interface RefLite { id: string; name: string; code?: string | null }
export interface ProductAlias {
  id?: string;
  skuValue: string;
  label?: string | null;
  fulfilmentTypeId?: string | null;
  fulfilmentType?: RefLite | null;
}
export interface ProductMediaItem { id: string; url: string; sortOrder: number }
export interface ProductAttr {
  id?: string;
  attributeId: string;
  value: string;
  attributeName?: string;
  inputType?: 'predefined' | 'free_text';
}
export interface Product {
  id: string;
  mainSku: string;
  title: string;
  brandId: string | null;
  vendorId: string | null;
  productTypeId: string | null;
  fulfilmentTypeId: string | null;
  categoryId: string | null;
  vatClassId: string | null;
  productClassId: string | null;
  brand: RefLite | null;
  vendor: RefLite | null;
  productType: RefLite | null;
  fulfilmentType: RefLite | null;
  category: RefLite | null;
  vatClass: VatClassLite | null;
  productClass: RefLite | null;
  ean: string | null;
  upc: string | null;
  vendorSku: string | null;
  manufacturerSku: string | null;
  countryOfOrigin: string | null;
  hsCode: string | null;
  purchaseCost: Money;
  /** Individual units tracked by serial number; enforced at receiving and at sale. */
  serialTracked: boolean;
  /** Moving weighted average landed cost, maintained by receiving. Read-only. */
  averageCostEur: number | null;
  averageCostQty: number;
  averageCostUpdatedAt: string | null;
  map: Money;
  msrp: Money;
  productWeightKg: number | null;
  packageWeightKg: number | null;
  packageLengthCm: number | null;
  packageWidthCm: number | null;
  packageHeightCm: number | null;
  volumetricWeightKg: number | null;
  aliases: ProductAlias[];
  media: ProductMediaItem[];
  attributes: ProductAttr[];
  companyIds: string[];
  aliasCount: number;
  featuredImage: string | null;
}
export interface ProductListResponse {
  items: Product[];
  total: number;
  page: number;
  pageSize: number;
}
export interface ProductListParams {
  q?: string;
  field?: string;
  vendorId?: string[];
  brandId?: string[];
  fulfilmentTypeId?: string[];
  productTypeId?: string[];
  categoryId?: string[];
  country?: string;
  page?: number;
  pageSize?: number;
}

export const productsApi = {
  list: (params: ProductListParams) =>
    api
      .get<ProductListResponse>('/products', {
        params,
        paramsSerializer: (p) => {
          const sp = new URLSearchParams();
          for (const [k, v] of Object.entries(p)) {
            if (v == null || v === '') continue;
            if (Array.isArray(v)) v.forEach((x) => sp.append(k, String(x)));
            else sp.append(k, String(v));
          }
          return sp.toString();
        },
      })
      .then((r) => r.data),
  get: (id: string) => api.get<Product>(`/products/${id}`).then((r) => r.data),
  create: (body: any) => api.post<Product>('/products', body).then((r) => r.data),
  update: (id: string, body: any) => api.patch<Product>(`/products/${id}`, body).then((r) => r.data),
  remove: (id: string) => api.delete(`/products/${id}`).then((r) => r.data),
  uploadMedia: (id: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post<Product>(`/products/${id}/media`, fd).then((r) => r.data);
  },
  deleteMedia: (id: string, mediaId: string) =>
    api.delete<Product>(`/products/${id}/media/${mediaId}`).then((r) => r.data),
  reorderMedia: (id: string, orderedIds: string[]) =>
    api.put<Product>(`/products/${id}/media/order`, { orderedIds }).then((r) => r.data),
  byIds: (ids: string[]) => api.post<Product[]>('/products/by-ids', { ids }).then((r) => r.data),
  ids: (params: Omit<ProductListParams, 'page' | 'pageSize'>) => api.get<string[]>('/products/ids', { params }).then((r) => r.data),
  bulkDelete: (ids: string[]) => api.post('/products/bulk/delete', { ids }).then((r) => r.data),
  bulkUpdate: (body: { ids: string[]; productTypeId?: string; categoryId?: string; fulfilmentTypeId?: string; brandId?: string; vendorId?: string; vatClassId?: string; productClassId?: string; attributes?: { attributeId: string; value: string }[] }) =>
    api.post('/products/bulk/update', body).then((r) => r.data),
  importValidate: (purpose: 'add' | 'edit', rows: Record<string, string>[]) =>
    api.post<{ rows: ImportRowResult[] }>('/products/import/validate', { purpose, rows }).then((r) => r.data),
  importCommit: (items: { row: Record<string, string>; action: 'add' | 'edit' | 'skip'; productId?: string }[]) =>
    api.post<{ created: number; updated: number; skipped: number; errors: { sku: string; message: string }[] }>('/products/import/commit', { items }).then((r) => r.data),
};

export interface ImportRowIssue { field: string; message: string; severity: 'error' | 'warning' }
export interface ImportRowResult {
  index: number;
  sku: string;
  title: string;
  status: 'new' | 'conflict' | 'match' | 'missing' | 'error';
  conflictOn: string[];
  existingProductId: string | null;
  existingSku: string | null;
  issues: ImportRowIssue[];
}

// ---- Global Data: Countries, Shipping Services, Sales Channels ----
export interface CountryZoneMapping { shippingServiceId: string; zoneId: string; zoneName: string | null }
export interface Country {
  id: string;
  name: string;
  isoCode: string;
  continent: string;
  euVatZone: boolean;
  vatRate: number;
  defaultShippingServiceId: string | null;
  defaultShippingService: { id: string; name: string } | null;
  shippingZones: CountryZoneMapping[];
}
export interface ShippingRate { id?: string; fromWeightKg: number; toWeightKg: number; chargeEur: number }
export interface ShippingZone {
  id?: string;
  name: string;
  countryIds: string[];
  countries?: { id: string; name: string; isoCode: string }[];
  rates?: ShippingRate[];
}
export interface ShippingService {
  id: string;
  name: string;
  alias: string | null;
  trackingUrlTemplate: string | null;
  calcMethod: 'actual_weight' | 'volumetric_weight';
  zones: ShippingZone[];
}
export type SalesChannelKind = 'online' | 'local';
export interface SalesChannel {
  id: string;
  name: string;
  description: string | null;
  /** 'local' is our own direct/walk-in sales: EUR, FX 1, no fee, VAT charged by us.
   *  Structural — seeded, not editable through the API. */
  kind: SalesChannelKind;
  /** Show a transaction Total (net + VAT + buyer-paid shipping + its VAT) for this channel.
   *  Off for marketplaces by default, where the channel's own tax reporting makes a single
   *  total misleading; on for our local sales. */
  showTransactionTotal: boolean;
  /** Chip colours for the channel name; seeded from the native flag, editable in settings. */
  chipBgColor: string | null;
  chipTextColor: string | null;
  nativeCountryId: string | null;
  nativeCurrency: string | null;
  generalSalesFeePct: number | null;
  feeChargedInNativeCurrency: boolean;
  feeCurrency: string | null;
  vatThresholdEnabled: boolean;
  vatThresholdAmount: number | null;
  vatThresholdCurrency: string | null;
  vatBelowThresholdPct: number | null;
  vatAboveThresholdPct: number | null;
  email: string | null;
  website: string | null;
  contactName: string | null;
  nativeCountry: { id: string; name: string; isoCode: string } | null;
}

export const countriesApi = {
  list: (q?: string) => api.get<Country[]>('/countries', { params: q ? { q } : undefined }).then((r) => r.data),
  create: (body: Partial<Country>) => api.post<Country>('/countries', body).then((r) => r.data),
  update: (id: string, body: Partial<Country>) => api.patch<Country>(`/countries/${id}`, body).then((r) => r.data),
  remove: (id: string) => api.delete(`/countries/${id}`).then((r) => r.data),
  setZone: (id: string, shippingServiceId: string, zoneId: string | null) =>
    api.put<Country>(`/countries/${id}/shipping-zone`, { shippingServiceId, zoneId }).then((r) => r.data),
};

export const shippingServicesApi = {
  list: () => api.get<ShippingService[]>('/shipping-services').then((r) => r.data),
  get: (id: string) => api.get<ShippingService>(`/shipping-services/${id}`).then((r) => r.data),
  create: (body: any) => api.post<ShippingService>('/shipping-services', body).then((r) => r.data),
  update: (id: string, body: any) => api.patch<ShippingService>(`/shipping-services/${id}`, body).then((r) => r.data),
  remove: (id: string) => api.delete(`/shipping-services/${id}`).then((r) => r.data),
};

export const salesChannelsApi = {
  list: (q?: string) => api.get<SalesChannel[]>('/sales-channels', { params: q ? { q } : undefined }).then((r) => r.data),
  create: (body: Partial<SalesChannel>) => api.post<SalesChannel>('/sales-channels', body).then((r) => r.data),
  update: (id: string, body: Partial<SalesChannel>) => api.patch<SalesChannel>(`/sales-channels/${id}`, body).then((r) => r.data),
  remove: (id: string) => api.delete(`/sales-channels/${id}`).then((r) => r.data),
};

// ---- Global search (top-bar command palette) ----
export type SearchScope =
  | 'all' | 'products' | 'sales-transactions' | 'sales-channels'
  | 'countries' | 'shipping-services' | 'companies' | 'users';
export interface SearchHit { id: string; label: string; sub?: string | null }
export interface SearchResponse { groups: { module: SearchScope; items: SearchHit[] }[] }

export const searchApi = {
  global: (q: string, scope: SearchScope = 'all') =>
    api.get<SearchResponse>('/search', { params: { q, scope } }).then((r) => r.data),
};

// ---- Channel integrations (secure third-party API connections) ----
export interface ConnectorField {
  key: string; label: string; type: 'text' | 'url' | 'textarea' | 'select';
  secret: boolean; required: boolean; group?: string; placeholder?: string; help?: string;
  options?: { value: string; label: string }[];
}
export interface ConnectorMarketplace { id: string; label: string; meta?: Record<string, string> }
export interface ConnectorDef { type: string; label: string; description: string; testable: boolean; marketplaces: ConnectorMarketplace[]; fields: ConnectorField[] }
export interface IntegrationSecretField { fieldKey: string; set: boolean; last4: string | null }
export interface ChannelIntegration {
  id: string; name: string; channelType: string; connectorLabel: string;
  marketplace: string | null; marketplaceLabel: string | null;
  config: Record<string, string>; status: 'active' | 'disabled';
  lastTestedAt: string | null; lastTestStatus: 'ok' | 'fail' | null; lastTestMessage: string | null;
  mappingVerifiedAt: string | null;
  targetSalesChannelId: string | null; targetCompanyId: string | null;
  autoSyncEnabled: boolean; backfillDays: number;
  lastSyncedAt: string | null; lastSyncRunAt: string | null;
  lastSyncStatus: 'ok' | 'error' | null; lastSyncMessage: string | null;
  secretFields: IntegrationSecretField[]; createdAt: string;
}
export interface IntegrationTestResult { ok: boolean; message: string }
export interface IntegrationSyncResult {
  ok: boolean; message: string;
  scanned: number; created: number; updated: number; skipped: number; cancelled: number; errors: number;
}
export interface MappedField { target: string; label: string; source: string; value: string | number | null; resolved?: string | null }
export interface MappingSample { orderId: string; header: MappedField[]; items: { sku: string | null; fields: MappedField[] }[]; raw: unknown }
export interface MappingPreview {
  ok: boolean; mode?: 'live' | 'test'; status?: number; message?: string;
  verifiedAt?: string | null; target?: string; samples?: MappingSample[];
}

export interface ListingPreviewRow {
  sku: string; asin: string | null; title: string | null; quantity: number | null;
  price: number | null; currency: string | null; fulfilmentChannel: string | null; status: string | null;
}
export interface ListingsPreview {
  ok: boolean; channelType?: string; count?: number; message?: string; listings?: ListingPreviewRow[];
}

export const integrationsApi = {
  connectors: () => api.get<ConnectorDef[]>('/integrations/connectors').then((r) => r.data),
  list: () => api.get<ChannelIntegration[]>('/integrations').then((r) => r.data),
  get: (id: string) => api.get<ChannelIntegration>(`/integrations/${id}`).then((r) => r.data),
  create: (body: { name: string; channelType: string; marketplace?: string | null; config?: Record<string, string>; secrets?: Record<string, string> }) =>
    api.post<ChannelIntegration>('/integrations', body).then((r) => r.data),
  update: (id: string, body: { name?: string; marketplace?: string | null; config?: Record<string, string>; secrets?: Record<string, string>; status?: 'active' | 'disabled'; targetSalesChannelId?: string | null; targetCompanyId?: string | null; autoSyncEnabled?: boolean; backfillDays?: number }) =>
    api.patch<ChannelIntegration>(`/integrations/${id}`, body).then((r) => r.data),
  sync: (id: string, range?: { from: string; to?: string }) => api.post<IntegrationSyncResult>(`/integrations/${id}/sync`, range ?? {}).then((r) => r.data),
  test: (id: string, mode: 'live' | 'test') => api.post<IntegrationTestResult>(`/integrations/${id}/test`, { mode }).then((r) => r.data),
  previewMapping: (id: string) => api.post<MappingPreview>(`/integrations/${id}/preview-mapping`, {}).then((r) => r.data),
  previewListings: (id: string) => api.post<ListingsPreview>(`/integrations/${id}/preview-listings`, {}).then((r) => r.data),
  verifyMapping: (id: string, confirmed: boolean) => api.post<ChannelIntegration>(`/integrations/${id}/verify-mapping`, { confirmed }).then((r) => r.data),
  remove: (id: string) => api.delete(`/integrations/${id}`).then((r) => r.data),
  /** Brand logos per channel family, as { channelType: url }. */
  channelLogos: () => api.get<Record<string, string>>('/integrations/channel-logos').then((r) => r.data),
  uploadChannelLogo: (channelType: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post<{ channelType: string; url: string }>(`/integrations/channel-logos/${channelType}`, fd).then((r) => r.data);
  },
  removeChannelLogo: (channelType: string) =>
    api.delete<{ channelType: string; removed: boolean }>(`/integrations/channel-logos/${channelType}`).then((r) => r.data),
  /** Sync-automation settings: the daily auto-sync time (HH:MM, server/UTC). */
  getSyncSettings: () => api.get<{ channelSyncTime: string }>('/integrations/sync-settings').then((r) => r.data),
  setSyncSettings: (channelSyncTime: string) =>
    api.patch<{ channelSyncTime: string }>('/integrations/sync-settings', { channelSyncTime }).then((r) => r.data),
  /** Enable/disable daily auto-sync across a scope (all, a channel family, or explicit ids). */
  bulkSetAutoSync: (scope: { ids?: string[]; channelType?: string; all?: boolean }, enabled: boolean) =>
    api.post<{ updated: number }>('/integrations/bulk/auto-sync', { ...scope, enabled }).then((r) => r.data),
};

// ---- Sales analytics / reporting ----
export interface AnalyticsTotals {
  revenueExVatEur: number; revenueIncVatEur: number; profitEur: number; feesEur: number;
  orders: number; units: number; shippingEur: number; dutyEur: number; refundEur: number;
  profitPct: number | null; avgOrderValueEur: number;
}
export interface AnalyticsFulfilmentRow {
  fulfilment: string; revenueExVatEur: number; revenueIncVatEur: number; profitEur: number;
  feesEur: number; orders: number; units: number; profitPct: number | null;
}
export interface AnalyticsChannelRow {
  channelId: string | null; channelName: string; currency: string | null;
  revenueExVatNative: number; revenueIncVatNative: number; revenueExVatEur: number; revenueIncVatEur: number;
  profitEur: number; feesEur: number; orders: number; units: number; profitPct: number | null;
  returnedUnits: number; refundEur: number;
  prevRevenueExVatEur: number | null; prevProfitEur: number | null; prevReturnedUnits: number | null;
  fulfilments: AnalyticsFulfilmentRow[];
}
export interface AnalyticsCountryRow {
  countryId: string | null; countryName: string;
  revenueExVatEur: number; revenueIncVatEur: number; profitEur: number; feesEur: number;
  orders: number; units: number; profitPct: number | null;
  prevRevenueExVatEur: number | null; prevProfitEur: number | null;
}
export interface AnalyticsSkuRow {
  sku: string; productTitle: string | null; revenueExVatEur: number; revenueIncVatEur: number;
  profitEur: number; feesEur: number; units: number; returnedUnits: number; lines: number; profitPct: number | null; avgFeeEur: number;
  prevRevenueExVatEur: number | null; prevProfitEur: number | null;
}
export interface AnalyticsTrendPoint {
  bucket: string;
  revenueExVatEur: number; revenueIncVatEur: number; profitEur: number; feesEur: number;
  orders: number; units: number; returnedUnits: number; avgOrderValueEur: number;
}
export interface AnalyticsReturnsTotals { returnedOrders: number; returnedUnits: number; refundEur: number }
export interface AnalyticsReport {
  range: { from: string; to: string };
  compareRange: { from: string; to: string } | null;
  totals: AnalyticsTotals;
  compareTotals: AnalyticsTotals | null;
  byChannel: AnalyticsChannelRow[];
  byCountry: AnalyticsCountryRow[];
  bySku: AnalyticsSkuRow[];
  bySkuByCountry: AnalyticsSkuRow[];
  channels: { id: string; name: string }[];
  countries: { id: string; name: string }[];
  trend: AnalyticsTrendPoint[];
  compareTrend: AnalyticsTrendPoint[] | null;
  returns: AnalyticsReturnsTotals;
  compareReturns: AnalyticsReturnsTotals | null;
}

export interface AnalyticsSalesParams {
  from: string; to: string; compareFrom?: string; compareTo?: string; companyId?: string;
  channelId?: string; countryId?: string; fulfilment?: string;
  skuChannelId?: string; skuCountryId?: string;
}

export interface AnalyticsSkuTotals {
  revenueExVatEur: number; revenueIncVatEur: number; profitEur: number; feesEur: number;
  units: number; orders: number; profitPct: number | null; avgPriceEur: number; feePerUnitEur: number;
}
export interface AnalyticsSkuChannelRow {
  channelId: string | null; channelName: string; currency: string | null; fulfilment: string;
  revenueExVatEur: number; revenueIncVatEur: number; profitEur: number; feesEur: number;
  units: number; profitPct: number | null; avgPriceEur: number; feePerUnitEur: number;
}
export interface AnalyticsSkuTrendPoint { bucket: string; revenueExVatEur: number; profitEur: number; feesEur: number; units: number; feePerUnitEur: number }
export interface AnalyticsSkuDetail {
  sku: string; productTitle: string | null; range: { from: string; to: string };
  totals: AnalyticsSkuTotals; prevTotals: AnalyticsSkuTotals | null;
  byChannel: AnalyticsSkuChannelRow[]; trend: AnalyticsSkuTrendPoint[];
  returns: { returnedUnits: number; refundEur: number; orders: number };
}
export interface AnalyticsSkuParams {
  sku: string; from: string; to: string; compareFrom?: string; compareTo?: string;
  companyId?: string; channelId?: string; countryId?: string; fulfilment?: string;
}

export const analyticsApi = {
  sales: (params: AnalyticsSalesParams) =>
    api.get<AnalyticsReport>('/analytics/sales', { params }).then((r) => r.data),
  sku: (params: AnalyticsSkuParams) =>
    api.get<AnalyticsSkuDetail>('/analytics/sku', { params }).then((r) => r.data),
};

// ---- Customs FX (Cyprus Customs monthly exchange rates) ----
export interface CustomsFxCurrency { code: string; name: string | null }
export interface CustomsFxMonth { month: number; rates: Record<string, number> }
export interface CustomsFxSync {
  id: string;
  status: 'success' | 'error';
  message: string | null;
  sourceUrl: string | null;
  sourceModified: string | null;
  monthsImported: number;
  ratesImported: number;
  trigger: string;
  createdAt: string;
}
export interface CustomsFxResponse {
  year: number | null;
  availableYears: number[];
  currencies: CustomsFxCurrency[];
  months: CustomsFxMonth[];
  lastSync: CustomsFxSync | null;
  source: string;
}
export interface CustomsFxSyncResult {
  status: 'success' | 'error';
  message?: string;
  sourceUrl?: string;
  sourceModified?: string | null;
  monthsImported: number;
  ratesImported: number;
}

export const customsFxApi = {
  get: (year?: number) => api.get<CustomsFxResponse>('/customs-fx', { params: year ? { year } : undefined }).then((r) => r.data),
  sync: () => api.post<CustomsFxSyncResult>('/customs-fx/sync', {}).then((r) => r.data),
};

// ---- Profit tiers (colour bands for the Profit % chip) ----
export interface ProfitTier {
  id: string;
  name: string | null;
  fromPct: number;
  toPct: number;
  bgColor: string;
  fontColor: string;
  sortOrder: number;
}

export const profitTiersApi = {
  list: () => api.get<ProfitTier[]>('/profit-tiers').then((r) => r.data),
  saveAll: (tiers: { name?: string | null; fromPct: number; toPct: number; bgColor: string; fontColor: string }[]) =>
    api.put<ProfitTier[]>('/profit-tiers', { tiers }).then((r) => r.data),
};

// ---- Amazon repricing (Buy Box) ops console ----
export interface RepricingReadiness {
  total: number;
  byState: Record<string, number>;
  byExclusion: Record<string, number>;
}
export interface RepricingSkuRow {
  id: string;
  sku: string;
  asin: string | null;
  marketplaceId: string;
  fulfillment: string;
  strategy: string;
  automationState: string;
  exclusionReason: string | null;
  breakevenCents: number | null;
  strategyFloorCents: number | null;
  currentPriceCents: number | null;
  floorsComputedAt: string | null;
  suppressed: boolean;
  updatedAt: string;
}
export interface RepricingDecisionRow {
  id: string;
  at: string;
  sku: string;
  marketplaceId: string;
  branch: string | null;
  outcome: string;
  rawTargetCents: number | null;
  finalPriceCents: number | null;
  beforePriceCents: number | null;
  submissionStatus: string | null;
}

export interface RepricingControl {
  liveWritesEnabled: boolean;
  killSwitchEngaged: boolean;
}
export interface RepricingQuarantineRow {
  id: string;
  sku: string;
  asin: string | null;
  marketplaceId: string;
  strategy: string;
  strategyFloorCents: number | null;
  mapCents: number | null;
  maxPriceCents: number | null;
  fairPricingCeilingCents: number | null;
  updatedAt: string;
}
export interface RepricingQuarantine {
  total: number;
  oldestHours: number;
  items: RepricingQuarantineRow[];
}
export interface BlockedSeller {
  id: string;
  sellerId: string;
  marketplaceId: string | null;
  sellerName: string | null;
  reason: string | null;
  brand: string | null;
  createdAt: string;
}

export const repricingApi = {
  readiness: () => api.get<RepricingReadiness>('/amazon-repricing/readiness').then((r) => r.data),
  getControl: () => api.get<RepricingControl>('/amazon-repricing/control').then((r) => r.data),
  setControl: (patch: Partial<RepricingControl>) => api.post<RepricingControl>('/amazon-repricing/control', patch).then((r) => r.data),
  blocklist: () => api.get<BlockedSeller[]>('/amazon-repricing/blocklist').then((r) => r.data),
  addBlocked: (dto: { sellerId: string; marketplaceId?: string | null; sellerName?: string | null; reason?: string | null; brand?: string | null }) =>
    api.post<BlockedSeller>('/amazon-repricing/blocklist', dto).then((r) => r.data),
  removeBlocked: (id: string) => api.delete<{ removed: boolean }>(`/amazon-repricing/blocklist/${id}`).then((r) => r.data),
  onboard: () => api.post<{ scannedListings: number; created: number; updated: number; skipped: number }>('/amazon-repricing/onboard', {}).then((r) => r.data),
  recomputeFloors: () => api.post<{ processed: number; ok: number }>('/amazon-repricing/floors/recompute', {}).then((r) => r.data),
  skuPricing: (take = 100) => api.get<RepricingSkuRow[]>('/amazon-repricing/sku-pricing', { params: { take } }).then((r) => r.data),
  decisions: (params: { take?: number; sku?: string; outcome?: string } = {}) =>
    api.get<RepricingDecisionRow[]>('/amazon-repricing/decisions', { params: { take: params.take ?? 100, sku: params.sku || undefined, outcome: params.outcome || undefined } }).then((r) => r.data),
  quarantine: () => api.get<RepricingQuarantine>('/amazon-repricing/quarantine').then((r) => r.data),
  resolveQuarantine: (id: string) => api.post<{ resolved: boolean }>(`/amazon-repricing/quarantine/${id}/resolve`, {}).then((r) => r.data),
};

// ---- Sales Transactions ----
export interface SalesTransactionItem {
  /** Units consumed by this line, for serial-tracked products. */
  serials?: string[];
  id?: string;
  productId?: string | null;
  productTitle?: string | null;
  productMatched?: boolean;
  /** Catalogue purchase cost. Shown for reference — not necessarily what COGS used. */
  productCost?: number | null;
  /** Moving average cost, once the product has been received at least once. */
  averageCostEur?: number | null;
  /** Per-line unit purchase cost override (EUR); replaces the product's cost in the profit calc. */
  unitNetCostEur?: number | null;
  /** The unit cost the profit figure was actually calculated from. Prefer this when displaying cost. */
  unitCostEur?: number | null;
  /** Which of the three sources `unitCostEur` came from. */
  costSource?: 'override' | 'average' | 'catalogue' | 'none';
  productWeightKg?: number | null;
  sku: string;
  quantity: number;
  netSalesAmount?: number | null;
  vatAmount?: number | null;
  shippingAmount?: number | null;
  shippingAmountVat?: number | null;
  salesChannelSalesFeeAmount?: number | null;
  fbaFulfilmentFeeAmount?: number | null;
  amazonPointsAmount?: number | null;
  salesTaxAmount?: number | null;
  /** Local sales: the VAT class applied and the rate snapshotted at the time of sale. */
  vatClassId?: string | null;
  vatClass?: { id: string; name: string; taxTreatment: VatTaxTreatment } | null;
  vatRatePct?: number | null;
}
export interface TransactionAlert {
  code: string;
  severity: 'warning' | 'error';
  message: string;
  /** For list alerts (e.g. unmatched SKUs): rendered one per row under the message. */
  items?: string[];
}
export interface SalesTransaction {
  id: string;
  date: string;
  transactionRef: string;
  alerts: TransactionAlert[];
  hasAlerts: boolean;
  salesChannelId: string | null;
  salesChannel: { id: string; name: string; kind?: SalesChannelKind; showTransactionTotal?: boolean; nativeCountryIso?: string | null } | null;
  /** True when the sale went through a channel of kind 'local' (server-derived). */
  isLocal?: boolean;
  deliveryMethod?: 'pickup' | 'own_delivery' | null;
  localShippingCostEur?: number | null;
  /** Sale-level discount as entered. Line nets are already net of it; the server spreads it
   *  across the lines in proportion to their net. */
  discountType?: 'percentage' | 'fixed' | null;
  discountValue?: number | null;
  discountBase?: 'net' | 'gross' | null;
  /** Server-computed: net + VAT + buyer-paid shipping + its VAT, in the transaction currency.
   *  Null when the channel has the Total turned off. */
  showTransactionTotal?: boolean;
  transactionTotal?: number | null;
  destinationCountryId: string | null;
  destinationCountry: { id: string; name: string; isoCode: string } | null;
  shippingServiceId: string | null;
  shippingService: { id: string; name: string } | null;
  companyId: string | null;
  currency: string | null;
  feeCurrency: string | null;
  exchangeRate: number | null;
  exchangeRateEstimated: boolean;
  feeExchangeRate: number | null;
  status: 'draft' | 'submitted';
  unlockedForEdit: boolean;
  hasPendingUnlock: boolean;
  salesFeePct: number | null;
  estimatedSalesFee: number;
  estimatedSalesFeeEur: number | null;
  effectiveSalesFee: number;
  salesFeeEstimated: boolean;
  amazonPoints: number;
  amazonPointsEur: number | null;
  salesTax: number;
  salesTaxEur: number | null;
  destinationCountryVatPct: number | null;
  taxType: string | null;
  taxLabel: string;
  vatOverridden: boolean;
  overallPackageWeight: number | null;
  fulfilmentType: 'FBA' | 'FBM' | null;
  estimatedShippingCost: number | null;
  actualShippingCost: number | null;
  shippingCostSource: 'actual' | 'estimated';
  fbaInboundCostEur: number | null;
  fbaFeeEur: number | null;
  returnShippingCost: number;
  dutyImportCost: number;
  /** 'partial' = some outbound shipments recorded, but not yet marked fully shipped. */
  fulfilmentStatus: 'pending' | 'partial' | 'shipped' | 'cancelled';
  /** Outbound shipments recorded against this order so far. */
  outboundShipmentCount: number;
  channelShipmentStatus: 'shipped' | 'not_shipped' | null;
  resolution: 'none' | 'cancelled' | 'returned' | 'replaced';
  refundAmount: number | null;
  refundEur: number;
  restockItems: boolean;
  feeRefunded: boolean;
  resolutionNotes: string | null;
  resolvedAt: string | null;
  returnWarehouseId: string | null;
  returnHandled: boolean;
  resolutionSource: 'manual' | 'amazon' | null;
  integrationId: string | null;
  shipped: boolean;
  shipments: TransactionShipment[];
  profit: number | null;
  profitPct: number | null;
  items: SalesTransactionItem[];
  itemCount: number;
  totals: { quantity: number; netSales: number; vat: number; shipping: number; shippingVat: number; fee: number };
}
export interface SalesTransactionListResponse { items: SalesTransaction[]; total: number; page: number; pageSize: number }
export interface UnlockRequest { id: string; transactionId: string; transactionRef: string; requestedBy: string; createdAt: string }

// ---- Shipments (operations: actual shipping cost + duty per transaction) ----
export type ShipmentType = 'outbound' | 'inbound';
export type CostBorneBy = 'company' | 'customer';

export interface TransactionShipment {
  id: string;
  type: ShipmentType;
  shipmentDate: string;
  shippingService: RefLite | null;
  trackingNumber: string | null;
  shippingCostEur: number | null;
  costBorneBy: CostBorneBy;
  dutyImportEur: number | null;
  comments: string | null;
}

export interface Shipment {
  id: string;
  transactionId: string;
  transactionRef: string | null;
  transactionDate: string | null;
  salesChannel: { id: string; name: string } | null;
  company: { id: string; officialName: string } | null;
  destinationCountry: { id: string; name: string } | null;
  fulfilmentStatus: 'pending' | 'shipped' | 'cancelled' | null;
  type: ShipmentType;
  shipmentDate: string;
  shippingServiceId: string | null;
  shippingService: { id: string; name: string } | null;
  trackingNumber: string | null;
  shippingCostEur: number | null;
  costBorneBy: CostBorneBy;
  dutyImportEur: number | null;
  comments: string | null;
  groupId: string | null;
  createdAt: string;
}

export interface PendingShipment {
  id: string;
  transactionRef: string;
  date: string;
  salesChannel: { id: string; name: string; nativeCountryIso?: string | null } | null;
  /** Local sales (our own delivery/pickup) fulfil in one click — no carrier/tracking needed. */
  isLocal: boolean;
  deliveryMethod: 'pickup' | 'own_delivery' | null;
  company: { id: string; officialName: string } | null;
  destinationCountry: { id: string; name: string } | null;
  defaultShippingService: { id: string; name: string } | null;
  skus: string[];
  itemCount: number;
  quantity: number;
  /** Shipping charged to the customer on this order (EUR) — default weight for a combined split. */
  shippingEur: number;
  shipmentCount: number;
  /** Outbound shipments already recorded; > 0 means this order is partially shipped. */
  outboundCount: number;
}

export interface ShipmentListResponse { items: Shipment[]; total: number; page: number; pageSize: number }
export interface PendingListResponse { items: PendingShipment[]; total: number; page: number; pageSize: number }

export type ShipmentExportRow = Record<string, string | number>;
export interface ShipmentImportRowResult {
  index: number;
  transactionRef: string;
  status: 'new' | 'skip' | 'error';
  transactionId: string | null;
  shippingServiceId: string | null;
  issues: { field: string; message: string; severity: 'error' | 'warning' }[];
}

export const shipmentsApi = {
  list: (params: { q?: string; companyId?: string; salesChannelId?: string; type?: string; sortDir?: 'asc' | 'desc'; page?: number; pageSize?: number }) =>
    api.get<ShipmentListResponse>('/shipments', { params }).then((r) => r.data),
  pending: (params: { q?: string; companyId?: string; salesChannelId?: string; channelKind?: 'local' | 'channel'; sortDir?: 'asc' | 'desc'; page?: number; pageSize?: number }) =>
    api.get<PendingListResponse>('/shipments/pending', { params }).then((r) => r.data),
  forTransaction: (transactionId: string) => api.get<TransactionShipment[]>(`/shipments/transaction/${transactionId}`).then((r) => r.data),
  create: (body: any) => api.post<Shipment>('/shipments', body).then((r) => r.data),
  /** Several parcels sent together on one date — one row per parcel, each with its own
   *  carrier / tracking / cost. */
  createBatch: (body: {
    transactionId: string; type?: 'outbound' | 'inbound'; shipmentDate: string;
    costBorneBy?: 'company' | 'customer'; dutyImportEur?: number | null; comments?: string | null;
    markShipped?: boolean;
    parcels: { shippingServiceId?: string | null; trackingNumber?: string | null; shippingCostEur?: number | null }[];
  }) => api.post<{ ok: boolean; created: number }>('/shipments/batch', body).then((r) => r.data),
  /** Ship several orders together as one parcel; the single cost is split across them
   *  (explicit allocations, or by each order's own shipping charge). */
  combine: (body: {
    transactionIds: string[]; shipmentDate: string; shippingServiceId?: string | null;
    trackingNumber?: string | null; totalShippingCostEur?: number | null;
    allocations?: { transactionId: string; shippingCostEur: number }[];
    costBorneBy?: 'company' | 'customer'; dutyImportEur?: number | null; comments?: string | null; markShipped?: boolean;
  }) => api.post<{ ok: boolean; created: number; groupId: string; allocations: { transactionId: string; transactionRef: string; shippingCostEur: number }[] }>('/shipments/combine', body).then((r) => r.data),
  update: (id: string, body: any) => api.patch<Shipment>(`/shipments/${id}`, body).then((r) => r.data),
  remove: (id: string) => api.delete(`/shipments/${id}`).then((r) => r.data),
  setFulfilment: (transactionId: string, status: 'pending' | 'shipped' | 'cancelled') =>
    api.patch(`/shipments/transaction/${transactionId}/fulfilment`, { status }).then((r) => r.data),
  /** One-click fulfil for a local sale — records a marker shipment (no carrier/tracking). */
  fulfilLocal: (transactionId: string) =>
    api.post(`/shipments/transaction/${transactionId}/fulfil-local`, {}).then((r) => r.data),
  export: (params: { scope: 'recorded' | 'pending'; q?: string; companyId?: string; salesChannelId?: string; type?: string; channelKind?: 'local' | 'channel' }) =>
    api.get<ShipmentExportRow[]>('/shipments/export', { params }).then((r) => r.data),
  importValidate: (rows: Record<string, string>[]) =>
    api.post<{ rows: ShipmentImportRowResult[] }>('/shipments/import/validate', { rows }).then((r) => r.data),
  importCommit: (items: { row: Record<string, string>; transactionId: string; shippingServiceId: string | null }[]) =>
    api.post<{ created: number; skipped: number; errors: { transactionRef: string; message: string }[] }>('/shipments/import/commit', { items }).then((r) => r.data),
};

// ---- FBA Shipments (stock inbound to Amazon fulfilment centers) ----
export interface FbaLineInput { sku: string; productId?: string | null; quantity: number }
export interface FbaBoxInput {
  label?: string | null;
  emptyWeightKg?: number | null;
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
  trackingNumber?: string | null;
  items: FbaLineInput[];
}
export interface FbaEstimateItem {
  sku: string;
  productId: string | null;
  title: string | null;
  quantity: number;
  unitWeightKg: number | null;
  lineWeightKg: number | null;
  weightMissing: boolean;
  allocatedCostEur: number | null;
  allocatedCostPerUnitEur: number | null;
}
export interface FbaEstimateBox {
  label: string | null;
  emptyWeightKg: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  trackingNumber: string | null;
  volumetricWeightKg: number | null;
  items: FbaEstimateItem[];
}
export interface FbaEstimate {
  calcMethod: 'actual_weight' | 'volumetric_weight' | null;
  salesChannelId: string | null;
  destinationCountryId: string | null;
  destinationCountry: { id: string; name: string; isoCode: string } | null;
  shippingServiceId: string | null;
  shippingZoneId: string | null;
  shippingZoneName: string | null;
  packagingPct: number;
  productWeightKg: number | null;
  emptyBoxesWeightKg: number | null;
  boxesVolumetricWeightKg: number | null;
  chargeableWeightKg: number | null;
  estimatedCostEur: number | null;
  boxes: FbaEstimateBox[];
  allocation: FbaEstimateItem[];
  warnings: string[];
}
export interface FbaShipmentItem {
  id: string;
  boxId: string | null;
  productId: string | null;
  sku: string;
  title: string | null;
  quantity: number;
  unitWeightKg: number | null;
  lineWeightKg: number | null;
  allocatedCostEur: number | null;
  allocatedCostPerUnitEur: number | null;
}
export interface FbaShipmentBox {
  id: string;
  label: string | null;
  emptyWeightKg: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  trackingNumber: string | null;
  volumetricWeightKg: number | null;
  items: FbaShipmentItem[];
}
export interface FbaShipment {
  id: string;
  date: string;
  salesChannelId: string | null;
  salesChannel: { id: string; name: string } | null;
  destinationCountryId: string | null;
  destinationCountry: { id: string; name: string; isoCode: string } | null;
  fbaShipmentRef: string | null;
  shippingServiceId: string | null;
  shippingService: { id: string; name: string; calcMethod: string; trackingUrlTemplate: string | null } | null;
  shippingZoneId: string | null;
  shippingZone: { id: string; name: string } | null;
  calcMethod: 'actual_weight' | 'volumetric_weight' | null;
  packagingPct: number | null;
  productWeightKg: number | null;
  emptyBoxesWeightKg: number | null;
  chargeableWeightKg: number | null;
  estimatedCostEur: number | null;
  actualCostEur: number | null;
  effectiveCostEur: number | null;
  costSource: 'actual' | 'estimated';
  status: 'draft' | 'confirmed';
  comments: string | null;
  boxCount: number;
  itemCount: number;
  quantity: number;
  boxes: FbaShipmentBox[];
  allocation: FbaShipmentItem[];
  createdAt: string;
  updatedAt: string;
}
export interface FbaShipmentListResponse { items: FbaShipment[]; total: number; page: number; pageSize: number }
export interface FbaSkuCost {
  sku: string;
  productId: string | null;
  title: string | null;
  salesChannelId: string | null;
  salesChannelName: string | null;
  totalQuantity: number;
  totalAllocatedCostEur: number;
  averageCostPerUnitEur: number | null;
  shipmentCount: number;
}
export interface FbaShipmentInput {
  date?: string;
  salesChannelId?: string | null;
  fbaShipmentRef?: string | null;
  shippingServiceId?: string | null;
  packagingPct?: number;
  comments?: string | null;
  status?: 'draft' | 'confirmed';
  boxes: FbaBoxInput[];
}

export const fbaShipmentsApi = {
  list: (params: { q?: string; salesChannelId?: string; status?: string; sortDir?: 'asc' | 'desc'; page?: number; pageSize?: number }) =>
    api.get<FbaShipmentListResponse>('/fba-shipments', { params }).then((r) => r.data),
  get: (id: string) => api.get<FbaShipment>(`/fba-shipments/${id}`).then((r) => r.data),
  estimate: (body: Omit<FbaShipmentInput, 'status'>) => api.post<FbaEstimate>('/fba-shipments/estimate', body).then((r) => r.data),
  create: (body: FbaShipmentInput) => api.post<FbaShipment>('/fba-shipments', body).then((r) => r.data),
  update: (id: string, body: FbaShipmentInput) => api.patch<FbaShipment>(`/fba-shipments/${id}`, body).then((r) => r.data),
  setStatus: (id: string, status: 'draft' | 'confirmed') => api.patch<FbaShipment>(`/fba-shipments/${id}/status`, { status }).then((r) => r.data),
  setActualCost: (id: string, actualCostEur: number) => api.patch<FbaShipment>(`/fba-shipments/${id}/actual-cost`, { actualCostEur }).then((r) => r.data),
  remove: (id: string) => api.delete(`/fba-shipments/${id}`).then((r) => r.data),
  skuCosts: (params: { q?: string; salesChannelId?: string }) =>
    api.get<FbaSkuCost[]>('/fba-shipments/sku-costs', { params }).then((r) => r.data),
  importShipments: (rows: Record<string, string>[]) =>
    api.post<{ created: number; shipments: number; errors: { fbaRef: string; message: string }[] }>('/fba-shipments/import', { rows }).then((r) => r.data),
};

export type TxGroupBy = 'channelGroup' | 'channel' | 'sku' | 'brand' | 'vendor';
export interface TxGroupRow { key: string; label: string; orders: number; units: number; revenueEur: number; profitEur: number; marginPct: number | null }
export interface TxGroupedResult { groupBy: TxGroupBy; groups: TxGroupRow[]; totals: { orders: number; units: number; revenueEur: number; profitEur: number } }
export interface TxFilterParams { q?: string; salesChannelId?: string[]; destinationCountryId?: string[]; status?: string[]; profitTierId?: string[]; shipmentStatus?: string[]; fulfilmentType?: string[]; feeType?: string[]; sku?: string; hasAlert?: boolean; needsReturn?: boolean; resolution?: string[]; dateFrom?: string; dateTo?: string }

export const salesTransactionsApi = {
  list: (params: { q?: string; companyId?: string; salesChannelId?: string[]; destinationCountryId?: string[]; status?: string[]; profitTierId?: string[]; shipmentStatus?: string[]; fulfilmentType?: string[]; feeType?: string[]; sku?: string; hasAlert?: boolean; needsReturn?: boolean; resolution?: string[]; dateFrom?: string; dateTo?: string; sortBy?: 'date' | 'profit' | 'profitPct'; sortDir?: 'asc' | 'desc'; page?: number; pageSize?: number }) =>
    api.get<SalesTransactionListResponse>('/sales-transactions', { params }).then((r) => r.data),
  grouped: (params: TxFilterParams, groupBy: TxGroupBy) =>
    api.get<TxGroupedResult>('/sales-transactions/grouped', { params: { ...params, groupBy } }).then((r) => r.data),
  groupMembers: (params: TxFilterParams, groupBy: TxGroupBy, groupKey: string) =>
    api.get<SalesTransaction[]>('/sales-transactions/group-members', { params: { ...params, groupBy, groupKey } }).then((r) => r.data),
  get: (id: string) => api.get<SalesTransaction>(`/sales-transactions/${id}`).then((r) => r.data),
  create: (body: any) => api.post<SalesTransaction>('/sales-transactions', body).then((r) => r.data),
  update: (id: string, body: any) => api.patch<SalesTransaction>(`/sales-transactions/${id}`, body).then((r) => r.data),
  remove: (id: string) => api.delete(`/sales-transactions/${id}`).then((r) => r.data),
  resolve: (id: string, body: { resolution: 'none' | 'cancelled' | 'returned' | 'replaced'; refundAmount?: number | null; restockItems?: boolean; feeRefunded?: boolean; resolutionNotes?: string | null; returnedToStock?: boolean; returnWarehouseId?: string | null }) =>
    api.patch<SalesTransaction>(`/sales-transactions/${id}/resolution`, body).then((r) => r.data),
  allIds: (params: { q?: string; companyId?: string; salesChannelId?: string[]; destinationCountryId?: string[]; status?: string[]; profitTierId?: string[]; shipmentStatus?: string[]; fulfilmentType?: string[]; feeType?: string[]; sku?: string; hasAlert?: boolean; dateFrom?: string; dateTo?: string }) =>
    api.get<{ ids: string[]; total: number }>('/sales-transactions/ids', { params }).then((r) => r.data),
  export: (params: { q?: string; companyId?: string; salesChannelId?: string[]; destinationCountryId?: string[]; status?: string[]; profitTierId?: string[]; shipmentStatus?: string[]; fulfilmentType?: string[]; feeType?: string[]; sku?: string; hasAlert?: boolean; dateFrom?: string; dateTo?: string; sortBy?: 'date' | 'profit' | 'profitPct'; sortDir?: 'asc' | 'desc' }) =>
    api.get<SalesTransaction[]>('/sales-transactions/export', { params }).then((r) => r.data),
  bulkStatus: (ids: string[], status: 'draft' | 'submitted') =>
    api.post<{ updated: number; skipped: number }>('/sales-transactions/bulk/status', { ids, status }).then((r) => r.data),
  /** Re-derive stored fields from the current catalogue/settings. Pass `ids` to recalculate
   *  only those transactions (faster); omit for a full sweep. */
  recalculate: (ids?: string[]) =>
    api.post<{ checked: number; updated: number; relinkedItems: number; vattedItems: number }>('/sales-transactions/recalculate', ids?.length ? { ids } : {}).then((r) => r.data),
  requestUnlock: (id: string) => api.post(`/sales-transactions/${id}/unlock-request`, {}).then((r) => r.data),
  listUnlockRequests: () => api.get<UnlockRequest[]>('/sales-transactions/unlock-requests').then((r) => r.data),
  decideUnlock: (requestId: string, grant: boolean) => api.post(`/sales-transactions/unlock-requests/${requestId}/decide`, { grant }).then((r) => r.data),
};

// ---------------------------------------------------------------- warehouses & stock

export interface Warehouse {
  id: string;
  name: string;
  type: 'physical' | 'virtual';
  parentWarehouseId: string | null;
  includeInInventory: boolean;
  isActive: boolean;
  notes: string | null;
}

export interface WarehouseNode extends Warehouse {
  depth: number;
  productCount: number;
  unitCount: number;
  rollupUnitCount: number;
  children: WarehouseNode[];
}

export interface StockLevelRow {
  productId: string;
  sku: string;
  productName: string;
  warehouseId: string;
  warehouseName: string;
  includeInInventory: boolean;
  quantityOnHand: number;
}

export interface StockMovementRow {
  id: string;
  createdAt: string;
  sku: string;
  productName: string;
  warehouseName: string;
  qtyDelta: number;
  balanceAfter: number;
  reason: string;
  reference: string | null;
  notes: string | null;
}

export interface ProductStock {
  product: { id: string; mainSku: string; title: string };
  rows: {
    warehouseId: string; warehouseName: string; warehouseType: string;
    includeInInventory: boolean; isActive: boolean; quantityOnHand: number;
  }[];
  /** Sum over warehouses flagged include_in_inventory — what we can actually sell. */
  available: number;
  /** Everything we physically hold, including excluded warehouses. */
  total: number;
}

export interface StockImportRowResult {
  row: number;
  sku: string;
  productId: string | null;
  productName: string | null;
  warehouse: string;
  warehouseId: string | null;
  quantityOnHand: number | null;
  errors: string[];
  valid: boolean;
}

export const warehousesApi = {
  list: (params: { includeInactive?: boolean } = {}) => api.get<Warehouse[]>('/warehouses', { params }).then((r) => r.data),
  tree: (params: { includeInactive?: boolean } = {}) => api.get<WarehouseNode[]>('/warehouses/tree', { params }).then((r) => r.data),
  create: (body: Partial<Warehouse>) => api.post<Warehouse>('/warehouses', body).then((r) => r.data),
  update: (id: string, body: Partial<Warehouse>) => api.patch<Warehouse>(`/warehouses/${id}`, body).then((r) => r.data),
  /** Refused while stock or children remain; deactivates instead of deleting once it has history. */
  remove: (id: string) => api.delete<{ deleted: boolean; deactivated: boolean }>(`/warehouses/${id}`).then((r) => r.data),
};

export interface InventoryRow {
  productId: string;
  sku: string;
  title: string;
  imageUrl: string | null;
  vendor: { id: string; name: string } | null;
  onHand: number;
  committed: number;
  onOrder: number;
  available: number;
  averageCostEur: number | null;
  averageCostQty: number;
  stockValueEur: number | null;
}

export interface StockOwedRow {
  id: string;
  productId: string;
  sku: string;
  productName: string;
  salesTransactionId: string;
  transactionRef: string | null;
  warehouse: { id: string; name: string } | null;
  quantity: number;
  quantitySettled: number;
  status: 'open' | 'settled' | 'cancelled';
  reason: string;
  openedAt: string;
  settledAt: string | null;
}

export const inventoryApi = {
  list: (params: { q?: string; vendorId?: string; filter?: string; page?: number; pageSize?: number }) =>
    api
      .get<{ rows: InventoryRow[]; total: number; page: number; pageSize: number; pageCount: number }>('/inventory', { params })
      .then((r) => r.data),
  owed: (params: { status?: string; page?: number; pageSize?: number }) =>
    api
      .get<{ rows: StockOwedRow[]; total: number; page: number; pageSize: number; pageCount: number; totalOpenUnits: number }>('/inventory/owed', { params })
      .then((r) => r.data),
};

export const stockApi = {
  levels: (params: { q?: string; warehouseId?: string; includeChildren?: boolean; nonZeroOnly?: boolean; page?: number; pageSize?: number }) =>
    api.get<{ rows: StockLevelRow[]; total: number; page: number; pageSize: number; pageCount: number }>('/stock', { params }).then((r) => r.data),
  movements: (params: { productId?: string; warehouseId?: string; page?: number; pageSize?: number }) =>
    api.get<{ rows: StockMovementRow[]; total: number; page: number; pageSize: number; pageCount: number }>('/stock/movements', { params }).then((r) => r.data),
  byProduct: (productId: string) => api.get<ProductStock>(`/stock/product/${productId}`).then((r) => r.data),
  /** Signed change (+/-). Writes a movement; never lets a balance go negative. */
  adjust: (body: { productId: string; warehouseId: string; qtyDelta: number; reason: string; reference?: string | null; notes?: string | null }) =>
    api.post<{ quantityOnHand: number; qtyDelta: number }>('/stock/adjust', body).then((r) => r.data),
  /** Absolute count (stocktake) — the server derives the delta. */
  setLevel: (body: { productId: string; warehouseId: string; quantityOnHand: number; reason: string; notes?: string | null }) =>
    api.post<{ changed: boolean; quantityOnHand: number }>('/stock/set', body).then((r) => r.data),
  importValidate: (rows: { sku?: string; warehouse?: string; quantity?: string | number }[]) =>
    api.post<{ rows: StockImportRowResult[]; validCount: number; errorCount: number }>('/stock/import/validate', { rows }).then((r) => r.data),
  importCommit: (items: { productId: string; warehouseId: string; quantityOnHand: number }[], reason = 'opening_balance') =>
    api.post<{ applied: number; unchanged: number; total: number }>('/stock/import/commit', { items, reason }).then((r) => r.data),
};

// ---------------------------------------------------------------- purchase orders

export type PurchaseOrderStatus = 'draft' | 'submitted' | 'partially_received' | 'received' | 'cancelled';

export interface PurchaseOrderLine {
  id?: string;
  productId: string;
  sku?: string | null;
  productName?: string | null;
  quantityOrdered: number;
  quantityReceived?: number;
  unitCost: number;
  lineTotal?: number;
  vatClassId?: string | null;
  vatClassName?: string | null;
  vatRatePct?: number;
  vatAmount?: number;
  notes?: string | null;
}

export interface PurchaseOrderListRow {
  id: string;
  poNumber: string;
  status: PurchaseOrderStatus;
  currency: string;
  vendor: { id: string; name: string };
  company: { id: string; officialName: string };
  expectedDeliveryDate: string | null;
  createdAt: string;
  submittedAt: string | null;
  lineCount: number;
  totalQuantity: number;
  totalReceived: number;
  total: number;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  status: PurchaseOrderStatus;
  currency: string;
  company: {
    id: string; officialName: string; registrationNumber: string | null;
    addressLine1: string | null; addressLine2: string | null; addressCity: string | null;
    addressPostalCode: string | null; addressCountry: string | null;
  } | null;
  vendor: {
    id: string; name: string; vatNumber: string | null; email: string | null;
    phone: string | null; addressCity: string | null; addressCountry: string | null;
  } | null;
  destinationWarehouse: { id: string; name: string } | null;
  expectedDeliveryDate: string | null;
  vatTreatment: VendorVatTreatment;
  fxRate: number | null;
  amountPaidEur: number | null;
  /** Rate costing will actually use (EUR per 1 unit of the order currency). */
  effectiveFxRate: number | null;
  shippingCost: number | null;
  shippingCurrency: string;
  shippingAllocation: AllocationMethod;
  customsDuty: number | null;
  customsDutyCurrency: string;
  customsDutyAllocation: AllocationMethod;
  importHandling: number | null;
  importHandlingCurrency: string;
  importHandlingAllocation: AllocationMethod;
  importVat: number | null;
  importVatCurrency: string;
  notes: string | null;
  submittedAt: string | null;
  cancelledAt: string | null;
  receivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  lines: PurchaseOrderLine[];
  totalQuantity: number;
  totalReceived: number;
  total: number;
  totalNet: number;
  totalVat: number;
  totalGross: number;
  statusHistory: { status: string; note: string | null; at: string }[];
}

export interface PurchaseOrderUnlockRequest {
  id: string;
  purchaseOrderId: string;
  poNumber: string;
  status: PurchaseOrderStatus;
  reason: string | null;
  requestedBy: string;
  createdAt: string;
}

export interface PurchaseOrderInput {
  /** Omitted from the client — the API stamps the active company. */
  companyId?: string;
  vendorId: string;
  currency?: string;
  expectedDeliveryDate?: string | null;
  vatTreatment?: VendorVatTreatment;
  fxRate?: number | null;
  amountPaidEur?: number | null;
  shippingCost?: number | null;
  shippingCurrency?: string;
  shippingAllocation?: AllocationMethod;
  customsDuty?: number | null;
  customsDutyCurrency?: string;
  customsDutyAllocation?: AllocationMethod;
  importHandling?: number | null;
  importHandlingCurrency?: string;
  importHandlingAllocation?: AllocationMethod;
  importVat?: number | null;
  importVatCurrency?: string;
  destinationWarehouseId?: string | null;
  notes?: string | null;
  lines: { productId: string; quantityOrdered: number; unitCost: number; notes?: string | null }[];
}

export const purchaseOrdersApi = {
  list: (params: { q?: string; status?: string; vendorId?: string; companyId?: string; from?: string; to?: string; page?: number; pageSize?: number }) =>
    api.get<{ rows: PurchaseOrderListRow[]; total: number; page: number; pageSize: number; pageCount: number }>('/purchase-orders', { params }).then((r) => r.data),
  get: (id: string) => api.get<PurchaseOrder>(`/purchase-orders/${id}`).then((r) => r.data),
  create: (body: PurchaseOrderInput) => api.post<PurchaseOrder>('/purchase-orders', body).then((r) => r.data),
  update: (id: string, body: PurchaseOrderInput) => api.patch<PurchaseOrder>(`/purchase-orders/${id}`, body).then((r) => r.data),
  submit: (id: string) => api.post<PurchaseOrder>(`/purchase-orders/${id}/submit`, {}).then((r) => r.data),
  allIds: (params: { q?: string; status?: string; vendorId?: string; companyId?: string; from?: string; to?: string }) =>
    api.get<{ ids: string[]; total: number }>('/purchase-orders/ids', { params }).then((r) => r.data),
  bulkSubmit: (ids: string[]) =>
    api.post<{ submitted: number; skipped: { id: string; reason: string }[]; requested: number }>('/purchase-orders/bulk/submit', { ids }).then((r) => r.data),
  /** Admin only — reopens a submitted PO as a draft and voids its pending receipt. */
  /** Admin-only: restate quantities / add lines on an order that has already arrived. */
  amend: (id: string, body: { lines: AmendLineInput[]; note?: string }) =>
    api.post<PurchaseOrder>(`/purchase-orders/${id}/amend`, body).then((r) => r.data),
  unlock: (id: string, note?: string) => api.post<PurchaseOrder>(`/purchase-orders/${id}/unlock`, { note }).then((r) => r.data),
  requestUnlock: (id: string, reason?: string) =>
    api.post<{ ok: boolean; alreadyRequested: boolean }>(`/purchase-orders/${id}/unlock-request`, { reason }).then((r) => r.data),
  listUnlockRequests: () => api.get<PurchaseOrderUnlockRequest[]>('/purchase-orders/unlock-requests').then((r) => r.data),
  decideUnlock: (requestId: string, grant: boolean, note?: string) =>
    api.post<{ ok: boolean; granted: boolean }>(`/purchase-orders/unlock-requests/${requestId}/decide`, { grant, note }).then((r) => r.data),
  cancel: (id: string, reason?: string) => api.post<PurchaseOrder>(`/purchase-orders/${id}/cancel`, { reason }).then((r) => r.data),
  remove: (id: string) => api.delete<{ deleted: boolean }>(`/purchase-orders/${id}`).then((r) => r.data),
  /** Fetch the branded PDF (auth header required) and save it to disk. */
  downloadPdf: async (id: string, poNumber: string) => {
    const res = await api.get(`/purchase-orders/${id}/pdf`, { responseType: 'blob' });
    const url = URL.createObjectURL(res.data as Blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${poNumber}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};

// ---------------------------------------------------------------- goods receipts

export type GoodsReceiptStatus = 'pending' | 'posted' | 'cancelled';

export interface GoodsReceiptListRow {
  id: string;
  receiptNumber: string;
  status: GoodsReceiptStatus;
  isBackorder: boolean;
  purchaseOrder: { id: string; poNumber: string } | null;
  vendor: { id: string; name: string } | null;
  destinationWarehouse: { id: string; name: string } | null;
  createdAt: string;
  postedAt: string | null;
  lineCount: number;
  expectedQuantity: number;
  receivedQuantity: number;
}

export interface GoodsReceiptLine {
  id: string;
  purchaseOrderLineId: string;
  productId: string | null;
  sku: string | null;
  productName: string | null;
  quantityOrdered: number;
  quantityAlreadyReceived: number;
  quantityExpected: number;
  quantityReceived: number;
  unitCost: number;
}

export interface GoodsReceipt {
  id: string;
  receiptNumber: string;
  status: GoodsReceiptStatus;
  isBackorder: boolean;
  parentReceiptId: string | null;
  notes: string | null;
  createdAt: string;
  postedAt: string | null;
  destinationWarehouse: { id: string; name: string } | null;
  purchaseOrder: {
    id: string; poNumber: string; status: string; currency: string;
    expectedDeliveryDate: string | null; destinationWarehouseId: string | null;
    vendor: { id: string; name: string } | null;
  } | null;
  lines: GoodsReceiptLine[];
  expectedQuantity: number;
  receivedQuantity: number;
}

/** Extra fields returned by post() on top of the receipt. */
export interface PostReceiptResult extends GoodsReceipt {
  overReceipt: string[] | null;
  backorder: { id: string; receiptNumber: string } | null;
  shortfall: number;
  closedShort: boolean;
  purchaseOrderStatus: string;
}

/** Compact receipt summary shown on a PO's detail page. */
export interface PoReceiptSummary {
  id: string; receiptNumber: string; status: GoodsReceiptStatus; isBackorder: boolean;
  createdAt: string; postedAt: string | null; expectedQuantity: number; receivedQuantity: number;
}

export const goodsReceiptsApi = {
  /** status: 'open' (pending incl. backorders, default) | 'all' | pending|posted|cancelled */
  list: (params: { q?: string; status?: string; purchaseOrderId?: string; vendorId?: string; from?: string; to?: string; page?: number; pageSize?: number }) =>
    api.get<{ rows: GoodsReceiptListRow[]; total: number; page: number; pageSize: number; pageCount: number }>('/goods-receipts', { params }).then((r) => r.data),
  get: (id: string) => api.get<GoodsReceipt>(`/goods-receipts/${id}`).then((r) => r.data),
  post: (id: string, body: {
    lines: { lineId: string; quantityReceived: number }[];
    destinationWarehouseId?: string | null;
    allowOverReceipt?: boolean;
    closeShort?: boolean;
    notes?: string | null;
  }) => api.post<PostReceiptResult>(`/goods-receipts/${id}/post`, body).then((r) => r.data),
  cancel: (id: string, reason?: string) => api.post<GoodsReceipt>(`/goods-receipts/${id}/cancel`, { reason }).then((r) => r.data),
  forPurchaseOrder: (poId: string) => api.get<PoReceiptSummary[]>(`/purchase-orders/${poId}/receipts`).then((r) => r.data),
};

// ---------------------------------------------------------------- procurement

export type StockStatus = 'in_stock' | 'partial' | 'needs_ordering';

export interface DemandRow {
  productId: string;
  sku: string;
  productName: string;
  imageUrl: string | null;
  vendor: { id: string; name: string } | null;
  lastPurchaseCost: number | null;
  purchaseCostCurrency: string;
  requiredQuantity: number;
  availableQuantity: number;
  shortfall: number;
  stockStatus: StockStatus;
  orderCount: number;
  channels: { id: string; name: string }[];
  orderRefs: { id: string; ref: string; date: string; quantity: number }[];
  firstSaleDate: string;
  lastSaleDate: string;
}

export interface DemandResponse {
  rows: DemandRow[];
  total: number; page: number; pageSize: number; pageCount: number;
  summary: { needsOrdering: number; partial: number; inStock: number };
}

export const procurementApi = {
  demand: (params: { q?: string; salesChannelId?: string; stockStatus?: string; from?: string; to?: string; page?: number; pageSize?: number }) =>
    api.get<DemandResponse>('/procurement/demand', { params }).then((r) => r.data),
  generateOrders: (body: {
    companyId?: string;
    currency?: string;
    destinationWarehouseId?: string | null;
    notes?: string | null;
    lines: { productId: string; quantity: number; vendorId?: string | null; unitCost?: number | null }[];
  }) => api.post<{ created: { id: string; poNumber: string; vendorId: string; lineCount: number }[]; orderCount: number }>(
    '/procurement/generate-orders', body,
  ).then((r) => r.data),
};

// ---- Pricing module ----
export interface PricingBreakdown {
  netEur: number; vatEur: number; feeEur: number; importEur: number;
  pointsEur: number; taxType: string; taxLabel: string;
  costEur: number; shippingEur: number; profitEur: number; marginPct: number;
}
export interface PricingComparisonRow {
  channelId: string; channelName: string; currency: string; countryIso: string | null;
  priceNative: number | null; vatPct?: number; feePct?: number;
  profitEur: number | null; marginPct: number | null;
  isPrimary?: boolean; unavailable: string | null;
}
export interface IndividualPricingResult {
  product: { id: string; sku: string; title: string };
  /** Anything that could not be auto-resolved and is therefore excluded from profit. */
  warnings: string[];
  channel: { id: string; name: string; currency: string; countryIso: string | null };
  fxRate: number;
  price: number;
  priceEur: number;
  auto: {
    costEur: number; shippingServiceId: string | null; shippingServiceName: string | null;
    shippingEur: number | null; shippingZone: string | null;
    vatPct: number; taxType: string; taxLabel: string; pointsPct: number; feePct: number; importPct: number;
    actualWeightKg: number | null; volumetricWeightKg: number | null; chargeableWeightKg: number | null;
  };
  applied: { costEur: number; shippingEur: number; importPct: number; feePct: number; vatPct: number; pointsPct: number; taxType: string };
  breakdown: PricingBreakdown;
  comparison: PricingComparisonRow[];
}
export interface IndividualPricingInput {
  productId: string; salesChannelId: string; price: number;
  taxMode?: 'include' | 'zero'; shippingServiceId?: string | null;
  costEur?: number; shippingCostEur?: number; vatPct?: number; feePct?: number; importPct?: number;
}
export interface BulkPricingCell {
  priceNative: number | null; profitEur: number | null; marginPct: number | null; reason: string | null;
}
export interface BulkPricingResult {
  targetMarginPct: number;
  columns: {
    channelId: string; channelName: string; currency: string; countryIso: string | null;
    shippingServiceId: string | null; shippingServiceName: string | null; unavailable: boolean;
  }[];
  rows: { productId: string; sku: string; title: string; costEur: number; cells: BulkPricingCell[] }[];
  productCount: number; channelCount: number;
}
export interface BulkPricingInput {
  mode: 'specific' | 'vendor' | 'brand' | 'type';
  productIds?: string[]; groupId?: string;
  salesChannelIds: string[]; targetMarginPct: number;
  shippingServiceId?: string | null;
  /** salesChannelId -> shippingServiceId; anything absent uses that channel's country default. */
  shippingServiceByChannel?: Record<string, string>;
  shippingCostEur?: number; importPct?: number;
}

export interface ChannelShippingDefault {
  channelId: string; channelName: string; currency: string;
  countryIso: string | null; countryName: string | null;
  defaultServiceId: string | null; defaultServiceName: string | null;
}
export interface PricingGroup { id: string; name: string; productCount: number }

export interface ProductCostEvent {
  id: string;
  reason: 'opening' | 'goods_receipt' | 'vendor_return' | 'adjustment' | string;
  reference: string | null;
  refType: string | null;
  refId: string | null;
  qtyDelta: number;
  unitCostEur: number;
  landedAddOnEur: number;
  goodsUnitEur: number;
  qtyBefore: number;
  avgBeforeEur: number | null;
  qtyAfter: number;
  avgAfterEur: number;
  notes: string | null;
  createdAt: string;
}

export interface SerialNumberRow {
  id: string; serial: string; status: string;
  product: { id: string; mainSku: string; title: string } | null;
  warehouse: { id: string; name: string } | null;
  receivedAt: string | null; dispatchedAt: string | null;
  salesTransactionId: string | null; vendorReturnId: string | null; notes: string | null;
}
export interface AvailableSerial { id: string; serial: string; warehouse: { id: string; name: string } | null; receivedAt: string | null }

export const serialsApi = {
  list: (params: { q?: string; productId?: string; warehouseId?: string; status?: string; page?: number; pageSize?: number }) =>
    api.get<{ rows: SerialNumberRow[]; total: number; page: number; pageSize: number; pageCount: number }>('/serials', { params }).then((r) => r.data),
  available: (productId: string, warehouseId?: string) =>
    api.get<AvailableSerial[]>(`/serials/available/${productId}`, { params: warehouseId ? { warehouseId } : undefined }).then((r) => r.data),
};

export const costingApi = {
  history: (productId: string, limit?: number) =>
    api.get<ProductCostEvent[]>(`/costing/products/${productId}/history`, { params: limit ? { limit } : undefined }).then((r) => r.data),
  uncosted: (limit?: number) =>
    api
      .get<{ id: string; sku: string; title: string; purchaseCostAmount: number | null; seedable: boolean }[]>('/costing/uncosted', {
        params: limit ? { limit } : undefined,
      })
      .then((r) => r.data),
  seedOpening: (body: { productIds?: string[]; dryRun?: boolean }) =>
    api.post<{ dryRun: boolean; seeded?: number; wouldSeed?: number; skippedNonEurCost: number }>('/costing/seed-opening', body).then((r) => r.data),
  lastPurchaseCost: (productId: string) =>
    api.get<LastPurchaseCost>(`/costing/products/${productId}/last-purchase-cost`).then((r) => r.data),
};

export type LastPurchaseCost =
  | { found: false }
  | { found: true; unitCost: number; currency: string; poNumber: string; poId: string; submittedAt: string | null };

export const pricingApi = {
  individual: (body: IndividualPricingInput) =>
    api.post<IndividualPricingResult>('/pricing/individual', body).then((r) => r.data),
  bulk: (body: BulkPricingInput) => api.post<BulkPricingResult>('/pricing/bulk', body).then((r) => r.data),
  channelShippingDefaults: (channelIds: string[]) =>
    api
      .get<ChannelShippingDefault[]>('/pricing/channel-shipping-defaults', { params: { channelIds: channelIds.join(',') } })
      .then((r) => r.data),
  groups: (mode: 'vendor' | 'brand' | 'type') =>
    api.get<PricingGroup[]>('/pricing/groups', { params: { mode } }).then((r) => r.data),
};

// ---- Vendor returns (goods sent back) ----
export interface VendorReturnLine {
  id: string; productId: string; sku: string; productName: string;
  purchaseOrderLineId: string | null; quantity: number; unitCostEur: number; lineCostEur: number;
}
export interface VendorReturn {
  id: string; returnNumber: string; status: string;
  vendor: { id: string; name: string } | null;
  purchaseOrder: { id: string; poNumber: string } | null;
  warehouse: { id: string; name: string } | null;
  reason: string; creditNoteRef: string | null; notes: string | null;
  totalQuantity: number; totalCostEur: number;
  postedAt: string; createdAt: string; lines: VendorReturnLine[];
}
export interface VendorReturnRow {
  id: string; returnNumber: string; status: string;
  vendor: { id: string; name: string } | null;
  purchaseOrder: { id: string; poNumber: string } | null;
  warehouse: { id: string; name: string } | null;
  reason: string; creditNoteRef: string | null;
  totalQuantity: number; totalCostEur: number; lineCount: number; postedAt: string;
}
export interface ReturnableLine {
  purchaseOrderLineId: string; productId: string; sku: string; productName: string;
  quantityReceived: number; quantityReturned: number; returnable: number; averageCostEur: number | null;
}
export interface ReturnablePo {
  purchaseOrderId: string; poNumber: string; vendorId: string;
  warehouseId: string | null; lines: ReturnableLine[];
}
export interface VendorReturnInput {
  vendorId: string; purchaseOrderId?: string; warehouseId: string;
  reason: string; creditNoteRef?: string; notes?: string;
  lines: { productId: string; purchaseOrderLineId?: string; quantity: number }[];
}

export const vendorReturnsApi = {
  list: (params: { q?: string; vendorId?: string; purchaseOrderId?: string; page?: number; pageSize?: number }) =>
    api.get<{ rows: VendorReturnRow[]; total: number; page: number; pageSize: number; pageCount: number }>('/vendor-returns', { params }).then((r) => r.data),
  get: (id: string) => api.get<VendorReturn>(`/vendor-returns/${id}`).then((r) => r.data),
  returnable: (purchaseOrderId: string) => api.get<ReturnablePo>(`/vendor-returns/returnable/${purchaseOrderId}`).then((r) => r.data),
  create: (body: VendorReturnInput) => api.post<VendorReturn>('/vendor-returns', body).then((r) => r.data),
};

/** Admin amendment of an already-received purchase order. */
export interface AmendLineInput {
  purchaseOrderLineId?: string; productId: string; quantityOrdered: number; unitCost: number; notes?: string | null;
}

// ---- Expenses ----
export interface ExpenseCategory { id: string; name: string; parentId: string | null }
export interface ExpenseCategoryNode extends ExpenseCategory {
  depth: number; definitionCount: number; rollupDefinitionCount: number; children: ExpenseCategoryNode[];
}
export const expenseCategoriesApi = {
  list: () => api.get<ExpenseCategory[]>('/expense-categories').then((r) => r.data),
  tree: () => api.get<ExpenseCategoryNode[]>('/expense-categories/tree').then((r) => r.data),
  create: (body: { name: string; parentId?: string | null }) => api.post<ExpenseCategory>('/expense-categories', body).then((r) => r.data),
  update: (id: string, body: { name?: string; parentId?: string | null }) => api.patch<ExpenseCategory>(`/expense-categories/${id}`, body).then((r) => r.data),
  remove: (id: string) => api.delete<{ deleted: boolean }>(`/expense-categories/${id}`).then((r) => r.data),
};

export type ExpenseOccurrence = 'monthly' | 'annual' | 'once_off';
export interface ExpenseDefinition {
  id: string; code: string; name: string; categoryId: string | null; categoryName: string | null;
  defaultOccurrence: ExpenseOccurrence | null; isActive: boolean;
}
export interface ExpenseDefinitionInput {
  name: string; categoryId?: string | null; defaultOccurrence?: ExpenseOccurrence | null; isActive?: boolean;
}
export const expenseDefinitionsApi = {
  list: (params: { q?: string; categoryId?: string; includeInactive?: boolean } = {}) =>
    api.get<ExpenseDefinition[]>('/expense-definitions', { params }).then((r) => r.data),
  create: (body: ExpenseDefinitionInput) => api.post<ExpenseDefinition>('/expense-definitions', body).then((r) => r.data),
  update: (id: string, body: Partial<ExpenseDefinitionInput>) => api.patch<ExpenseDefinition>(`/expense-definitions/${id}`, body).then((r) => r.data),
  remove: (id: string) => api.delete<{ deleted: boolean; deactivated: boolean }>(`/expense-definitions/${id}`).then((r) => r.data),
};

export interface Expense {
  id: string; definitionId: string; definitionCode: string | null; definitionName: string; categoryId: string | null; categoryName: string | null;
  companyId: string; occurrence: ExpenseOccurrence; currency: string;
  startMonth: string; endMonth: string | null; onceOffDate: string | null;
  status: 'active' | 'cancelled'; note: string | null; hasSchedule: boolean; registeredAt: string | null;
  tagId: string | null; tagName: string | null; tagGroup: string | null;
  currentAmount: number; currentAmountEur: number; fxRate: number;
  monthlyEur: number; annualEur: number;
}
export interface CreateExpenseInput {
  definitionId: string; companyId: string; occurrence: ExpenseOccurrence; currency?: string;
  amount: number; startMonth?: string; onceOffDate?: string; note?: string | null; tagId?: string | null;
}
export interface UpdateExpenseInput {
  definitionId?: string; occurrence?: ExpenseOccurrence; currency?: string; amount?: number;
  startMonth?: string; onceOffDate?: string; note?: string | null; tagId?: string | null;
}

export interface ExpenseTag { id: string; name: string; group: string | null; description: string | null; isActive: boolean }
export interface ExpenseTagInput { name: string; group?: string | null; description?: string | null; isActive?: boolean }
export const expenseTagsApi = {
  list: (params: { q?: string; group?: string; includeInactive?: boolean } = {}) => api.get<ExpenseTag[]>('/expense-tags', { params }).then((r) => r.data),
  groups: () => api.get<string[]>('/expense-tags/groups').then((r) => r.data),
  create: (body: ExpenseTagInput) => api.post<ExpenseTag>('/expense-tags', body).then((r) => r.data),
  update: (id: string, body: Partial<ExpenseTagInput>) => api.patch<ExpenseTag>(`/expense-tags/${id}`, body).then((r) => r.data),
  remove: (id: string) => api.delete<{ deleted: boolean; deactivated: boolean }>(`/expense-tags/${id}`).then((r) => r.data),
};
export interface ExpenseMonthRow {
  expenseId: string; definitionCode: string | null; definitionName: string; categoryName: string | null;
  occurrence: ExpenseOccurrence; currency: string; status: 'active' | 'cancelled';
  baseAmount: number; baseAmountEur: number; monthNative: number; monthEur: number; hasOverride: boolean;
}
export interface ExpenseMonthly { month: string; totalEur: number; count: number; items: ExpenseMonthRow[] }
export interface ExpenseAnnual { year: number; totalEur: number; breakdown: { month: string; totalEur: number }[] }
export type AmountScope = 'this_month' | 'all_following';

export const expensesApi = {
  list: (params: { companyId?: string; includeCancelled?: boolean } = {}) => api.get<Expense[]>('/expenses', { params }).then((r) => r.data),
  get: (id: string) => api.get<Expense>(`/expenses/${id}`).then((r) => r.data),
  create: (body: CreateExpenseInput) => api.post<Expense>('/expenses', body).then((r) => r.data),
  update: (id: string, body: UpdateExpenseInput) => api.patch<Expense>(`/expenses/${id}`, body).then((r) => r.data),
  cancel: (id: string, month?: string) => api.post<Expense>(`/expenses/${id}/cancel`, { month }).then((r) => r.data),
  monthly: (month: string, companyId?: string) => api.get<ExpenseMonthly>('/expenses/monthly', { params: { month, companyId } }).then((r) => r.data),
  annual: (year: number, companyId?: string) => api.get<ExpenseAnnual>('/expenses/annual', { params: { year, companyId } }).then((r) => r.data),
  setAmount: (id: string, body: { month: string; amount: number; scope: AmountScope }) => api.post<Expense>(`/expenses/${id}/amount`, body).then((r) => r.data),
  importValidate: (rows: Record<string, string>[]) =>
    api.post<{ rows: ExpenseImportRowResult[] }>('/expenses/import/validate', { rows }).then((r) => r.data),
  importCommit: (rows: Record<string, string>[], companyId: string) =>
    api.post<{ created: number; skipped: number; errors: { name: string; message: string }[] }>('/expenses/import/commit', { rows, companyId }).then((r) => r.data),
};
export interface ExpenseImportRowResult {
  index: number; name: string; status: 'new' | 'error'; occurrence: ExpenseOccurrence | null;
  willCreateDefinition: boolean; willCreateCategory: boolean; willCreateTag: boolean;
  issues: { field: string; message: string; severity: 'error' | 'warning' }[];
}
