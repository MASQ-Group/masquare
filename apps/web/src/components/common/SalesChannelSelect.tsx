import { SmartReferenceInput, type ReferenceOption } from '@masquare/ui';
import type { SalesChannel } from '../../lib/api';
import { Flag } from './Flag';

interface Props {
  channels: SalesChannel[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
}

/**
 * Sales channel picker: type to filter, with the channel's native country flag beside
 * the name — the same flag-plus-label treatment used for currencies and integrations.
 *
 * Filters on name and currency, so "GBP" finds every UK channel.
 */
export function SalesChannelSelect({ channels, value, onChange, placeholder = 'Search channels…' }: Props) {
  const option = (c: SalesChannel): ReferenceOption => ({
    id: c.id,
    label: c.name,
    sub: c.nativeCurrency ?? 'EUR',
    icon: <Flag code={c.nativeCountry?.isoCode} />,
  });

  const selected = channels.find((c) => c.id === value);

  const fetchSuggestions = async (q: string): Promise<ReferenceOption[]> => {
    const needle = q.trim().toLowerCase();
    return channels
      .filter(
        (c) =>
          !needle ||
          c.name.toLowerCase().includes(needle) ||
          (c.nativeCurrency ?? '').toLowerCase().includes(needle),
      )
      .map(option);
  };

  return (
    <SmartReferenceInput
      value={selected ? option(selected) : null}
      placeholder={placeholder}
      fetchSuggestions={fetchSuggestions}
      onSelect={(o) => onChange(o.id)}
      onClear={() => onChange('')}
    />
  );
}
