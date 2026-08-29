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
  /**
   * What this company's Amazon integrations may be used for.
   *
   * 'orders' — connected to pull order history only. Repricing and channel listings are hidden and
   * the API refuses them; the two seller accounts must never have work done against the wrong one.
   */
  amazonScope?: 'full' | 'orders';
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
  /** Currency this vendor invoices in — new POs and uploaded price files default to it. */
  currency?: string;
  /** Whether this vendor's quoted MAP / suggested retail already contains VAT. */
  mapIncludesVat?: boolean;
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
export interface Brand {
  id: string;
  name: string;
  website?: string | null;
  /** GPSR contacts. Held on the brand because they describe a company, not a product. */
  manufacturerName?: string | null;
  manufacturerAddress?: string | null;
  manufacturerEmail?: string | null;
  manufacturerPhone?: string | null;
  manufacturerContactUrl?: string | null;
  euRpName?: string | null;
  euRpAddress?: string | null;
  euRpEmail?: string | null;
  euRpPhone?: string | null;
  euRpContactUrl?: string | null;
}
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
  /** What a new marketplace listing launches at, as a percentage margin. */
  launchMarginPct: number;
  /** Whether creating real marketplace listings is permitted. Off by default. */
  listingLiveWrites: boolean;
  /** Whether the platform may CHANGE quantities / prices on the marketplaces. On by default. */
  channelQuantityPushEnabled: boolean;
  channelPricePushEnabled: boolean;
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
  /** Starts a run and returns the job to follow — the result arrives on the job when it finishes. */
  sync: (integrationIds?: string[]) =>
    api.post<JobView>('/channel-listings/sync', integrationIds?.length ? { integrationIds } : {}).then((r) => r.data),
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
  /** Products that are IN availability. A product absent from it is not listed here at all. */
  list: (params: { q?: string; brandId?: string; vendorId?: string; productTypeId?: string; page?: number; pageSize?: number } = {}) =>
    api.get<AvailabilityListResponse>('/availability', { params }).then((r) => r.data),
  // Every product id matching the filter — backs "select all N across pages".
  ids: (params: { q?: string; brandId?: string; vendorId?: string; productTypeId?: string } = {}) =>
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
export interface ComplianceOptionLite { id: string; code: string; label: string }

/** One entry in a compliance vocabulary. `kind` names the list it belongs to. */
export interface ComplianceOption extends ComplianceOptionLite {
  kind: string;
  /** Only voltage ratings carry a range; it is what the eligibility rules compare. */
  numericMin: number | null;
  numericMax: number | null;
  note: string | null;
  sortOrder: number;
  active: boolean;
}

export const complianceOptionsApi = {
  kinds: () => api.get<{ kind: string; label: string }[]>('/compliance-options/kinds').then((r) => r.data),
  list: (kind?: string, includeInactive = false) =>
    api.get<ComplianceOption[]>('/compliance-options', { params: { kind, includeInactive: includeInactive || undefined } }).then((r) => r.data),
  usage: (id: string) => api.get<{ id: string; products: number }>(`/compliance-options/${id}/usage`).then((r) => r.data),
  create: (dto: Partial<ComplianceOption>) => api.post<ComplianceOption>('/compliance-options', dto).then((r) => r.data),
  update: (id: string, dto: Partial<ComplianceOption>) => api.patch<ComplianceOption>(`/compliance-options/${id}`, dto).then((r) => r.data),
  /** Retires rather than deletes when products still reference it. */
  remove: (id: string) => api.delete<{ ok: boolean; retired: boolean; inUse: number }>(`/compliance-options/${id}`).then((r) => r.data),
};

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

  // Listing content. Only eBay and Shopify ever display any of it.
  ebayTitle: string | null;
  descriptionHtml: string | null;
  keyFeatures: string[];
  searchKeywords: string | null;

  // Technical facts, chosen from the compliance vocabulary rather than typed. The id is what the
  // form binds to; the resolved option rides along so a label can be shown without a second call.
  voltageRatingId: string | null;
  frequencyId: string | null;
  plugTypeId: string | null;
  batteryRequired: boolean | null;
  batteryTypeId: string | null;
  hazmatClassId: string | null;
  voltageRating: ComplianceOptionLite | null;
  frequency: ComplianceOptionLite | null;
  plugTypeRef: ComplianceOptionLite | null;
  batteryTypeRef: ComplianceOptionLite | null;
  hazmatClassRef: ComplianceOptionLite | null;

  warrantyText: string | null;
  dangerousGoodsNote: string | null;

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
  /** Owning company. Channel names repeat across companies ("Amazon AUS" under two entities),
   *  so pickers must disambiguate by owner or the wrong one is chosen silently. */
  company?: { id: string; officialName: string } | null;
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
  pricesIncludeTax: boolean;
  /** How far below the market rate this channel converts, as a percentage. */
  fxSpreadPct?: number | null;
  fxSpreadNote?: string | null;
  fxSpreadSetAt?: string | null;
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

/** Result of registering SP-API notification subscriptions to the SQS destination. */
export interface SpApiNotificationSetup {
  ok: boolean;
  destinationId?: string;
  results: Array<{ type: string; ok: boolean; message: string }>;
  message?: string;
}

