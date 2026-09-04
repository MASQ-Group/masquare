import {
  AREA_KEYS,
  AREAS,
  CAPABILITY_KEYS,
  EMPTY_GRANTS,
  type AccessLevel,
  type EffectiveAccess,
  type GrantSet,
  isAccessLevel,
  isAreaKey,
  isCapabilityKey,
  meetsLevel,
} from './catalogue';

/**
 * Turning what is stored into what a person may actually do.
 *
 * Three inputs, in order of authority: the platform-admin flag, the role, and the user's own
 * overrides. Everything below is deliberately total — every area and every capability comes back
 * with a value — so no caller ever has to decide what a missing key means. Absent means no access,
 * decided once, here.
 */

/** The safe answer for someone with no role and no overrides: nothing. */
export function noAccess(): EffectiveAccess {
  return {
    areas: Object.fromEntries(AREA_KEYS.map((k) => [k, 'none' as AccessLevel])),
    capabilities: Object.fromEntries(CAPABILITY_KEYS.map((k) => [k, false])),
    isAdmin: false,
  };
}

/** A platform admin holds everything. The flag stays the one true super-user switch. */
export function fullAccess(): EffectiveAccess {
  return {
    areas: Object.fromEntries(AREA_KEYS.map((k) => [k, 'edit' as AccessLevel])),
    capabilities: Object.fromEntries(CAPABILITY_KEYS.map((k) => [k, true])),
    isAdmin: true,
  };
}

export interface ResolveInput {
  isAdmin: boolean;
  /** The role's grants, or null when the user has no role. */
  role?: GrantSet | null;
  /** Per-user deltas. A key present here REPLACES the role's value for that key. */
  overrides?: GrantSet | null;
}

/**
 * Resolve one user's effective access.
 *
 * Overrides replace rather than merge upward, which is what makes them able to take something away
 * as well as add it. A Warehouse role that grants `inventory: edit` can be narrowed to `view` for
 * one person without inventing a second role, and `marketplace_write: false` can be pinned on
 * someone whose role would otherwise allow it.
 */
export function resolveAccess(input: ResolveInput): EffectiveAccess {
  // Checked first and returned whole: an admin's access must not depend on a role being present,
  // or removing a role would quietly lock out the person able to restore it.
  if (input.isAdmin) return fullAccess();

  const role = sanitiseGrants(input.role);
  const overrides = sanitiseGrants(input.overrides);
  const out = noAccess();

  for (const key of AREA_KEYS) {
    const level = overrides.areas[key] ?? role.areas[key];
    if (level) out.areas[key] = level;
  }
  for (const key of CAPABILITY_KEYS) {
    // `?? role` rather than `|| role`: an override of `false` is a deliberate revocation and must
    // not fall through to the role's `true`.
    const held = overrides.capabilities[key] ?? role.capabilities[key];
    out.capabilities[key] = held === true;
  }

  return out;
}

/**
 * Drop anything the catalogue does not recognise.
 *
 * Stored grants outlive the code that made them. A renamed area would otherwise sit in a role
 * forever, granting nothing and explaining nothing; worse, a key that later comes back into use
 * would silently start granting again. Unknown keys are discarded on read, and refused on write by
 * `validateGrants` below, so the two ends disagree only in favour of less access.
 */
export function sanitiseGrants(raw: unknown): GrantSet {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_GRANTS, areas: {}, capabilities: {} };
  const src = raw as Partial<GrantSet>;
  const areas: GrantSet['areas'] = {};
  const capabilities: GrantSet['capabilities'] = {};

  for (const [key, value] of Object.entries(src.areas ?? {})) {
    if (isAreaKey(key) && isAccessLevel(value)) areas[key] = value;
  }
  for (const [key, value] of Object.entries(src.capabilities ?? {})) {
    if (isCapabilityKey(key) && typeof value === 'boolean') capabilities[key] = value;
  }
  return { areas, capabilities };
}

/**
 * Check grants on the way in and say exactly what is wrong.
 *
 * Silently dropping a bad key on write would let someone save a role, see the toggle they set
 * disappear on reload, and have nothing to tell them why.
 */
export function validateGrants(raw: unknown): { ok: true; grants: GrantSet } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (raw != null && typeof raw !== 'object') return { ok: false, errors: ['Grants must be an object.'] };
  const src = (raw ?? {}) as Partial<GrantSet>;

  for (const [key, value] of Object.entries(src.areas ?? {})) {
    if (!isAreaKey(key)) errors.push(`"${key}" is not an area.`);
    else if (!isAccessLevel(value)) errors.push(`"${key}" must be none, view or edit — got "${String(value)}".`);
  }
  for (const [key, value] of Object.entries(src.capabilities ?? {})) {
    if (!isCapabilityKey(key)) errors.push(`"${key}" is not a capability.`);
    else if (typeof value !== 'boolean') errors.push(`Capability "${key}" must be true or false.`);
  }

  return errors.length ? { ok: false, errors } : { ok: true, grants: sanitiseGrants(src) };
}

// ---------------------------------------------------------------- asking questions of it

export const canArea = (access: EffectiveAccess, area: string, required: AccessLevel = 'view'): boolean =>
  meetsLevel(access.areas[area] ?? 'none', required);

export const canDo = (access: EffectiveAccess, capability: string): boolean => access.capabilities[capability] === true;

/** Areas the person can at least see — what the sidebar is built from. */
export const visibleAreas = (access: EffectiveAccess): string[] => AREAS.filter((a) => canArea(access, a.key)).map((a) => a.key);

/**
 * A one-line summary for the users list, so a row says something more useful than a count.
 * Admins are stated as such rather than counted, because "15 areas" would read as a coincidence.
 */
export function describeAccess(access: EffectiveAccess): string {
  if (access.isAdmin) return 'Platform admin — full access';
  const edit = AREA_KEYS.filter((k) => access.areas[k] === 'edit').length;
  const view = AREA_KEYS.filter((k) => access.areas[k] === 'view').length;
  const caps = CAPABILITY_KEYS.filter((k) => access.capabilities[k]).length;
  if (edit === 0 && view === 0) return 'No access';
  const parts = [`${edit} editable`, `${view} read-only`];
  if (caps) parts.push(`${caps} capabilit${caps === 1 ? 'y' : 'ies'}`);
  return parts.join(' · ');
}
