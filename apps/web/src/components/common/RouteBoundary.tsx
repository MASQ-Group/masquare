import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

/**
 * Something must be left on screen when a route fails to render.
 *
 * Every page is a lazy `import()`, and a deploy renames the hashed chunk files. A tab left open
 * across a deploy therefore asks for a file the server no longer has: the import rejects, React
 * unmounts the whole tree because nothing catches it, and the screen goes blank. Reloading fixes
 * it — which is the tell, and also the cure.
 *
 * So a stale chunk reloads itself, once. The app on the server is simply newer than the one in the
 * tab, and there is nothing for a person to decide about that.
 *
 * The reload is guarded by a session flag. A genuinely broken build would otherwise reload
 * forever, turning one visible failure into an invisible loop — and a page that will not stop
 * refreshing is harder to diagnose than a page that says what went wrong.
 *
 * Anything else renders a readable panel. A blank screen is the one outcome not allowed: it tells
 * nobody anything, and it looks identical whether the cause is a stale chunk, a thrown render, or
 * a network that dropped.
 */

const RELOAD_FLAG = 'masquare.chunkReloadAt';
/** Two reloads inside this window means reloading is not helping. */
const RELOAD_COOLDOWN_MS = 30_000;

/**
 * Did this error come from a module that would not load?
 *
 * The wording differs per browser and bundler, so this matches on all of them rather than the one
 * this developer's browser happened to produce.
 */
export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? '');
  return /ChunkLoadError|Loading chunk \d+ failed|dynamically imported module|Importing a module script failed|error loading dynamically imported module|Failed to fetch dynamically imported module/i.test(
    message,
  );
}

interface Props { children: ReactNode }
interface State { error: Error | null; reloading: boolean }

export class RouteBoundary extends Component<Props, State> {
  state: State = { error: null, reloading: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Logged whatever the cause: a stale chunk about to self-heal is still worth a line in the
    // console, and a real render error needs its component stack.
    // eslint-disable-next-line no-console
    console.error('Route failed to render', error, info.componentStack);

    if (!isChunkLoadError(error)) return;

    const last = Number(sessionStorage.getItem(RELOAD_FLAG) ?? 0);
    if (Date.now() - last < RELOAD_COOLDOWN_MS) return; // already tried; do not loop

    sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
    this.setState({ reloading: true });
    window.location.reload();
  }

  private retry = () => {
    sessionStorage.removeItem(RELOAD_FLAG);
    window.location.reload();
  };

  render() {
    const { error, reloading } = this.state;
    if (!error) return this.props.children;

    if (reloading) {
      return (
        <div className="grid h-full place-items-center text-[13px] text-n-500">
          Updating to the latest version…
        </div>
      );
    }

    const stale = isChunkLoadError(error);
    return (
      <div className="grid h-full place-items-center p-8">
        <div className="max-w-[520px] rounded-lg border border-n-200 bg-n-0 p-5">
          <div className="flex items-start gap-2.5">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600" />
            <div className="flex-1">
              <div className="text-[15px] font-semibold text-n-900">
                {stale ? 'This page could not be loaded' : 'This page stopped working'}
              </div>
              <p className="mt-1 text-[13px] text-n-600">
                {stale
                  ? 'A newer version of the platform is running on the server and this tab could not fetch part of it. Reloading should pick it up.'
                  : 'Something went wrong rendering this page. Nothing you were looking at has been changed.'}
              </p>
              {/* The message, verbatim. A person reporting this needs something to quote, and a
                  paraphrase loses the one detail that identifies the fault. */}
              <pre className="mono mt-2 max-h-[120px] overflow-auto rounded border border-n-200 bg-n-25 p-2 text-[11px] text-n-600">
                {error.message}
              </pre>
              <button
                type="button"
                onClick={this.retry}
                className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md border border-n-200 bg-n-0 px-3 text-[13px] font-semibold text-n-700 hover:border-teal-300 hover:text-teal-700"
              >
                <RefreshCw size={14} /> Reload the page
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
