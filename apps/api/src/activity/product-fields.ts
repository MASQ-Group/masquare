/**
 * How a product's columns read in the history tab.
 *
 * Without this the log says "purchaseCostAmount changed from 12.5 to 1250" and, worse,
 * "brandId changed from 3f2a…-… to 9c14…-…", which is a uuid diff nobody can act on. The labels
 * and the reference resolvers are what turn a row of column names into something a person can
 * check at a glance.
 */
export const PRODUCT_FIELD_LABELS: Record<string, string> = {
  mainSku: 'Main SKU',
  title: 'Title',
  brandId: 'Brand',
  vendorId: 'Vendor',
  productTypeId: 'Product type',
  fulfilmentTypeId: 'Fulfilment type',
  categoryId: 'Category',
  productClassId: 'Product class',
  vatClassId: 'VAT class',
  ean: 'EAN',
  upc: 'UPC',
  vendorSku: 'Vendor SKU',
  manufacturerSku: 'Manufacturer SKU',
  countryOfOrigin: 'Country of origin',
  hsCode: 'HS code',
  purchaseCostAmount: 'Purchase cost',
  purchaseCostCurrency: 'Purchase cost currency',
  mapAmount: 'MAP',
  mapCurrency: 'MAP currency',
  msrpAmount: 'MSRP',
  msrpCurrency: 'MSRP currency',
  ebayTitle: 'eBay title',
  shortDescription: 'Short description',
  descriptionHtml: 'Description',
  keyFeatures: 'Key features',
  searchKeywords: 'Search keywords',
  voltageRatingId: 'Voltage rating',
  frequencyId: 'Frequency',
  plugTypeId: 'Plug type',
  batteryRequired: 'Battery required',
  batteryTypeId: 'Battery type',
  hazmatClassId: 'Hazmat class',
  warrantyText: 'Warranty',
  dangerousGoodsNote: 'Dangerous goods note',
  productWeightKg: 'Product weight (kg)',
  packageWeightKg: 'Package weight (kg)',
  packageLengthCm: 'Package length (cm)',
  packageWidthCm: 'Package width (cm)',
  packageHeightCm: 'Package height (cm)',
  serialTracked: 'Serial tracked',
};

/**
 * The reference columns whose values are ids, and the table each one points at.
 *
 * Used to look up display names in one query per table rather than one per changed row.
 * `category` is resolved to its full path, matching how it reads everywhere else in the platform.
 */
export const PRODUCT_REF_FIELDS = {
  brandId: 'brand',
  vendorId: 'vendor',
  productTypeId: 'productType',
  fulfilmentTypeId: 'fulfilmentType',
  categoryId: 'productCategory',
  productClassId: 'productClass',
  vatClassId: 'vatClass',
} as const;
