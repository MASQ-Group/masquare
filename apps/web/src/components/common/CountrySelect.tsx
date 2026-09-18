import { useQuery } from '@tanstack/react-query';
import { SmartReferenceInput, type ReferenceOption } from '@masquare/ui';
import { countriesApi } from '../../lib/api';
import { Flag } from './Flag';

export interface CountryOption { id: string; isoCode: string; name: string }

interface Props {
  value: string | null;
  onChange: (value: string | null) => void;
  /** Store the country id (FK fields) or its ISO code (free-text country fields). */
  valueKind?: 'id' | 'code';
  placeholder?: string;
  disabled?: boolean;
  /** Country keys (id or code, per valueKind) to hide from suggestions (e.g. already assigned). */
  excludeIds?: Iterable<string>;
  /**
   * Where the list comes from, for callers who cannot reach the platform's own route.
   *
   * The customer portal is the case: external accounts are refused everything outside `/portal`,
   * so this field came up empty there and its search found nothing to filter. It serves the same
   * table from its own route instead. The key keeps the two caches apart.
   */
  source?: { key: string; fetch: () => Promise<CountryOption[]> };
}

/** ISO country dropdown, preloaded from the Countries table (Global Data Considerations
 *  §Countries). Reused wherever a country is chosen across the platform. */
export function CountrySelect({ value, onChange, valueKind = 'id', placeholder = 'Country…', disabled, excludeIds, source }: Props) {
  const { data: countries = [] } = useQuery({
    queryKey: ['countries', source?.key ?? 'platform'],
    queryFn: () => (source ? source.fetch() : countriesApi.list()),
  });
  const keyOf = (c: { id: string; isoCode: string }) => (valueKind === 'code' ? c.isoCode : c.id);
  const selected = countries.find((c) => keyOf(c) === value);
  const exclude = new Set(excludeIds ?? []);

  const fetchSuggestions = async (q: string): Promise<ReferenceOption[]> =>
    countries
      .filter((c) => !exclude.has(keyOf(c)))
      .filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()) || c.isoCode.toLowerCase().includes(q.toLowerCase()))
      .slice(0, 40)
      .map((c) => ({ id: keyOf(c), label: c.name, sub: c.isoCode, icon: <Flag code={c.isoCode} /> }));

  return (
    <SmartReferenceInput
      value={selected ? { id: value!, label: selected.name, sub: selected.isoCode, icon: <Flag code={selected.isoCode} /> } : null}
      placeholder={placeholder}
      disabled={disabled}
      fetchSuggestions={fetchSuggestions}
      onSelect={(o) => onChange(o.id)}
      onClear={() => onChange(null)}
    />
  );
}