export const integrationsApi = {
  /** Create the keypair eBay requires to sign Finances requests. */
  createEbaySigningKey: (integrationId: string) =>
    api.post<{ ok: boolean; created: boolean; signingKeyId: string | null; message?: string }>(`/integrations/${integrationId}/ebay/signing-key`).then((r) => r.data),
  /** Read-only: what eBay reports for one order's money fields. */
  ebayOrderMoney: (integrationId: string, orderId: string) =>
    api.get<EbayOrderMoney>(`/integrations/${integrationId}/ebay/order-money`, { params: { orderId } }).then((r) => r.data),
  connectors: () => api.get<ConnectorDef[]>('/integrations/connectors').then((r) => r.data),
  list: () => api.get<ChannelIntegration[]>('/integrations').then((r) => r.data),
  get: (id: string) => api.get<ChannelIntegration>(`/integrations/${id}`).then((r) => r.data),
  create: (body: { name: string; channelType: string; marketplace?: string | null; config?: Record<string, string>; secrets?: Record<string, string> }) =>
    api.post<ChannelIntegration>('/integrations', body).then((r) => r.data),
  update: (id: string, body: { name?: string; marketplace?: string | null; config?: Record<string, string>; secrets?: Record<string, string>; status?: 'active' | 'disabled'; targetSalesChannelId?: string | null; targetCompanyId?: string | null; autoSyncEnabled?: boolean; backfillDays?: number }) =>
    api.patch<ChannelIntegration>(`/integrations/${id}`, body).then((r) => r.data),
  sync: (id: string, range?: { from: string; to?: string }) => api.post<IntegrationSyncResult>(`/integrations/${id}/sync`, range ?? {}).then((r) => r.data),
  test: (id: string, mode: 'live' | 'test') => api.post<IntegrationTestResult>(`/integrations/${id}/test`, { mode }).then((r) => r.data),
  /** One-time: subscribe this marketplace's SP-API notifications to the SQS queue (repricing §2.2).
   *  This WRITES to Amazon (creates a destination + subscriptions), so it is user-triggered only. */
  setupSpApiNotifications: (id: string, sqsArn: string, types?: string[]) =>
    api.post<SpApiNotificationSetup>(`/integrations/${id}/spapi-notifications/setup`, { sqsArn, types }).then((r) => r.data),
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
  /** The named strategy this SKU follows; null means the global default. */
  preset?: { id: string; name: string } | null;
  id: string;
  sku: string;
  asin: string | null;
  marketplaceId: string;
  /** The marketplace's own currency. Breakeven/floor/current are all denominated in THIS, not EUR. */
  currency: string;
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
/** End-to-end shadow-pipeline health: SQS -> notifications -> snapshots -> decisions. */
export interface RepricingPipelineStatus {
  diagnosis: string;
  sqs: { poller: string; reason?: string; env?: Record<string, boolean>; messages?: { receivedSinceBoot: number; discardedSinceBoot: number; lastMessageAt: string | null; lastReceiveError: string | null }; queue?: { reachable: boolean; approximateMessages?: number; inFlight?: number; error?: string } };
  notifications: { dedupedLast24h: number };
  snapshots: { total: number; last24h: number; mostRecent: { asin: string; marketplaceId: string; updatedAt: string } | null };
  decisions: { total: number; last24h: number; mostRecent: { sku: string; outcome: string; at: string } | null };
  skus: { onboarded: number; shadow: number };
}
/** What Amazon has actually registered: destinations it publishes to + live subscriptions. */
export interface RepricingSubscriptionStatus {
  ok?: boolean;
  message?: string;
  integration?: string;
  marketplace?: string | null;
  pollerQueueUrl: string | null;
  expectedQueueArn?: string | null;
  destinations?: Array<{ destinationId: string; name: string; sqsArn: string | null }>;
  subscriptions?: Array<{ type: string; subscribed: boolean; subscriptionId: string | null; destinationId: string | null; message?: string }>;
}
export interface RepricingMarketplaceQueue {
  marketplace: string | null;
  region: 'na' | 'eu' | 'fe' | null;
  queueUrl: string | null;
  queueArn: string | null;
  envVar: string | null;
  configured: boolean;
  message: string | null;
}
export interface RepricingSkuPricingPage {
  items: RepricingSkuRow[];
  total: number;
  page: number;
  pageSize: number;
}
export interface RepricingQuarantineRow {
  id: string;
  sku: string;
  asin: string | null;
  marketplaceId: string;
  currency: string;
  strategy: string;
  strategyFloorCents: number | null;
  maxPriceCents: number | null;
  fairPricingCeilingCents: number | null;
  updatedAt: string;
  /** The conflict that took it off automation, from the decision that quarantined it. */
  reason?: string | null;
}
export interface RepricingQuarantine {
  /** The whole queue, not the page — this drives the escalation flag and the tab badge. */
  total: number;
  oldestHours: number;
  page: number;
  pageSize: number;
  items: RepricingQuarantineRow[];
}
export interface RepricingDecisionPage {
  items: RepricingDecisionRow[];
  total: number;
  page: number;
  pageSize: number;
}
/** Read-only SP-API role pre-flight per Amazon connection (Pricing + Notifications).
 *  `state` separates a real authorisation failure ('denied') from a probe that couldn't conclude. */
export type RoleState = 'granted' | 'denied' | 'inconclusive';
export interface RoleProbe { ok: boolean; state: RoleState; message: string }
export interface RepricingRoleCheck {
  integrationId: string;
  name: string;
  marketplace: string | null;
  ok: boolean;
  pricing: RoleProbe;
  notifications: RoleProbe;
}
export interface RepricingRoleDiagnostics {
  total: number;
  pricingOk: number;
  notificationsOk: number;
  results: RepricingRoleCheck[];
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

/**
 * A long-running action's progress. Onboarding and floor recomputation return one of these
 * immediately and keep working server-side; the browser polls until it settles.
 */
export interface JobView {
  id: string;
  kind: string;
  label: string;
  state: 'running' | 'done' | 'error';
  /** null until the run knows how many items it has. */
  total: number | null;
  done: number;
  ok: number;
  failed: number;
  startedAt: string;
  finishedAt: string | null;
  message: string | null;
  etaSeconds: number | null;
  result: unknown | null;
  error: string | null;
}

export const jobsApi = {
  get: (id: string) => api.get<JobView>(`/jobs/${id}`).then((r) => r.data),
  cancel: (id: string) => api.post<{ cancelled: boolean }>(`/jobs/${id}/cancel`, {}).then((r) => r.data),
};

export interface OnboardResult {
  scannedListings: number; created: number; updated: number; skipped: number;
  unmatchedListings: number; totalListings: number;
}
export interface RecomputeResult { processed: number; ok: number; stopped?: boolean }

// ---- Listing preparation (no marketplace writes) --------------------------

export interface MarketplaceProfile {
  id: string;
  channelType: string;
  marketplace: string;
  label: string;
  mainsVoltageMinV: number | null;
  mainsVoltageMaxV: number | null;
  mainsFrequencyHz: string | null;
  plugTypes: string[];
  requiresGpsrContacts: boolean;
  active: boolean;
  note: string | null;
}

/** One thing a listing cannot go without. Everything the API reports here is required. */
export interface ReadinessGap {
  key: string;
  label: string;
}
export interface ReadinessVerdict {
  ready: boolean;
  missing: ReadinessGap[];
  satisfiedCount: number;
  totalCount: number;
}

/** Why a product may not be sold somewhere. A block cannot be typed away. */
export interface EligibilityFinding {
  code: 'VOLTAGE' | 'PLUG' | 'FREQUENCY' | 'HAZMAT';
  severity: 'block' | 'warn';
  reason: string;
}
export interface EligibilityVerdict {
  eligible: boolean;
  findings: EligibilityFinding[];
  unchecked: string[];
  /** No profile exists for this market, so nothing was judged — not the same as a pass. */
  noProfile?: boolean;
}

export interface ChannelPlan {
  id: string;
  categoryRef: string | null;
  categoryName: string | null;
  aspects: unknown;
  condition: string;
  handlingTimeDays: number | null;
  /** Launch price in the marketplace's currency, minor units. Null = nobody has decided yet. */
  offerPriceCents: number | null;
  deliveryTemplate: string | null;
  boostPct: number;
  /** DRAFT | READY | SUBMITTED | ARCHIVED. SUBMITTED means sent to the channel, not yet confirmed. */
  status: string;
  externalListingId: string | null;
  listedAt: string | null;
}

export interface ProductChannelRow {
  integrationId: string;
  name: string;
  channelType: string;
  marketplace: string;
  integrationStatus: string;
  plan: ChannelPlan | null;
  readiness: ReadinessVerdict;
  eligibility: EligibilityVerdict;
  /** eBay's required item specifics are not checked yet — the schemas arrive with Phase 4. */
  aspectsPending: boolean;
  /** How many units an offer here would carry, and where that number came from. */
  quantity: {
    value: number | null;
    source: 'availability' | 'this-listing' | 'sibling-listing' | 'none';
    /** The marketplace the figure was borrowed from, when it was. */
    from: string | null;
  };
  /** Set when the channel sync has already pulled a live listing for this product here. */
  listing: {
    channelSku: string;
    asin: string | null;
    externalListingId: string | null;
    price: number | null;
    currency: string | null;
    quantity: number | null;
    status: string | null;
    lastPulledAt: string | null;
  } | null;
}

export interface ProductChannels {
  productId: string;
  brand: { id: string; name: string; manufacturerName: string | null; euRpName: string | null } | null;
  channels: ProductChannelRow[];
  summary: { eligible: number; ready: number; blocked: number; listed: number; total: number };
}

export interface AmazonCandidate {
  asin: string;
  productType: string | null;
  title: string | null;
  brand: string | null;
  imageUrl: string | null;
  /** null when the restriction check itself failed — unknown is not the same as allowed. */
  restricted: boolean | null;
  restrictionReasons: Array<{ message: string; reasonCode: string | null; linkUrl: string | null }>;
  restrictionError: string | null;
  /** True when this SKU is already bound to a different ASIN. Amazon refuses the mismatch. */
  conflictsWithBound: boolean;
}

export interface AmazonCandidates {
  productId: string;
  /** Which identifier the search used. Null when the product has neither an EAN nor a UPC. */
  searchedBy: { type: 'EAN' | 'UPC'; value: string } | null;
  candidates: AmazonCandidate[];
  /**
   * The ASIN this SKU already uses on other marketplaces, and where.
   *
   * Amazon requires one SKU to map to one ASIN everywhere, and refuses a submission that breaks it.
   */
  boundAsin: string | null;
  boundOn: string[];
  message: string | null;
}

/**
 * Amazon offer creation. Only `submit` writes anything, and it refuses unless the server allows
 * live writes and the caller confirms; everything else asks Amazon questions or validates.
 */
/** One thing Amazon objected to. ERROR blocks the submission; WARNING does not. */
export interface AmazonIssue {
  code: string;
  message: string;
  severity: string;
  attributeNames: string[];
}

export interface AmazonOfferPreview {
  sku: string;
  asin: string;
  productType: string;
  marketplace: string;
  channelName: string;
  /** The attributes as they would be sent. Shown verbatim — this is the payload, not a summary. */
  attributes: Record<string, unknown>;
  /** Our own gaps, found before Amazon is asked. */
  missing: { key: string; label: string }[];
  eligible: boolean;
  eligibilityReasons: string[];
  liveWritesEnabled: boolean;
  /** True when Amazon accepted the payload in validation. */
  validated: boolean;
  submissionStatus: string | null;
  issues: AmazonIssue[];
  message: string | null;
}

export interface AmazonSweepRow {
  integrationId: string;
  name: string;
  marketplace: string;
  found: boolean;
  asin: string | null;
  productType: string | null;
  title: string | null;
  /** null when the restriction check itself failed — unknown is not the same as allowed. */
  restricted: boolean | null;
  restrictionReason: string | null;
  error: string | null;
  /** We already sell here. Not an opportunity, and not something to list again. */
  alreadyListed: boolean;
  listedSku: string | null;
  /** The currency every money figure on this row is in. A marketplace has exactly one. */
  currency: string;
  /** Present only when the sweep was asked to price. The featured offer is the one that sells. */
  featuredPriceCents: number | null;
  featuredProfitCents: number | null;
  featuredMarginPct: number | null;
  lowestPriceCents: number | null;
  /** True when we could win the Buy Box at a profit; false when we could not; null if unpriced. */
  competitive: boolean | null;
}

export interface AmazonSweep {
  productId: string;
  results: AmazonSweepRow[];
  summary: {
    searched: number;
    found: number;
    alreadyListed: number;
    /** Found, allowed, and NOT already listed — the only number that is an opportunity. */
    sellable: number;
    restricted: number;
    notFound: number;
    failed: number;
    competitive: number;
    uncompetitive: number;
  };
}

/** A launch price and what it earns, from the same engine the repricing floors use. */
export type AmazonQuote =
  | { ok: false; reason: string }
  | {
      ok: true;
      breakevenCents: number;
      suggestedCents: number;
      currency: string;
      marginPct: number;
      at: Array<{ priceCents: number; profitCents: number; marginPct: number; aboveBreakeven: boolean }>;
      inputs: {
        cogsLandedCents: number;
        fixedPerUnitCents: number;
        fbaFulfillmentFeeCents: number;
        closingFeeCents: number;
        vatRatePct: number;
        returnsRatePct: number;
      };
    };

export interface AmazonSubmitResult {
  ok: boolean;
  sku: string;
  asin: string;
  /** ACCEPTED means Amazon took the submission, not that the listing is live. */
  submissionStatus: string | null;
  issues: AmazonIssue[];
  message: string | null;
}

export interface AmazonListingState {
  ok: boolean;
  exists: boolean;
  /** BUYABLE means a valid offer exists. DISCOVERABLE means the product is there but not sellable. */
  listingStatus: string | null;
  asin: string | null;
  issues: { code: string; message: string; severity: string }[];
  /** What Amazon actually holds for this SKU — not necessarily what we sent. */
  attributes?: Record<string, unknown>;
  offers?: Array<Record<string, unknown>>;
  message?: string;
}

/** Amazon's own reference prices, each with what it would make or lose us. */
export type AmazonCompetition =
  | { ok: false; reason: string }
  | {
      ok: true;
      currency: string;
      offerCount: number | null;
      suggestedCents: number;
      breakevenCents: number;
      marginPct: number;
      prices: Array<{
        kind: 'featured' | 'competitive' | 'lowest';
        label: string;
        /** Null when Amazon has no such price for this ASIN. */
        priceCents: number | null;
        profitCents: number | null;
        profitMarginPct: number | null;
        aboveBreakeven: boolean | null;
      }>;
    };

export const amazonListingApi = {
  status: () => api.get<{ liveWritesEnabled: boolean }>('/listing/amazon/status').then((r) => r.data),
  candidates: (productId: string, integrationId: string) =>
    api.get<AmazonCandidates>(`/listing/amazon/products/${productId}/channels/${integrationId}/candidates`).then((r) => r.data),
  /** Searches every Amazon marketplace. Slow, so it returns a job to follow. */
  sweep: (productId: string, withPricing = false) =>
    api.post<JobView>(`/listing/amazon/products/${productId}/sweep`, { withPricing }).then((r) => r.data),
  /** The launch price here, and what a given price would earn. */
  quote: (productId: string, integrationId: string, atPricesCents?: number[]) =>
    api.post<AmazonQuote>(`/listing/amazon/products/${productId}/channels/${integrationId}/quote`, { atPricesCents }).then((r) => r.data),
  /** What the competition charges, and what each of those prices would earn us. Read-only. */
  competition: (productId: string, integrationId: string) =>
    api.get<AmazonCompetition>(`/listing/amazon/products/${productId}/channels/${integrationId}/competition`).then((r) => r.data),
  /**
   * Creates the offer for real. The only call in this module a customer can see the result of —
   * refused unless the server permits listing writes and `confirm` is set.
   */
  submit: (productId: string, integrationId: string) =>
    api.post<AmazonSubmitResult>(`/listing/amazon/products/${productId}/channels/${integrationId}/submit`, { confirm: true }).then((r) => r.data),
  /** What Amazon says about the listing now. Accepted is not the same as live. */
  state: (productId: string, integrationId: string) =>
    api.get<AmazonListingState>(`/listing/amazon/products/${productId}/channels/${integrationId}/state`).then((r) => r.data),
  /** Builds the offer and has Amazon validate it. Creates nothing. */
  preview: (productId: string, integrationId: string) =>
    api.post<AmazonOfferPreview>(`/listing/amazon/products/${productId}/channels/${integrationId}/preview`, {}).then((r) => r.data),
};

export const listingApi = {
  marketplaceProfiles: () => api.get<MarketplaceProfile[]>('/listing/marketplace-profiles').then((r) => r.data),
  updateMarketplaceProfile: (id: string, patch: Partial<MarketplaceProfile>) =>
    api.patch<MarketplaceProfile>(`/listing/marketplace-profiles/${id}`, patch).then((r) => r.data),
  productChannels: (productId: string) =>
    api.get<ProductChannels>(`/listing/products/${productId}/channels`).then((r) => r.data),
  upsertPlan: (productId: string, integrationId: string, patch: Partial<ChannelPlan>) =>
    api.put<ChannelPlan>(`/listing/products/${productId}/channels/${integrationId}`, patch).then((r) => r.data),
  removePlan: (productId: string, integrationId: string, marketplace: string) =>
    api.delete<{ removed: boolean }>(`/listing/products/${productId}/channels/${integrationId}`, { params: { marketplace } }).then((r) => r.data),
};

export const repricingApi = {
  marketplaceCosts: () => api.get<RepricingMarketplaceCosts[]>('/amazon-repricing/marketplace-costs').then((r) => r.data),
  setMarketplaceCosts: (body: { marketplace: string; storageApplies?: boolean; adsApply?: boolean; defaultStoragePerUnitCents?: number | null; defaultAdCostPerUnitCents?: number | null }) =>
    api.post('/amazon-repricing/marketplace-costs', body).then((r) => r.data),
  strategies: () => api.get<RepricingStrategyPreset[]>('/amazon-repricing/strategies').then((r) => r.data),
  assignStrategy: (body: {
    presetId: string; apply?: boolean;
    skuPricingIds?: string[]; marketplace?: string;
    brandId?: string; vendorId?: string; productTypeId?: string; q?: string;
  }) =>
    api.post<StrategyAssignResult>('/amazon-repricing/strategies/assign', body).then((r) => r.data),
  /** Read-only: every input behind one SKU's floor, and what the floor leaves out. */
  explainFloor: (sku: string, marketplace?: string) =>
    api.get<FloorExplain>('/amazon-repricing/diagnostics/floor', { params: { sku, marketplace } }).then((r) => r.data),
  readiness: () => api.get<RepricingReadiness>('/amazon-repricing/readiness').then((r) => r.data),
  getControl: () => api.get<RepricingControl>('/amazon-repricing/control').then((r) => r.data),
  setControl: (patch: Partial<RepricingControl>) => api.post<RepricingControl>('/amazon-repricing/control', patch).then((r) => r.data),
  blocklist: () => api.get<BlockedSeller[]>('/amazon-repricing/blocklist').then((r) => r.data),
  addBlocked: (dto: { sellerId: string; marketplaceId?: string | null; sellerName?: string | null; reason?: string | null; brand?: string | null }) =>
    api.post<BlockedSeller>('/amazon-repricing/blocklist', dto).then((r) => r.data),
  removeBlocked: (id: string) => api.delete<{ removed: boolean }>(`/amazon-repricing/blocklist/${id}`).then((r) => r.data),
  /** `marketplace` (ISO-2, e.g. 'UK') scopes the run — omit to cover every connected marketplace. */
  onboard: (marketplace?: string) =>
    api.post<JobView>('/amazon-repricing/onboard', { marketplace }).then((r) => r.data),
  /** Makes ONE live SP-API call per SKU — scope by marketplace and cap with `limit` while piloting. */
  recomputeFloors: (marketplace?: string, limit?: number) =>
    api.post<JobView>('/amazon-repricing/floors/recompute', { marketplace, limit }).then((r) => r.data),
  /** Paged + filterable: onboarding seeds thousands of rows, so reaching one SKU needs both. */
  skuPricing: (params: { take?: number; skip?: number; q?: string; marketplace?: string; brandId?: string; vendorId?: string; state?: string } = {}) =>
    api
      .get<RepricingSkuPricingPage>('/amazon-repricing/sku-pricing', {
        params: {
          take: params.take ?? 100,
          skip: params.skip ?? 0,
          q: params.q || undefined,
          marketplace: params.marketplace || undefined,
          brandId: params.brandId || undefined,
          vendorId: params.vendorId || undefined,
          state: params.state || undefined,
        },
      })
      .then((r) => r.data),
  decisions: (params: { take?: number; skip?: number; sku?: string; outcome?: string } = {}) =>
    api
      .get<RepricingDecisionPage>('/amazon-repricing/decisions', {
        params: { take: params.take ?? 100, skip: params.skip ?? 0, sku: params.sku || undefined, outcome: params.outcome || undefined },
      })
      .then((r) => r.data),
  quarantine: (params: { take?: number; skip?: number } = {}) =>
    api
      .get<RepricingQuarantine>('/amazon-repricing/quarantine', { params: { take: params.take ?? 50, skip: params.skip ?? 0 } })
      .then((r) => r.data),
  resolveQuarantine: (id: string) => api.post<{ resolved: boolean }>(`/amazon-repricing/quarantine/${id}/resolve`, {}).then((r) => r.data),
  roleDiagnostics: () => api.get<RepricingRoleDiagnostics>('/amazon-repricing/diagnostics/roles').then((r) => r.data),
  pipelineStatus: () => api.get<RepricingPipelineStatus>('/amazon-repricing/diagnostics/pipeline').then((r) => r.data),
  queueForMarketplace: (marketplace?: string) =>
    api.get<RepricingMarketplaceQueue>('/amazon-repricing/diagnostics/queue', { params: { marketplace } }).then((r) => r.data),
  subscriptionStatus: (marketplace?: string) =>
    api.get<RepricingSubscriptionStatus>('/amazon-repricing/diagnostics/subscriptions', { params: { marketplace: marketplace || undefined } }).then((r) => r.data),
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
  /** True while the FBA fulfilment fee is our estimate (Amazon settles it ~2 weeks after the sale). */
  fbaFeeEstimated: boolean;
  returnShippingCost: number;
  dutyImportCost: number;
  /** 'partial' = some outbound shipments recorded, but not yet marked fully shipped. */
  fulfilmentStatus: 'pending' | 'partial' | 'shipped' | 'cancelled';
  /** Outbound shipments recorded against this order so far. */
  outboundShipmentCount: number;
  channelShipmentStatus: 'shipped' | 'not_shipped' | null;
  resolution: 'none' | 'cancelled' | 'returned' | 'replaced';
  /**
   * For a cancelled order, when it was cancelled.
   *
   * 'pending' — cancelled while Amazon still had it Pending, so it never became an order: no
   * payment taken, nothing shipped, nothing to resolve. 'placed' — a confirmed order cancelled
   * before dispatch. Null on rows cancelled before we recorded this, and on channels that do
   * not report it.
   */
  cancelStage: 'pending' | 'placed' | null;
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
/**
 * 'fba' appears only in the shipments log, and only when includeFba is asked for.
 *
 * It is a settled FBA shipment folded in from a separate model: stock moving to Amazon, with no
 * sales transaction behind it. Anything that treats a row as an order shipment must exclude it.
 */
export type ShipmentType = 'outbound' | 'inbound' | 'fba';
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
  /** includeFba folds settled FBA shipments into the log — they have no transaction behind them. */
  list: (params: { q?: string; companyId?: string; salesChannelId?: string; type?: string; sortDir?: 'asc' | 'desc'; page?: number; pageSize?: number; includeFba?: boolean }) =>
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
  /** Every SKU this row covers — one product, however many labels it shipped under. */
  skus?: string[];
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
  /** confirm settles the shipment in the same call — the cost is what permits it. */
  setActualCost: (id: string, actualCostEur: number, confirm = false) => api.patch<FbaShipment>(`/fba-shipments/${id}/actual-cost`, { actualCostEur, confirm }).then((r) => r.data),
  remove: (id: string) => api.delete(`/fba-shipments/${id}`).then((r) => r.data),
  skuCosts: (params: { q?: string; salesChannelId?: string }) =>
    api.get<FbaSkuCost[]>('/fba-shipments/sku-costs', { params }).then((r) => r.data),
  importShipments: (rows: Record<string, string>[]) =>
    api.post<{ created: number; shipments: number; errors: { fbaRef: string; message: string }[] }>('/fba-shipments/import', { rows }).then((r) => r.data),
  /**
   * Re-resolve stored SKUs against the catalogue as it stands now and redo the allocation.
   *
   * Without confirm it reports what WOULD change and writes nothing. With confirm it returns a job.
   */
  recalculateAll: (confirm = false) =>
    api.post<FbaRecalcDryRun & { id?: string }>('/fba-shipments/recalculate-all', { confirm }).then((r) => r.data),

  // Fulfilment pools — which channels share one body of inbound stock.
  listPools: () => api.get<FbaPool[]>('/fba-shipments/pools').then((r) => r.data),
  createPool: (body: FbaPoolInput) => api.post<FbaPool>('/fba-shipments/pools', body).then((r) => r.data),
  updatePool: (id: string, body: FbaPoolInput) => api.patch<FbaPool>(`/fba-shipments/pools/${id}`, body).then((r) => r.data),
  removePool: (id: string) => api.delete(`/fba-shipments/pools/${id}`).then((r) => r.data),
};

/**
 * A set of sales channels sharing one pool of inbound stock — Amazon's Pan-European FBA and
 * anything like it. Stock is shipped to one marketplace and sells on another, so cost recorded
 * against the receiving channel has to be available to the selling one.
 */
export interface FbaPool {
  id: string;
  companyId: string | null;
  name: string;
  active: boolean;
  /** Judged against the ORDER date, so orders from before the arrangement keep their own figure. */
  effectiveFrom: string | null;
  effectiveTo: string | null;
  channels: { salesChannelId: string; name: string | null; receives: boolean; sells: boolean }[];
}
export interface FbaPoolInput {
  name?: string;
  active?: boolean;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  /** Omitted on an update leaves the membership alone; sent, it replaces it wholesale. */
  channels?: { salesChannelId: string; receives: boolean; sells: boolean }[];
}
export interface FbaRecalcDryRun {
  dryRun: boolean;
  shipmentsWithUnlinkedLines: number;
  /** Lines that would gain a product because it exists now. */
  linked: number;
  /** Lines whose SKU still matches nothing, even as an alias. */
  stillUnlinked: number;
  results: { shipmentId: string; ref: string | null; nowLinked?: number; stillUnlinked?: number; error?: string }[];
}

export type TxGroupBy = 'channelGroup' | 'channel' | 'sku' | 'brand' | 'vendor';
export interface TxGroupRow { key: string; label: string; orders: number; units: number; revenueEur: number; profitEur: number; marginPct: number | null }
export interface TxGroupedResult { groupBy: TxGroupBy; groups: TxGroupRow[]; totals: { orders: number; units: number; revenueEur: number; profitEur: number } }
export interface TxFilterParams { q?: string; salesChannelId?: string[]; destinationCountryId?: string[]; status?: string[]; profitTierId?: string[]; shipmentStatus?: string[]; fulfilmentType?: string[]; feeType?: string[]; sku?: string; hasAlert?: boolean; needsReturn?: boolean; resolution?: string[]; dateFrom?: string; dateTo?: string }

/** What one SKU has actually sold. Real figures; the page previously showed samples. */
export interface ProductSalesMetrics {
  /** The window actually used, echoed back so the page can label what it is showing. */
  from: string;
  to: string;
  windowDays: number;
  /** Null when it has never sold. Distinguishes "nobody wants it" from "nothing imported lately". */
  lastSoldAt: string | null;
  unitsSold: number;
  /** Net of channel fees. */
  revenueEur: number;
  profitEur: number;
  avgSellPriceEur: number | null;
  returnRatePct: number | null;
  returnedUnits: number;
  orders: number;
  /** Eight weeks, oldest first. */
  weeklyUnits: number[];
  byChannel: { name: string; units: number; revenueEur: number; profitEur: number }[];
}

export const salesTransactionsApi = {
  productMetrics: (sku: string, range?: { from?: string | null; to?: string | null }) =>
    api
      .get<ProductSalesMetrics>('/sales-transactions/product-metrics', {
        params: { sku, from: range?.from || undefined, to: range?.to || undefined },
      })
      .then((r) => r.data),
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
  costEur: number; shippingEur: number; fbaFeeEur: number; profitEur: number; marginPct: number;
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
    fulfilment?: 'FBM' | 'FBA'; fbaFeeEur?: number | null;
    /** 'allocated' = real per-unit cost from FBA shipments; 'estimated' = weight-based fallback. */
    fbaInboundSource?: 'allocated' | 'estimated' | null;
    /** Where the fulfilment fee came from. 'unknown' = none could be established, so it is
     *  NOT in the profit — a zero FBA fee is never real. */
    fbaFeeSource?: 'override' | 'product' | 'channel' | 'unknown' | null;
    /** Other channels that hold FBA data for this product, named with their owning company. */
    fbaElsewhere?: string[];
    vatPct: number; taxType: string; taxLabel: string; pointsPct: number; feePct: number; importPct: number;
    actualWeightKg: number | null; volumetricWeightKg: number | null; chargeableWeightKg: number | null;
  };
  applied: { costEur: number; shippingEur: number; fbaFeeEur?: number; importPct: number; feePct: number; vatPct: number; pointsPct: number; taxType: string };
  breakdown: PricingBreakdown;
  comparison: PricingComparisonRow[];
}
export interface IndividualPricingInput {
  productId: string; salesChannelId: string; price: number;
  taxMode?: 'include' | 'zero'; shippingServiceId?: string | null;
  fulfilment?: 'FBM' | 'FBA';
  costEur?: number; shippingCostEur?: number; fbaFeeEur?: number; vatPct?: number; feePct?: number; importPct?: number;
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

// ---------------------------------------------------------------- vendor price-file import
export type VendorImportField = 'sku' | 'ean' | 'manufacturerSku' | 'purchaseCost' | 'map' | 'availability';

export interface VendorImportColumn {
  index: number;
  /** True spreadsheet letter, offset by the sheet's origin — what the user sees in Excel. */
  letter: string;
  /** Position among columns carrying data, 1-based — how a person counts columns by eye. */
  ordinal: number;
  header: string;
  samples: string[];
  filled: number;
  kind: 'empty' | 'ean' | 'money' | 'integer' | 'sku' | 'text';
}

export interface VendorImportMappingRow {
  field: VendorImportField;
  columnIndex: number | null;
  confidence: number;
  reason: string;
  source: 'profile' | 'detected' | 'none';
  matchedBy?: string;
  /** Set when a saved mapping followed its header to a different column this time. */
  movedFrom?: string;
}

export interface VendorImportAnalysis {
  file: { name: string; rows: number };
  sheets: { name: string; rowCount: number }[];
  sheet: string;
  headerRowIndex: number;
  discarded: { preamble: number; blank: number; sectionHeaders: number };
  sectionLabels: string[];
  columns: VendorImportColumn[];
  mapping: VendorImportMappingRow[];
  capabilities: { cost: boolean; map: boolean; availability: boolean };
  vendor: { id: string; name: string; currency: string; mapIncludesVat: boolean } | null;
  profile: { id: string; name: string; currency: string } | null;
  suggestedCurrency: string;
}

export interface VendorImportProfile {
  id: string;
  vendorId: string;
  name: string;
  sheetName: string | null;
  currency: string;
  mapping: Partial<Record<VendorImportField, { header: string; letter: string; ordinal: number }>>;
  updatedAt: string;
  vendor?: { id: string; name: string };
}

export const vendorImportApi = {
  analyse: (file: File, body: { vendorId?: string; sheet?: string; profileId?: string }) => {
    const fd = new FormData();
    fd.append('file', file);
    for (const [k, v] of Object.entries(body)) if (v) fd.append(k, v);
    return api.post<VendorImportAnalysis>('/vendor-import/analyse', fd).then((r) => r.data);
  },
  listProfiles: (vendorId?: string) =>
    api.get<VendorImportProfile[]>('/vendor-import/profiles', { params: { vendorId } }).then((r) => r.data),
  saveProfile: (body: { id?: string; vendorId: string; name: string; sheetName?: string | null; currency: string; mapping: VendorImportProfile['mapping'] }) =>
    api.post<VendorImportProfile>('/vendor-import/profiles', body).then((r) => r.data),
  removeProfile: (id: string) => api.delete(`/vendor-import/profiles/${id}`).then((r) => r.data),
};

export type VendorMatchedBy = 'alias' | 'mainSku' | 'ean' | 'vendorSku' | 'manufacturerSku';

export interface VendorMatchRow {
  index: number;
  vendorSku: string;
  ean: string;
  manufacturerSku: string;
  productId: string | null;
  product: { id: string; mainSku: string; title: string } | null;
  matchedBy: VendorMatchedBy | null;
  reason: 'no-identifiers' | 'not-found' | null;
  ambiguous: { by: VendorMatchedBy; products: { id: string; mainSku: string; title: string }[] } | null;
}

export interface VendorMatchResult {
  vendor: { id: string; name: string };
  sheet: string;
  summary: {
    total: number; matched: number; unmatched: number; ambiguous: number;
    byMethod: Record<VendorMatchedBy, number>;
    duplicateSkus: string[];
  };
  rows: VendorMatchRow[];
}

export interface VendorSkuAlias {
  id: string; vendorId: string; vendorSku: string; productId: string;
  product?: { id: string; mainSku: string; title: string };
}

export const vendorMatchApi = {
  match: (file: File, body: { vendorId: string; sheet?: string; mapping: Record<string, number> }) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('vendorId', body.vendorId);
    if (body.sheet) fd.append('sheet', body.sheet);
    fd.append('mapping', JSON.stringify(body.mapping));
    return api.post<VendorMatchResult>('/vendor-import/match', fd).then((r) => r.data);
  },
  listAliases: (vendorId: string) =>
    api.get<VendorSkuAlias[]>('/vendor-import/aliases', { params: { vendorId } }).then((r) => r.data),
  saveAlias: (body: { vendorId: string; vendorSku: string; productId: string }) =>
    api.post<VendorSkuAlias>('/vendor-import/aliases', body).then((r) => r.data),
  removeAlias: (id: string) => api.delete(`/vendor-import/aliases/${id}`).then((r) => r.data),
};

export type VendorChangeField = 'purchaseCost' | 'map' | 'availability' | 'ean' | 'upc';

export interface VendorPlannedChange {
  productId: string; mainSku: string; title: string;
  field: VendorChangeField;
  oldValue: string | null; newValue: string;
  /** Present when the change is large enough to be worth a second look. */
  warning?: string;
  /** How the value was derived, when it is not simply the file's figure. */
  note?: string;
}

export interface VendorImportPreview {
  vendor: { id: string; name: string; mapIncludesVat: boolean };
  currency: string;
  match: VendorMatchResult['summary'];
  summary: {
    total: number;
    byField: Record<VendorChangeField, number>;
    warnings: number; unchanged: number; skipped: number;
  };
  changes: VendorPlannedChange[];
  skipped: { productId: string; field: VendorChangeField; raw: string; why: string }[];
}

export interface VendorImportRun {
  id: string; vendorId: string; fileName: string; sheetName: string | null; currency: string;
  rowsTotal: number; rowsMatched: number; changed: number;
  createdAt: string; rolledBackAt: string | null;
  vendor?: { id: string; name: string };
  _count?: { changes: number };
}

const importForm = (file: File, body: Record<string, string | undefined>, mapping: Record<string, number>) => {
  const fd = new FormData();
  fd.append('file', file);
  for (const [k, v] of Object.entries(body)) if (v) fd.append(k, v);
  fd.append('mapping', JSON.stringify(mapping));
  return fd;
};

export const vendorApplyApi = {
  preview: (file: File, body: { vendorId: string; sheet?: string; currency: string; mapping: Record<string, number>; brandDiscounts?: Record<string, number> }) =>
    api.post<VendorImportPreview>('/vendor-import/preview', importForm(file, { vendorId: body.vendorId, sheet: body.sheet, currency: body.currency, brandDiscounts: JSON.stringify(body.brandDiscounts ?? {}) }, body.mapping)).then((r) => r.data),
  apply: (file: File, body: { vendorId: string; sheet?: string; currency: string; profileId?: string; mapping: Record<string, number>; brandDiscounts?: Record<string, number> }) =>
    api.post<{ runId: string; applied: number }>('/vendor-import/apply', importForm(file, { vendorId: body.vendorId, sheet: body.sheet, currency: body.currency, profileId: body.profileId, brandDiscounts: JSON.stringify(body.brandDiscounts ?? {}) }, body.mapping)).then((r) => r.data),
  listRuns: (vendorId?: string) =>
    api.get<VendorImportRun[]>('/vendor-import/runs', { params: { vendorId } }).then((r) => r.data),
  rollback: (id: string) => api.post<{ ok: boolean; reverted: number }>(`/vendor-import/runs/${id}/rollback`).then((r) => r.data),
};

export interface EbayAmountRead {
  value: number | null;
  currency: string | null;
  convertedFromValue: number | null;
  convertedFromCurrency: string | null;
  /** True when eBay states it performed a conversion for this amount. */
  converted: boolean;
  exchangeRate: number | null;
}

export interface EbayOrderMoney {
  orderId: string;
  marketplaceId: string | null;
  orderCurrency: string | null;
  amounts: {
    pricingTotal: EbayAmountRead;
    priceSubtotal: EbayAmountRead;
    deliveryCost: EbayAmountRead;
    totalMarketplaceFee: EbayAmountRead;
    lineItemTotals: EbayAmountRead[];
  };
  interpretation: {
    feeValueWeStore: number | null;
    feeCurrencyEbayStates: string | null;
    feeAlreadyConverted: boolean;
    mismatch: string | null;
    ebayImpliedRate: number | null;
  };
  /** What eBay actually charged and paid, in the seller's payout currency. */
  finances: {
    ok: boolean;
    message: string | null;
    payoutCurrency: string | null;
    transactions: Array<{
      transactionType: string | null;
      bookingEntry: string | null;
      transactionDate: string | null;
      amount: EbayAmountRead;
      totalFeeAmount: EbayAmountRead | null;
      feeTypes: Array<{ feeType: string | null; amount: EbayAmountRead }>;
    }>;
    feeInPayoutCurrency: number | null;
  };
  /** eBay's own rate for this order — payout-currency fee over order-currency fee. */
  ebayRate: number | null;
  /** Present only when the Finances call was rejected: exactly what we signed and sent.
   *  Contains the JWE (a public key) and request metadata — never the private key. */
  signatureSent: {
    url: string; base: string; signatureInput: string; signature: string;
    created: number; serverTime: string;
    keyId: string | null; cipher: string; jwePrefix: string; jweLength: number;
    /** eBay's request log id — how their support finds this exact call in their logs. */
    rlogId?: string | null;
    status?: number;
    errorCode?: string | number | null;
  } | null;
}

export interface FloorExplain {
  error?: string;
  sku?: string;
  marketplaceId?: string;
  currency?: string | null;
  inputs?: {
    vatRate?: number | null;
    vatSource?: string;
    costEur?: number | null;
    shippingEur?: number | null;
    shippingService?: string | null;
    chargeableWeightKg?: number | null;
    fxNativeToEur?: number | null;
    cogsLandedCents?: number | null;
    fixedPerUnitCents?: number | null;
    fbaFulfillmentFeeCents?: number | null;
    closingFeeCents?: number | null;
    minMarginPct?: number | null;
    returnsRatePct?: number | null;
    returnsRateSource?: string | null;
    storagePerUnitCents?: number | null;
    adCostPerUnitCents?: number | null;
  };
  stored?: {
    breakevenCents: number | null;
    strategyFloorCents: number | null;
    floorsComputedAt: string | null;
    /** Cost components this floor does NOT account for. */
    omits?: string[];
    loaded?: boolean;
  };
  recomputedNow?: { breakevenCents: number | null; strategyFloorCents: number | null } | null;
}

export interface RepricingStrategyPreset {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  sortOrder: number;
  strategy: string;
  minMarginPct: string | number;
  probeStepPct: string | number | null;
  probeIntervalMinutes: number | null;
  fbmPremiumPct: string | number | null;
  epsilonCents: number | null;
  /** Aggressive presets refuse SKUs whose floor omits storage or advertising. */
  requiresLoadedFloor: boolean;
}

export interface StrategyAssignResult {
  error?: string;
  preview?: boolean;
  strategy?: string;
  wouldApply?: number;
  applied?: number;
  recomputeNeeded?: boolean;
  refused: { sku: string; marketplaceId: string; reason: string }[];
}

export interface RepricingMarketplaceCosts {
  marketplaceId: string;
  storageApplies: boolean;
  adsApply: boolean;
  defaultStoragePerUnitCents: number | null;
  defaultAdCostPerUnitCents: number | null;
}
