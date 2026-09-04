import { describe, expect, it } from 'vitest';
import { AREA_KEYS, CAPABILITY_KEYS, meetsLevel } from './catalogue';
import { canArea, canDo, describeAccess, resolveAccess, sanitiseGrants, validateGrants, visibleAreas } from './resolve';
import { DEFAULT_ROLES } from './default-roles';

/**
 * The rules that decide what somebody may do.
 *
 * Every one of these fails open if it breaks — a resolver bug does not throw, it hands back an
 * access set that is quietly too generous, and the only symptom is somebody doing something they
 * should not have been able to. So the tests assert the denials as hard as the grants.
 */

const WAREHOUSE = DEFAULT_ROLES.find((r) => r.key === 'warehouse')!.grants;
const OPERATIONS = DEFAULT_ROLES.find((r) => r.key === 'operations')!.grants;

describe('level ordering', () => {
  it('lets edit satisfy a requirement of view', () => {
    expect(meetsLevel('edit', 'view')).toBe(true);
    expect(meetsLevel('view', 'view')).toBe(true);
    expect(meetsLevel('none', 'view')).toBe(false);
    expect(meetsLevel('view', 'edit')).toBe(false);
  });
});

describe('resolving access', () => {
  it('gives an admin everything, without consulting a role', () => {
    // Their access must not depend on a role existing, or removing one would lock out the person
    // able to put it back.
    const access = resolveAccess({ isAdmin: true, role: null, overrides: null });
    expect(Object.values(access.areas).every((l) => l === 'edit')).toBe(true);
    expect(Object.values(access.capabilities).every(Boolean)).toBe(true);
  });

  it('gives someone with no role and no overrides nothing at all', () => {
    const access = resolveAccess({ isAdmin: false, role: null, overrides: null });
    expect(Object.values(access.areas).every((l) => l === 'none')).toBe(true);
    expect(Object.values(access.capabilities).every((c) => c === false)).toBe(true);
    expect(visibleAreas(access)).toEqual([]);
  });

  it('answers for every area and capability, so no caller has to guess what absent means', () => {
    const access = resolveAccess({ isAdmin: false, role: { areas: { inventory: 'edit' }, capabilities: {} } });
    expect(Object.keys(access.areas).sort()).toEqual([...AREA_KEYS].sort());
    expect(Object.keys(access.capabilities).sort()).toEqual([...CAPABILITY_KEYS].sort());
  });

  it('takes the role when there is no override', () => {
    const access = resolveAccess({ isAdmin: false, role: WAREHOUSE });
    expect(access.areas.inventory).toBe('edit');
    expect(access.areas.pricing).toBe('none');
    expect(access.capabilities.bulk_import).toBe(true);
  });
});

describe('per-user overrides', () => {
  it('widens a role for one person', () => {
    const access = resolveAccess({ isAdmin: false, role: WAREHOUSE, overrides: { areas: { analytics: 'view' }, capabilities: {} } });
    expect(access.areas.analytics).toBe('view');
    expect(access.areas.inventory).toBe('edit'); // the rest of the role is untouched
  });

  it('narrows a role for one person', () => {
    // The point of replacing rather than merging upward: an override has to be able to take away.
    const access = resolveAccess({ isAdmin: false, role: WAREHOUSE, overrides: { areas: { inventory: 'view' }, capabilities: {} } });
    expect(access.areas.inventory).toBe('view');
  });

  it('revokes a capability the role grants', () => {
    // `false` must not fall through to the role's `true` — the difference between ?? and ||, and
    // the whole reason an override is stored as an explicit boolean rather than a presence flag.
    const access = resolveAccess({ isAdmin: false, role: OPERATIONS, overrides: { areas: {}, capabilities: { marketplace_write: false } } });
    expect(access.capabilities.marketplace_write).toBe(false);
    expect(access.capabilities.bulk_import).toBe(true);
  });

  it('grants a capability the role withholds', () => {
    const access = resolveAccess({ isAdmin: false, role: WAREHOUSE, overrides: { areas: {}, capabilities: { marketplace_write: true } } });
    expect(access.capabilities.marketplace_write).toBe(true);
  });

  it('cannot be used to climb past an admin check', () => {
    // Overrides shape areas and capabilities, never the admin flag itself.
    const access = resolveAccess({
      isAdmin: false,
      role: OPERATIONS,
      overrides: { areas: { administration: 'edit' }, capabilities: {} },
    });
    expect(access.isAdmin).toBe(false);
  });
});

