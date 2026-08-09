import { useEffect, useState } from 'react';

/** True at the mobile breakpoint (≤767px, per the mobile web-view guide). SSR-safe and reactive
 *  to viewport/orientation changes. Use to switch a component between its desktop and mobile
 *  layout — never for anything that must also work without JS. */
export function useIsMobile(query = '(max-width: 767px)'): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  );
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}
