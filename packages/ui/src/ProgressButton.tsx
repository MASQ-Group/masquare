export interface ProgressButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'value'> {
  /** True while the action is running. */
  running?: boolean;
  /** 0–1 once the size of the run is known; null while it is not. */
  value?: number | null;
  /** Replaces the children while running, e.g. "Recomputing". */
  runningLabel?: React.ReactNode;
  /** Matches the two header button styles: hbtn-primary and hbtn. */
  tone?: 'primary' | 'neutral';
  /** The precise state in words — "1,240 of 3,000 · about 4 min left". Announced, and on hover. */
  detail?: string;
}

/**
 * A button that reports how far its own action has got.
 *
 * These actions run for minutes — recomputing floors is one live SP-API call per SKU — and a
 * spinner cannot tell "working" from "wedged", so runs were abandoned and restarted. The fill is
 * the button's own width, which makes the button the thing you watch instead of something you
 * clicked and then had to guess about.
 *
 * The fill is a translucent overlay rather than a colour, so it works on any button background
 * without being told what that background is. Progress is only ever drawn from a real count: with
 * no total known it sweeps instead, because a bar advancing on nothing is a lie about the state.
 */
export function ProgressButton({
  running = false,
  value = null,
  runningLabel,
  tone = 'neutral',
  detail,
  children,
  className = '',
  disabled,
  ...rest
}: ProgressButtonProps) {
  const base = tone === 'primary' ? 'hbtn-primary' : 'hbtn';
  const fill = tone === 'primary' ? 'bg-white/30' : 'bg-teal-500/20';
  const pct = value == null ? null : Math.max(0, Math.min(100, Math.round(value * 100)));

  return (
    <button
      {...rest}
      disabled={disabled || running}
      aria-busy={running || undefined}
      title={running ? detail : rest.title}
      className={`${base} relative isolate overflow-hidden ${className}`}
    >
      {running && pct != null && (
        <span
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label={detail ?? 'Progress'}
          style={{ width: `${pct}%` }}
          className={`absolute inset-y-0 left-0 -z-10 ${fill} transition-[width] duration-500 ease-out motion-reduce:transition-none`}
        />
      )}
      {running && pct == null && (
        <span aria-hidden className="absolute inset-y-0 left-0 -z-10 w-1/3 overflow-hidden">
          <span className={`progress-sweep block h-full w-full ${fill}`} />
        </span>
      )}

      {running ? runningLabel ?? children : children}
      {running && pct != null && <span className="tabular-nums font-semibold opacity-90">{pct}%</span>}
    </button>
  );
}
