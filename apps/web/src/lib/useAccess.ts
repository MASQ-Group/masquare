import { useAuth } from './auth';
import type { AccessLevel, EffectiveAccess } from './api';

/**
 * What the signed-in person may do.
 *
 * Read from `/auth/me`, which resolves it on the server. The browser never works it out from a role
 * plus overrides — there is one implementation of that question and it lives next to the guard that
 * enforces it, so the page and the API cannot drift into disagreeing.
 *
 * This hides things; it does not protect them. Every answer here is also enforced server-side, and
 * has to be: a hidden button is a courtesy, not a boundary.
 */

const RANK: Record<AccessLevel, number> = { none: 0, view: 1, edit: 2 };

export interface AccessHelpers {
  access: EffectiveAccess | null;
  /** Can they work in this area, at least to `level`? */
  can: (area: string, level?: AccessLevel) => boolean;
  /** Can they change things here? */
  canEdit: (area: string) => boolean;
  /** Do they hold this capability? */
  may: (capability: string) => boolean;
  /** Their level in an area, for a UI that shows the grade rather than a yes/no. */
  levelOf: (area: string) => AccessLevel;
  isAdmin: boolean;
  /** True until `/auth/me` has answered, so a screen can wait rather than flash the wrong thing. */
  loading: boolean;
}

export function useAccess(): AccessHelpers {
  const { user, loading } = useAuth();
  const access = user?.access ?? null;

  // Before the profile arrives, the honest answer is "we do not know yet", and the safe rendering
  // of that is "nothing" — a sidebar that briefly shows every link and then removes half of them
  // reads as a bug and teaches people to distrust it.
  const levelOf = (area: string): AccessLevel => access?.areas?.[area] ?? 'none';

  return {
    access,
    levelOf,
    can: (area, level: AccessLevel = 'view') => RANK[levelOf(area)] >= RANK[level],
    canEdit: (area) => RANK[levelOf(area)] >= RANK.edit,
    may: (capability) => access?.capabilities?.[capability] === true,
    isAdmin: access?.isAdmin ?? false,
    loading,
  };
}
