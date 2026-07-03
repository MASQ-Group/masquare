import { SmartReferenceInput, type ReferenceOption } from '@masquare/ui';
import { productsApi } from '../../lib/api';

interface Props {
  value: { productId: string | null; sku: string };
  onChange: (v: { productId: string | null; sku: string }) => void;
}

/** SKU picker — a smart dropdown of products (searches SKU, aliases, title). */
export function ProductSkuField({ value, onChange }: Props) {
  const fetchSuggestions = async (q: string): Promise<ReferenceOption[]> => {
    const res = await productsApi.list({ q, pageSize: 20 });
    return res.items.map((p) => ({ id: p.id, label: p.mainSku, sub: p.title }));
  };

  return (
    <SmartReferenceInput
      value={value.sku ? { id: value.productId ?? value.sku, label: value.sku } : null}
      placeholder="Search SKU or title…"
      fetchSuggestions={fetchSuggestions}
      onSelect={(o) => onChange({ productId: o.id, sku: o.label })}
      onClear={() => onChange({ productId: null, sku: '' })}
    />
  );
}
