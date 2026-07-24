import { useRef } from 'react';
import { SmartReferenceInput, type ReferenceOption } from '@masquare/ui';
import { productsApi, type Product } from '../../lib/api';

interface Props {
  value: { productId: string | null; sku: string };
  onChange: (v: { productId: string | null; sku: string }) => void;
  /** Optional: the full product record behind the picked SKU, so callers can
   *  pre-fill fields (e.g. purchase cost) without a second round-trip. */
  onPick?: (product: Product) => void;
  /**
   * Resolve a fully-typed SKU without needing a click on the dropdown.
   *
   * Off by default so existing forms keep their explicit pick-from-list behaviour.
   * Screens that calculate as you type want it on: typing a complete, unambiguous SKU
   * and then clicking away otherwise leaves the field unresolved and nothing happens.
   */
  autoSelectExact?: boolean;
  /**
   * Restrict suggestions to one vendor's products. Used on the purchase order form, where
   * a line can only sensibly be a product supplied by the PO's vendor. Undefined = no
   * restriction (the default everywhere else).
   */
  vendorId?: string | null;
  /** Shown when the field is disabled because no vendor is chosen yet. */
  placeholder?: string;
  disabled?: boolean;
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
export function ProductSkuField({ value, onChange, onPick, autoSelectExact, vendorId, placeholder, disabled }: Props) {
  // Products from the last search, so onPick can hand back the whole record.
  const seen = useRef(new Map<string, Product>());

  const fetchSuggestions = async (q: string): Promise<ReferenceOption[]> => {
    // vendorId on the list endpoint is an `in` filter, so a single id goes in as [id].
    const res = await productsApi.list({ q, pageSize: 15, ...(vendorId ? { vendorId: [vendorId] } : {}) });
    const opts: ReferenceOption[] = [];
    for (const p of res.items) {
      seen.current.set(p.id, p);
      opts.push({ id: optId(p.id, p.mainSku), label: p.mainSku, sub: p.title });
      for (const a of p.aliases ?? []) {
        const code = a.fulfilmentType?.code;
        opts.push({ id: optId(p.id, a.skuValue), label: a.skuValue, sub: code ? `${code} alias` : 'alias' });
      }
    }
    const trimmed = opts.slice(0, MAX_OPTIONS);

    // Exactly one option matching the whole query is unambiguous — take it. Guarded on
    // it not already being the selection so this can't loop.
    if (autoSelectExact) {
      const needle = q.trim().toLowerCase();
      const exact = trimmed.filter((o) => o.label.toLowerCase() === needle);
      if (needle && exact.length === 1 && value.sku.toLowerCase() !== needle) {
        const productId = productIdOf(exact[0].id);
        setTimeout(() => {
          onChange({ productId, sku: exact[0].label });
          const product = seen.current.get(productId);
          if (product) onPick?.(product);
        }, 0);
      }
    }
    return trimmed;
  };

  return (
    <SmartReferenceInput
      value={value.sku ? { id: optId(value.productId ?? value.sku, value.sku), label: value.sku } : null}
      placeholder={placeholder ?? 'Search SKU, alias or title…'}
      disabled={disabled}
      fetchSuggestions={fetchSuggestions}
      onSelect={(o) => {
        const productId = productIdOf(o.id);
        onChange({ productId, sku: o.label });
        const product = seen.current.get(productId);
        if (product) onPick?.(product);
      }}
      onClear={() => onChange({ productId: null, sku: '' })}
    />
  );
}
