import { canArea, resolveAccess } from '../access/resolve';
import type { AccessLevel, GrantSet } from '../access/catalogue';

/**
 * Who should hear about something.
 *
 * The rule that makes this worth a file of its own is the last one: the person who caused the event
 * is not told about it. Without that, filing a shipment shows you a notification saying a shipment
 * has been filed, and a list that tells people what they just did is a list they learn to ignore —
 * which costs the notifications that matter, not just the redundant ones.
 *
 * Access is the other half. "Tell whoever works in Shipments" has to mean what the access catalogue
 * says it means, or a notification becomes a way to show a screen's contents to somebody who cannot
 * open that screen.
 *
 * PURE.
 */

export interface NotifiableUser {
  id: string;
  isAdmin: boolean;
  status?: string | null;
  deletedAt?: Date | null;
  role?: { grants?: unknown } | null;
  accessOverrides?: unknown;
}

export interface RecipientSpec {
  /** Told regardless of area, as long as they are still an active user. */
  userIds?: string[];
  /** Everyone who may work in this area. */
  area?: string;
  /** How much access the area needs — view is enough to be told, unless said otherwise. */
  level?: AccessLevel;
  /** Admins hold every area, so they are included by an area spec; this excludes them from one. */
  excludeAdmins?: boolean;
  /** Whoever caused the event. Never notified about their own action. */
  actorId?: string | null;
}

/** The users to write a notification row for. Ordered as given, each at most once. */
export function recipientsFor(spec: RecipientSpec, users: readonly NotifiableUser[]): string[] {
  const active = users.filter((u) => !u.deletedAt && (u.status ?? 'active') === 'active');
  const byId = new Map(active.map((u) => [u.id, u]));
  const out: string[] = [];
  const add = (id: string) => {
    if (id !== spec.actorId && byId.has(id) && !out.includes(id)) out.push(id);
  };

  for (const id of spec.userIds ?? []) add(id);

  if (spec.area) {
    for (const u of active) {
      if (u.isAdmin && spec.excludeAdmins) continue;
      const access = resolveAccess({
        isAdmin: u.isAdmin,
        role: (u.role?.grants ?? null) as GrantSet | null,
        overrides: (u.accessOverrides ?? null) as GrantSet | null,
      });
      if (canArea(access, spec.area, spec.level ?? 'view')) add(u.id);
    }
  }

  return out;
}
