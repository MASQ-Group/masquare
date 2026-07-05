import axios from 'axios';

const TOKEN_KEY = 'masquare.token';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
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
export interface Vendor {
  id: string;
  name: string;
  vatNumber?: string | null;
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
  values: AttributeValue[];
}
export interface PlatformSettings {
  id: string;
  measurementSystem: 'metric' | 'imperial';
  dateFormat: 'ddmmyyyy' | 'mmddyyyy' | 'yyyymmdd';
  salesTxStandardColumns: string[] | null;
}

const crud = <T,>(path: string) => ({
  list: (q?: string) => api.get<T[]>(path, { params: q ? { q } : undefined }).then((r) => r.data),
  create: (body: Partial<T>) => api.post<T>(path, body).then((r) => r.data),
  update: (id: string, body: Partial<T>) => api.patch<T>(`${path}/${id}`, body).then((r) => r.data),
  remove: (id: string) => api.delete(`${path}/${id}`).then((r) => r.data),
});

export const vendorsApi = crud<Vendor>('/vendors');
export const brandsApi = crud<Brand>('/brands');
export const productTypesApi = crud<ProductType>('/product-types');
export const fulfilmentTypesApi = crud<FulfilmentType>('/fulfilment-types');

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
  brand: RefLite | null;
  vendor: RefLite | null;
  productType: RefLite | null;
  fulfilmentType: RefLite | null;
  category: RefLite | null;
  ean: string | null;
  upc: string | null;
  vendorSku: string | null;
  manufacturerSku: string | null;
  countryOfOrigin: string | null;
  hsCode: string | null;
  purchaseCost: Money;
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
  bulkDelete: (ids: string[]) => api.post('/products/bulk/delete', { ids }).then((r) => r.data),
  bulkUpdate: (body: { ids: string[]; productTypeId?: string; categoryId?: string; attributes?: { attributeId: string; value: string }[] }) =>
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
  calcMethod: 'actual_weight' | 'volumetric_weight';
  zones: ShippingZone[];
}
export interface SalesChannel {
  id: string;
  name: string;
  description: string | null;
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
  verifyMapping: (id: string, confirmed: boolean) => api.post<ChannelIntegration>(`/integrations/${id}/verify-mapping`, { confirmed }).then((r) => r.data),
  remove: (id: string) => api.delete(`/integrations/${id}`).then((r) => r.data),
};

// ---- Sales analytics / reporting ----
export interface AnalyticsTotals {
  revenueExVatEur: number; revenueIncVatEur: number; profitEur: number; feesEur: number;
  orders: number; units: number; shippingEur: number; dutyEur: number; refundEur: number;
  profitPct: number | null; avgOrderValueEur: number;
}
export interface AnalyticsChannelRow {
  channelId: string | null; channelName: string; currency: string | null;
  revenueExVatNative: number; revenueIncVatNative: number; revenueExVatEur: number; revenueIncVatEur: number;
  profitEur: number; feesEur: number; orders: number; units: number; profitPct: number | null;
  prevRevenueExVatEur: number | null; prevProfitEur: number | null;
}
export interface AnalyticsCountryRow {
  countryId: string | null; countryName: string;
  revenueExVatEur: number; revenueIncVatEur: number; profitEur: number; feesEur: number;
  orders: number; units: number; profitPct: number | null;
  prevRevenueExVatEur: number | null; prevProfitEur: number | null;
}
export interface AnalyticsSkuRow {
  sku: string; productTitle: string | null; revenueExVatEur: number; revenueIncVatEur: number;
  profitEur: number; feesEur: number; units: number; lines: number; profitPct: number | null; avgFeeEur: number;
}
export interface AnalyticsTrendPoint { bucket: string; revenueExVatEur: number; profitEur: number; orders: number }
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
}

