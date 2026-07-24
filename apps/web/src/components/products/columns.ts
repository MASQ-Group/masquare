import type { Product } from '../../lib/api';

export interface ExportColumn {
  key: string;
  label: string;
  sample: string;
  get: (p: Product) => string | number;
  /** Included by default when purpose = edit (identity + commonly edited fields). */
  editDefault?: boolean;
}

/** The canonical product columns for export/import. The `key` matches the field name the
 *  import endpoint expects (reference fields are by name; the server resolves/creates them). */
export const EXPORT_COLUMNS: ExportColumn[] = [
  { key: 'mainSku', label: 'Main SKU', sample: 'RE-S8540', editDefault: true, get: (p) => p.mainSku },
  { key: 'title', label: 'Title', sample: 'Remington S8540 Keratin Protect Straightener', editDefault: true, get: (p) => p.title },
  { key: 'brand', label: 'Brand', sample: 'Remington', editDefault: true, get: (p) => p.brand?.name ?? '' },
  { key: 'vendor', label: 'Vendor', sample: 'THETACO Traders Ltd', editDefault: true, get: (p) => p.vendor?.name ?? '' },
  { key: 'productType', label: 'Product Type', sample: 'Hair Straightener', editDefault: true, get: (p) => p.productType?.name ?? '' },
  { key: 'fulfilmentType', label: 'Fulfilment Type', sample: 'FBA', editDefault: true, get: (p) => p.fulfilmentType?.code ?? p.fulfilmentType?.name ?? '' },
  { key: 'category', label: 'Category', sample: 'Straighteners', editDefault: true, get: (p) => p.category?.name ?? '' },
  { key: 'productClass', label: 'Product Class', sample: 'Equipment', editDefault: true, get: (p) => p.productClass?.name ?? '' },
  // Unlike the reference columns above, an unknown VAT class is never created on import — the
  // server reports it and leaves the product's class empty.
  { key: 'vatClass', label: 'VAT Class', sample: 'Standard', editDefault: true, get: (p) => p.vatClass?.name ?? '' },
  { key: 'ean', label: 'EAN', sample: '5011832070159', get: (p) => p.ean ?? '' },
  { key: 'upc', label: 'UPC', sample: '843096097842', get: (p) => p.upc ?? '' },
  { key: 'vendorSku', label: 'Vendor SKU', sample: 'THE-8540', get: (p) => p.vendorSku ?? '' },
  { key: 'manufacturerSku', label: 'Manufacturer SKU', sample: 'S8540', get: (p) => p.manufacturerSku ?? '' },
  { key: 'countryOfOrigin', label: 'Country of Origin', sample: 'CN', get: (p) => p.countryOfOrigin ?? '' },
  { key: 'hsCode', label: 'HS Code', sample: '8516.32.00', get: (p) => p.hsCode ?? '' },
  { key: 'purchaseCost', label: 'Purchase Cost (EUR)', sample: '50.00', editDefault: true, get: (p) => p.purchaseCost.amount ?? '' },
  { key: 'map', label: 'MAP (EUR)', sample: '69.99', get: (p) => p.map.amount ?? '' },
  { key: 'msrp', label: 'MSRP (EUR)', sample: '99.99', get: (p) => p.msrp.amount ?? '' },
  { key: 'productWeightKg', label: 'Product Weight (kg)', sample: '0.45', get: (p) => p.productWeightKg ?? '' },
  { key: 'packageWeightKg', label: 'Package Weight (kg)', sample: '0.70', get: (p) => p.packageWeightKg ?? '' },
  { key: 'packageLengthCm', label: 'Length (cm)', sample: '20', get: (p) => p.packageLengthCm ?? '' },
  { key: 'packageWidthCm', label: 'Width (cm)', sample: '12', get: (p) => p.packageWidthCm ?? '' },
  { key: 'packageHeightCm', label: 'Height (cm)', sample: '6', get: (p) => p.packageHeightCm ?? '' },
  { key: 'aliases', label: 'Alias SKUs', sample: 'RE-S8540-FBA; RE-S8540-NK', get: (p) => p.aliases.map((a) => a.skuValue).join('; ') },
];

/** Map arbitrary file headers to known column keys (case-insensitive, by label or key). */
export function mapHeadersToKeys(headers: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const h of headers) {
    const lower = h.toLowerCase();
    const col = EXPORT_COLUMNS.find((c) => c.label.toLowerCase() === lower || c.key.toLowerCase() === lower);
    if (col) map[h] = col.key;
  }
  return map;
}
