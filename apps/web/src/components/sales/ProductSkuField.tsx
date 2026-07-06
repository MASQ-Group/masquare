import { SmartReferenceInput, type ReferenceOption } from '@masquare/ui';
import { productsApi } from '../../lib/api';

interface Props {
  value: { productId: string | null; sku: string };
  onChange: (v: { productId: string | null; sku: string }) => void;
}

// Option ids must be unique per SKU (a product contributes its main SKU + each alias),
// so we pack the productId into the id and recover it on select. A record-separator
// char keeps it robust even if a SKU contains punctuation.
const SEP = '␟';
const optId = (productId: string, sku: string) => `${productId}${SEP}${sku}`;
const productIdOf = (id: string) => id.split(SEP)[0];
const MAX_OPTIONS = 40;

/** SKU picker — a smart dropdown of products AND their SKU aliases (e.g. the FBA alias).
 *  Searches SKU, aliases and title; every main SKU and alias is individually selectable. */
export function ProductSkuField({ value, onChange }: Props) {
  const fetchSuggestions = async (q: string): Promise<ReferenceOption[]> => {
    const res = await productsApi.list({ q, pageSize: 15 });
    const opts: ReferenceOption[] = [];
    for (const p of res.items) {
      opts.push({ id: optId(p.id, p.mainSku), label: p.mainSku, sub: p.title });
      for (const a of p.aliases ?? []) {
        const code = a.fulfilmentType?.code;
        opts.push({ id: optId(p.id, a.skuValue), label: a.skuValue, sub: code ? `${code} alias` : 'alias' });
      }
    }
    return opts.slice(0, MAX_OPTIONS);
  };

  return (
    <SmartReferenceInput
      value={value.sku ? { id: optId(value.productId ?? value.sku, value.sku), label: value.sku } : null}
      placeholder="Search SKU, alias or title…"
      fetchSuggestions={fetchSuggestions}
      onSelect={(o) => onChange({ productId: productIdOf(o.id), sku: o.label })}
      onClear={() => onChange({ productId: null, sku: '' })}
    />
  );
}
