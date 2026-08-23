import { ArrowDown, ArrowUp, GripVertical, Plus, X } from 'lucide-react';

/**
 * Key features, one row each.
 *
 * Bullets are an ordered list, and a list edited as one block of prose loses that order the moment
 * anyone reflows it — a blank line silently becomes a bullet, two features run together into one.
 * A row per feature makes the order explicit and reorderable, which is what the channels actually
 * publish.
 */
export function FeatureList({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  const set = (i: number, text: string) => onChange(value.map((v, n) => (n === i ? text : v)));
  const add = () => onChange([...value, '']);
  const remove = (i: number) => onChange(value.filter((_, n) => n !== i));
  const move = (i: number, delta: number) => {
    const to = i + delta;
    if (to < 0 || to >= value.length) return;
    const next = [...value];
    [next[i], next[to]] = [next[to], next[i]];
    onChange(next);
  };

  return (
    <div>
      <label className="label">Key features</label>

      {value.length === 0 ? (
        <div className="rounded-lg border border-dashed border-n-300 px-3 py-4 text-center">
          <p className="text-[12.5px] text-n-500">No features yet.</p>
          <button type="button" onClick={add} className="mt-1.5 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-teal-700 hover:text-teal-800">
            <Plus size={14} /> Add the first one
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {value.map((feature, i) => (
            <div key={i} className="flex items-center gap-1.5">
              {/* Position is meaningful, so it is shown rather than left to be counted. */}
              <span className="flex w-6 shrink-0 items-center justify-center text-[11px] tabular-nums text-n-400">
                <GripVertical size={12} className="text-n-300" />
              </span>
              <input
                className="input h-9 flex-1 text-[13px]"
                value={feature}
                onChange={(e) => set(i, e.target.value)}
                placeholder={`Feature ${i + 1}`}
              />
              <div className="flex shrink-0">
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  title="Move up"
                  className="grid h-8 w-7 place-items-center rounded-md text-n-400 hover:bg-n-100 hover:text-n-700 disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <ArrowUp size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === value.length - 1}
                  title="Move down"
                  className="grid h-8 w-7 place-items-center rounded-md text-n-400 hover:bg-n-100 hover:text-n-700 disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <ArrowDown size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => remove(i)}
                  title="Remove"
                  className="grid h-8 w-7 place-items-center rounded-md text-n-400 hover:bg-red-50 hover:text-red-600"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={add}
            className="mt-0.5 inline-flex h-8 w-fit items-center gap-1.5 rounded-md border border-n-200 bg-n-0 px-2.5 text-[12.5px] font-semibold text-n-700 hover:border-n-300"
          >
            <Plus size={14} /> Add feature
          </button>
        </div>
      )}

      <p className="mt-1.5 text-[12px] text-n-400">Shown as bullets on the listing, in this order.</p>
    </div>
  );
}
