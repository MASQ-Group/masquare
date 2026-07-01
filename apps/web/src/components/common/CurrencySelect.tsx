import { SmartReferenceInput, type ReferenceOption } from '@masquare/ui';
import { CURRENCIES } from '../../lib/currencies';

interface Props {
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
}

/** ISO 4217 currency dropdown (Global Data Considerations §Currencies). Stores the code. */
export function CurrencySelect({ value, onChange, placeholder = 'Currency…' }: Props) {
  const selected = CURRENCIES.find((c) => c.code === value);
  const fetchSuggestions = async (q: string): Promise<ReferenceOption[]> =>
    CURRENCIES.filter((c) => !q || c.code.toLowerCase().includes(q.toLowerCase()) || c.name.toLowerCase().includes(q.toLowerCase())).map((c) => ({
      id: c.code,
      label: `${c.code} — ${c.name}`,
      sub: c.code,
    }));

  return (
    <SmartReferenceInput
      value={selected ? { id: value!, label: `${selected.code} — ${selected.name}`, sub: selected.code } : null}
      placeholder={placeholder}
      fetchSuggestions={fetchSuggestions}
      onSelect={(o) => onChange(o.id)}
      onClear={() => onChange(null)}
    />
  );
}