describe('grants that no longer match the catalogue', () => {
  it('drops an area key the catalogue does not know', () => {
    // A renamed area would otherwise sit in a role forever, granting nothing — and start granting
    // again if the key ever came back into use.
    const cleaned = sanitiseGrants({ areas: { inventory: 'edit', dispatch_desk: 'edit' }, capabilities: {} });
    expect(cleaned.areas).toEqual({ inventory: 'edit' });
  });

  it('drops a level that is not one of ours', () => {
    const cleaned = sanitiseGrants({ areas: { inventory: 'admin' }, capabilities: {} });
    expect(cleaned.areas).toEqual({});
  });

  it('drops a capability that is not a boolean', () => {
    const cleaned = sanitiseGrants({ areas: {}, capabilities: { bulk_import: 'yes' } });
    expect(cleaned.capabilities).toEqual({});
  });

  it('survives rubbish without throwing', () => {
    for (const junk of [null, undefined, 42, 'nope', []]) {
      expect(() => sanitiseGrants(junk)).not.toThrow();
      expect(sanitiseGrants(junk)).toEqual({ areas: {}, capabilities: {} });
    }
  });
});

describe('validating grants on the way in', () => {
  it('accepts a well-formed set', () => {
    const res = validateGrants({ areas: { inventory: 'edit' }, capabilities: { bulk_import: true } });
    expect(res.ok).toBe(true);
  });

  it('names the offending key rather than dropping it silently', () => {
    // Dropping it would let someone save a role, watch the toggle vanish on reload, and have
    // nothing telling them why.
    const res = validateGrants({ areas: { made_up: 'edit' }, capabilities: {} });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors[0]).toMatch(/"made_up" is not an area/);
  });

  it('rejects a bad level with the permitted values in the message', () => {
    const res = validateGrants({ areas: { inventory: 'full' }, capabilities: {} });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors[0]).toMatch(/none, view or edit/);
  });
});

describe('the shipped roles', () => {
  it('names every area, so a new area is a deliberate decision rather than a silent none', () => {
    for (const role of DEFAULT_ROLES) {
      const missing = AREA_KEYS.filter((k) => !(k in role.grants.areas));
      expect(missing, `${role.key} does not mention: ${missing.join(', ')}`).toEqual([]);
    }
  });

  it('gives no shipped role the ability to change other people’s access', () => {
    // Administration is the one area that lets someone widen their own grants. It stays with the
    // platform-admin flag until it is handed out deliberately.
    for (const role of DEFAULT_ROLES) {
      expect(role.grants.areas.administration, role.key).toBe('none');
    }
  });

  it('keeps marketplace writing to Operations alone', () => {
    const allowed = DEFAULT_ROLES.filter((r) => r.grants.capabilities.marketplace_write).map((r) => r.key);
    expect(allowed).toEqual(['operations']);
  });

  it('lets the warehouse move stock without letting it reach a marketplace', () => {
    const access = resolveAccess({ isAdmin: false, role: WAREHOUSE });
    expect(canArea(access, 'inventory', 'edit')).toBe(true);
    expect(canDo(access, 'marketplace_write')).toBe(false);
  });

  it('lets read-only see without changing anything', () => {
    const role = DEFAULT_ROLES.find((r) => r.key === 'read_only')!;
    const access = resolveAccess({ isAdmin: false, role: role.grants });
    expect(AREA_KEYS.every((k) => access.areas[k] !== 'edit')).toBe(true);
    expect(Object.values(access.capabilities).every((c) => c === false)).toBe(true);
  });
});

describe('describing access in a list', () => {
  it('says admin rather than counting to fifteen', () => {
    expect(describeAccess(resolveAccess({ isAdmin: true }))).toMatch(/Platform admin/);
  });

  it('says so plainly when someone holds nothing', () => {
    expect(describeAccess(resolveAccess({ isAdmin: false }))).toBe('No access');
  });

  it('counts what is editable and what is read-only', () => {
    const access = resolveAccess({ isAdmin: false, role: WAREHOUSE });
    expect(describeAccess(access)).toMatch(/\d+ editable · \d+ read-only/);
  });
});
