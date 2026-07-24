import { useEffect, useRef, useState } from 'react';

/** useState whose value is mirrored to localStorage under `key`, so it survives a page
 *  reload/refresh. Behaves like useState otherwise; the stored value is cleared only when the
 *  caller sets it back to an empty/default value (i.e. we persist whatever the user last chose).
 *
 *  Used for view filters: a reload keeps the applied filters until the user removes them. */
export function usePersistentState<T>(key: string, initial: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw != null ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });

  // Skip the very first write so hydrating from storage doesn't immediately rewrite the same value.
  const hydrated = useRef(false);
  useEffect(() => {
    if (!hydrated.current) { hydrated.current = true; return; }
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {
      /* storage full or unavailable — persistence is best-effort */
    }
  }, [key, state]);

  return [state, setState];
}
