import { useRef } from 'react';

export interface TabItem<K extends string = string> {
  key: K;
  label: string;
  /** Shown as a badge. Omit, or pass null, when there is nothing worth counting. */
  count?: number | null;
  /** Colours the badge. Use 'warning'/'danger' for counts that mean something needs attention. */
  tone?: 'neutral' | 'warning' | 'danger';
  /** Optional leading icon. */
  icon?: React.ReactNode;
}

export interface TabBarProps<K extends string = string> {
  tabs: TabItem<K>[];
  value: K;
  onChange: (key: K) => void;
  /** Accessible name, e.g. "Repricing sections". */
  label?: string;
  className?: string;
}

const BADGE_TONE: Record<string, string> = {
  neutral: 'bg-n-100 text-n-600',
  warning: 'bg-warning-bg text-warning',
  danger: 'bg-danger-bg text-danger',
};

/**
 * The platform's page-level tab control.
 *
 * Arrow keys move between tabs and only the selected tab is in the tab order, which is what the
 * tablist pattern expects — tabbing through five sections to reach the table below is not
 * navigation, it is an obstacle. On a narrow screen the strip scrolls sideways rather than
 * wrapping, so the tabs keep their single-row shape.
 */
export function TabBar<K extends string = string>({ tabs, value, onChange, label, className = '' }: TabBarProps<K>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const move = (from: number, delta: number) => {
    const next = (from + delta + tabs.length) % tabs.length;
    onChange(tabs[next].key);
    refs.current[next]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    const keys: Record<string, () => void> = {
      ArrowRight: () => move(index, 1),
      ArrowLeft: () => move(index, -1),
      Home: () => move(0, 0),
      End: () => move(tabs.length - 1, 0),
    };
    const handler = keys[e.key];
    if (!handler) return;
    e.preventDefault();
    handler();
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      className={`flex max-w-full gap-0 overflow-x-auto rounded-lg border border-n-200 bg-n-0 p-[3px] ${className}`}
    >
      {tabs.map((t, i) => {
        const active = t.key === value;
        return (
          <button
            key={t.key}
            ref={(el) => { refs.current[i] = el; }}
            role="tab"
            type="button"
            id={`tab-${t.key}`}
            aria-selected={active}
            aria-controls={`tabpanel-${t.key}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.key)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`flex h-[34px] shrink-0 items-center gap-2 rounded-md px-3 text-[13px] font-semibold transition-colors ${
              active ? 'bg-teal-500 text-white' : 'text-n-600 hover:text-n-900'
            }`}
          >
            {t.icon}
            {t.label}
            {t.count != null && (
              <span
                className={`rounded-full px-1.5 text-[11px] font-bold tabular-nums ${
                  active ? 'bg-white/25 text-white' : BADGE_TONE[t.tone ?? 'neutral']
                }`}
              >
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** The panel a tab controls. Pairs with TabBar's ids so the two are associated for screen readers. */
export function TabPanel({ tabKey, active, children }: { tabKey: string; active: boolean; children: React.ReactNode }) {
  if (!active) return null;
  return (
    <div role="tabpanel" id={`tabpanel-${tabKey}`} aria-labelledby={`tab-${tabKey}`} tabIndex={0} className="outline-none">
      {children}
    </div>
  );
}
