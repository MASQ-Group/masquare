import { AlertTriangle } from 'lucide-react';
import type { AccessCatalogue, AccessLevel, GrantSet } from '../../lib/api';

const LEVELS: { value: AccessLevel; label: string }[] = [
  { value: 'none', label: 'No access' },
  { value: 'view', label: 'View' },
  { value: 'edit', label: 'Edit' },
];

interface Props {
  catalogue: AccessCatalogue;
  /** The grants being edited. */
  value: GrantSet;
  onChange: (next: GrantSet) => void;
  /**
   * What the role underneath already gives, when editing a person rather than a role. A control
   * with no explicit value of its own shows this and says where it came from — otherwise every
   * inherited setting looks like a deliberate "No access" and the role may as well not exist.
   */
  inherited?: GrantSet | null;
  /** Label for the inherited column, e.g. the role's name. */
  inheritedFrom?: string;
  disabled?: boolean;
}

/**
 * The grid of areas and capabilities.
 *
 * Shared by the role editor and a person's own Access tab so the two cannot describe the same
 * permission differently. When editing a person, a control left unset inherits from their role and
 * says so; setting it explicitly is what creates an override, and clearing it hands the decision
 * back to the role.
 */
export function AccessEditor({ catalogue, value, onChange, inherited, inheritedFrom, disabled }: Props) {
  const setArea = (key: string, level: AccessLevel | null) => {
    const areas = { ...value.areas };
    if (level === null) delete areas[key];
    else areas[key] = level;
    onChange({ ...value, areas });
  };

  const setCapability = (key: string, held: boolean | null) => {
    const capabilities = { ...value.capabilities };
    if (held === null) delete capabilities[key];
    else capabilities[key] = held;
    onChange({ ...value, capabilities });
  };

  const areaValue = (key: string) => value.areas[key];
  const capValue = (key: string) => value.capabilities[key];
  const inheritedArea = (key: string) => inherited?.areas?.[key] ?? 'none';
  const inheritedCap = (key: string) => inherited?.capabilities?.[key] === true;

  return (
    <div className="flex flex-col gap-6">
      {catalogue.groups.map((group) => (
        <section key={group.group}>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-n-500">{group.group}</h3>
          <div className="overflow-hidden rounded-lg border border-n-200">
            {group.areas.map((area, i) => {
              const explicit = areaValue(area.key);
              const effective = explicit ?? inheritedArea(area.key);
              return (
                <div key={area.key} className={`flex items-start gap-4 px-3.5 py-3 ${i ? 'border-t border-n-100' : ''}`}>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold text-n-800">{area.label}</div>
                    <p className="mt-0.5 text-[11.5px] leading-4 text-n-500">{area.description}</p>
                    {inherited && !explicit && (
                      <p className="mt-1 text-[11px] text-n-400">
                        From {inheritedFrom ?? 'the role'}: <strong>{LEVELS.find((l) => l.value === effective)?.label}</strong>
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Segmented
                      value={effective}
                      overridden={inherited ? explicit != null : false}
                      disabled={disabled}
                      onChange={(v) => setArea(area.key, v)}
                    />
                    {inherited && explicit != null && (
                      <button
                        className="ml-1 text-[11px] font-semibold text-teal-700 underline"
                        onClick={() => setArea(area.key, null)}
                        disabled={disabled}
                        title="Go back to what the role gives"
                      >
                        reset
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <section>
        <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-n-500">Capabilities</h3>
        <p className="mb-2 text-[11.5px] text-n-500">
          Separate from the levels above, because they do not follow from being an editor. Each one is
          granted on top of an area, never instead of it.
        </p>
        <div className="overflow-hidden rounded-lg border border-n-200">
          {catalogue.capabilities.map((cap, i) => {
            const explicit = capValue(cap.key);
            const effective = explicit ?? inheritedCap(cap.key);
            return (
              <div key={cap.key} className={`flex items-start gap-4 px-3.5 py-3 ${i ? 'border-t border-n-100' : ''}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[13px] font-semibold text-n-800">
                    {cap.label}
                    {cap.dangerous && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-warning-bd bg-warning-bg px-1.5 py-0.5 text-[10px] font-semibold text-warning">
                        <AlertTriangle size={9} /> High risk
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[11.5px] leading-4 text-n-500">{cap.description}</p>
                  {inherited && explicit === undefined && (
                    <p className="mt-1 text-[11px] text-n-400">
                      From {inheritedFrom ?? 'the role'}: <strong>{effective ? 'granted' : 'not granted'}</strong>
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[var(--teal-500)]"
                      checked={effective}
                      disabled={disabled}
                      onChange={(e) => setCapability(cap.key, e.target.checked)}
                    />
                    <span className="text-[12px] text-n-600">{effective ? 'Granted' : 'Off'}</span>
                  </label>
                  {inherited && explicit !== undefined && (
                    <button
                      className="text-[11px] font-semibold text-teal-700 underline"
                      onClick={() => setCapability(cap.key, null)}
                      disabled={disabled}
                      title="Go back to what the role gives"
                    >
                      reset
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function Segmented({
  value, onChange, overridden, disabled,
}: {
  value: AccessLevel;
  onChange: (v: AccessLevel) => void;
  overridden: boolean;
  disabled?: boolean;
}) {
  return (
    <div className={`inline-flex overflow-hidden rounded-md border ${overridden ? 'border-teal-400' : 'border-n-200'}`}>
      {LEVELS.map((l) => (
        <button
          key={l.value}
          disabled={disabled}
          onClick={() => onChange(l.value)}
          className={`px-2.5 py-1.5 text-[12px] font-semibold transition ${
            value === l.value ? 'bg-teal-50 text-teal-800' : 'bg-n-0 text-n-500 hover:bg-n-50'
          } ${l.value !== 'none' ? 'border-l border-n-200' : ''} disabled:opacity-50`}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}