export const analyticsApi = {
  sales: (params: { from: string; to: string; compareFrom?: string; compareTo?: string; companyId?: string; skuChannelId?: string; skuCountryId?: string }) =>
    api.get<AnalyticsReport>('/analytics/sales', { params }).then((r) => r.data),
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

// ---- Sales Transactions ----
export interface SalesTransactionItem {
  id?: string;
  productId?: string | null;
  productTitle?: string | null;
  productMatched?: boolean;
  productCost?: number | null;
  productWeightKg?: number | null;
  sku: string;
  quantity: number;
  netSalesAmount?: number | null;
  vatAmount?: number | null;
  shippingAmount?: number | null;
  shippingAmountVat?: number | null;
  salesChannelSalesFeeAmount?: number | null;
}
export interface SalesTransaction {
  id: string;
  date: string;
  transactionRef: string;
  salesChannelId: string | null;
  salesChannel: { id: string; name: string } | null;
  destinationCountryId: string | null;
  destinationCountry: { id: string; name: string; isoCode: string } | null;
  shippingServiceId: string | null;
  shippingService: { id: string; name: string } | null;
  companyId: string | null;
  currency: string | null;
  feeCurrency: string | null;
  exchangeRate: number | null;
  feeExchangeRate: number | null;
  status: 'draft' | 'submitted';
  unlockedForEdit: boolean;
  hasPendingUnlock: boolean;
  salesFeePct: number | null;
  destinationCountryVatPct: number | null;
  vatOverridden: boolean;
  overallPackageWeight: number | null;
  estimatedShippingCost: number | null;
  actualShippingCost: number | null;
  shippingCostSource: 'actual' | 'estimated';
  returnShippingCost: number;
  dutyImportCost: number;
  fulfilmentStatus: 'pending' | 'shipped' | 'cancelled';
  resolution: 'none' | 'cancelled' | 'returned' | 'replaced';
  refundAmount: number | null;
  refundEur: number;
  restockItems: boolean;
  feeRefunded: boolean;
  resolutionNotes: string | null;
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
  createdAt: string;
}

export interface PendingShipment {
  id: string;
  transactionRef: string;
  date: string;
  salesChannel: { id: string; name: string } | null;
  company: { id: string; officialName: string } | null;
  destinationCountry: { id: string; name: string } | null;
  defaultShippingService: { id: string; name: string } | null;
  skus: string[];
  itemCount: number;
  quantity: number;
  shipmentCount: number;
}

export interface ShipmentListResponse { items: Shipment[]; total: number; page: number; pageSize: number }
export interface PendingListResponse { items: PendingShipment[]; total: number; page: number; pageSize: number }

export const shipmentsApi = {
  list: (params: { q?: string; companyId?: string; salesChannelId?: string; type?: string; page?: number; pageSize?: number }) =>
    api.get<ShipmentListResponse>('/shipments', { params }).then((r) => r.data),
  pending: (params: { q?: string; companyId?: string; salesChannelId?: string; page?: number; pageSize?: number }) =>
    api.get<PendingListResponse>('/shipments/pending', { params }).then((r) => r.data),
  forTransaction: (transactionId: string) => api.get<TransactionShipment[]>(`/shipments/transaction/${transactionId}`).then((r) => r.data),
  create: (body: any) => api.post<Shipment>('/shipments', body).then((r) => r.data),
  update: (id: string, body: any) => api.patch<Shipment>(`/shipments/${id}`, body).then((r) => r.data),
  remove: (id: string) => api.delete(`/shipments/${id}`).then((r) => r.data),
  setFulfilment: (transactionId: string, status: 'pending' | 'shipped' | 'cancelled') =>
    api.patch(`/shipments/transaction/${transactionId}/fulfilment`, { status }).then((r) => r.data),
};

export const salesTransactionsApi = {
  list: (params: { q?: string; companyId?: string; salesChannelId?: string; status?: string; profitTierId?: string; sortBy?: 'date' | 'profit' | 'profitPct'; sortDir?: 'asc' | 'desc'; page?: number; pageSize?: number }) =>
    api.get<SalesTransactionListResponse>('/sales-transactions', { params }).then((r) => r.data),
  get: (id: string) => api.get<SalesTransaction>(`/sales-transactions/${id}`).then((r) => r.data),
  create: (body: any) => api.post<SalesTransaction>('/sales-transactions', body).then((r) => r.data),
  update: (id: string, body: any) => api.patch<SalesTransaction>(`/sales-transactions/${id}`, body).then((r) => r.data),
  remove: (id: string) => api.delete(`/sales-transactions/${id}`).then((r) => r.data),
  resolve: (id: string, body: { resolution: 'none' | 'cancelled' | 'returned' | 'replaced'; refundAmount?: number | null; restockItems?: boolean; feeRefunded?: boolean; resolutionNotes?: string | null }) =>
    api.patch<SalesTransaction>(`/sales-transactions/${id}/resolution`, body).then((r) => r.data),
  bulkStatus: (ids: string[], status: 'draft' | 'submitted') =>
    api.post<{ updated: number; skipped: number }>('/sales-transactions/bulk/status', { ids, status }).then((r) => r.data),
  requestUnlock: (id: string) => api.post(`/sales-transactions/${id}/unlock-request`, {}).then((r) => r.data),
  listUnlockRequests: () => api.get<UnlockRequest[]>('/sales-transactions/unlock-requests').then((r) => r.data),
  decideUnlock: (requestId: string, grant: boolean) => api.post(`/sales-transactions/unlock-requests/${requestId}/decide`, { grant }).then((r) => r.data),
};
