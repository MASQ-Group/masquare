import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ScanBarcode } from 'lucide-react';
import { serialsApi, type AvailableSerial } from '../../lib/api';

interface Props {
  productId: string;
  sku: string;
  quantity: number;
  selected: string[];
  onChange: (serials: string[]) => void;
}

/**
 * Choose which physical units leave on a sale.
 *
 * Only units currently in stock are offered, and the count is held to the line quantity,
 * so the form cannot express a sale the server would reject. Picking is deliberate rather
 * than automatic: which unit ships is a real-world decision (warranty, batch, condition).
 */
export function SerialPicker({ productId, sku, quantity, selected, onChange }: Props) {
  const { data: available = [], isLoading } = useQuery({
    queryKey: ['serials-available', productId],
    queryFn: () => serialsApi.available(productId),
  });

  const toggle = (serial: string) => {
    if (selected.includes(serial)) {
      onChange(selected.filter((s) => s !== serial));
    } else if (selected.length < quantity) {
      onChange([...selected, serial]);
    }
  };

  const complete = selected.length === quantity;
  const shortOfStock = available.length < quantity;

  return (
    <div className="mt-1.5 rounded-md border border-n-200 bg-n-25 px-3 py-2.5">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <ScanBarcode size={14} className="text-n-500" />
        <span className="text-[12px] font-semibold text-n-700">Serial numbers for {sku}</span>
        <span className={`mono text-[12px] ${complete ? 'text-teal-700' : 'text-warning'}`}>
          {selected.length}/{quantity} selected
        </span>
        {selected.length > 0 && (
          <button type="button" className="ml-auto text-[11.5px] font-semibold text-n-500 hover:text-n-700" onClick={() => onChange([])}>
            Clear
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="py-1 text-[12.5px] text-n-400">Loading available units…</div>
      ) : !available.length ? (
        <div className="flex items-center gap-2 py-1 text-[12.5px] text-warning">
          <AlertTriangle size={13} />
          None of this product is in stock — receive it against a purchase order first.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            {available.map((s: AvailableSerial) => {
              const on = selected.includes(s.serial);
              const full = !on && selected.length >= quantity;
              return (
                <button
                  key={s.id}
                  type="button"
                  disabled={full}
                  onClick={() => toggle(s.serial)}
                  title={s.warehouse?.name ?? undefined}
                  className={`code rounded-md border px-2 py-1 text-[12px] transition ${
                    on
                      ? 'border-teal-500 bg-teal-50 font-semibold text-teal-800'
                      : full
                        ? 'cursor-not-allowed border-n-200 bg-n-0 text-n-300'
                        : 'border-n-200 bg-n-0 text-n-700 hover:border-n-300'
                  }`}
                >
                  {s.serial}
                </button>
              );
            })}
          </div>
          {shortOfStock && (
            <div className="mt-1.5 flex items-center gap-2 text-[11.5px] text-warning">
              <AlertTriangle size={12} />
              Only {available.length} in stock for a quantity of {quantity}.
            </div>
          )}
        </>
      )}
    </div>
  );
}
