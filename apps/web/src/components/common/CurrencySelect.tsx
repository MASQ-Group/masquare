import { SmartReferenceInput, type ReferenceOption } from '@masquare/ui';
import { CURRENCIES, currencyFlagCode } from '../../lib/currencies';
import { Flag } from './Flag';

interface Props {
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
}

/**
 * ISO 4217 currency dropdown (Global Data Considerations §Currencies). Stores the code.
 *
 * House style: every currency shows as its country flag plus the three-letter code and
 * nothing else. The name is still searchable — you can type "sterling" — it just isn't
 * displayed, which keeps the control narrow enough to sit beside an amount field.
 */
export function CurrencySelect({ value, onChange, placeholder = 'Currency…' }: Props) {
  const selected = CURRENCIES.find((c) => c.code === value);
  const option = (code: string): ReferenceOption => ({
    id: code,
    label: code,
    icon: <Flag code={currencyFlagCode(code)} />,
  });

  const fetchSuggestions = async (q: string): Promise<ReferenceOption[]> => {
    const needle = q.trim().toLowerCase();
    return CURRENCIES.filter(
      (c) => !needle || c.code.toLowerCase().includes(needle) || c.name.toLowerCase().includes(needle),
    ).map((c) => option(c.code));
  };

  return (
    <SmartReferenceInput
      value={selected ? option(selected.code) : null}
      placeholder={placeholder}
      fetchSuggestions={fetchSuggestions}
      onSelect={(o) => onChange(o.id)}
      onClear={() => onChange(null)}
    />
  );
}
