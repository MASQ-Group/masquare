import { SmartReferenceInput, type ReferenceOption } from '@masquare/ui';
import type { RefLite } from '../../lib/api';

interface Props {
  value: RefLite | null;
  placeholder?: string;
  list: (q?: string) => Promise<RefLite[]>;
  create?: (name: string) => Promise<RefLite>;
  onChange: (value: RefLite | null) => void;
  createNoun?: string;
}

/** Wraps the shared SmartReferenceInput for a product reference field, with
 *  create-on-confirm backed by the given Global Settings resource. */
export function RefField({ value, placeholder, list, create, onChange, createNoun }: Props) {
  const fetchSuggestions = async (q: string): Promise<ReferenceOption[]> => {
    const rows = await list(q);
    return rows.slice(0, 20).map((r) => ({ id: r.id, label: r.name, sub: r.code ?? undefined }));
  };

  return (
    <SmartReferenceInput
      value={value ? { id: value.id, label: value.name } : null}
      placeholder={placeholder}
      fetchSuggestions={fetchSuggestions}
      onSelect={(o) => onChange({ id: o.id, name: o.label })}
      onClear={() => onChange(null)}
      onCreate={
        create
          ? async (name) => {
              const created = await create(name);
              return { id: created.id, label: created.name };
            }
          : undefined
      }
      confirmCreate={(name) =>
        `Create new ${createNoun ?? 'value'} “${name}”? It will be available across the platform.`
      }
    />
  );
}
