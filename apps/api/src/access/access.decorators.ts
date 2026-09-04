import { SetMetadata } from '@nestjs/common';
import type { AccessLevel } from './catalogue';

export const ACCESS_AREA = 'access:area';
export const ACCESS_LEVEL = 'access:level';
export const ACCESS_CAPABILITY = 'access:capability';
export const ACCESS_SKIP = 'access:skip';

/**
 * Which area of the platform this controller (or one route on it) belongs to.
 *
 * Declared once at the top of a controller in almost every case. The guard works out whether the
 * request needs `view` or `edit` from the HTTP verb, so a controller of twenty routes usually needs
 * exactly one line — which is what makes annotating 309 routes tractable, and what stops the
 * annotation drifting out of step with the routes underneath it.
 *
 * Several areas may be named. The request is allowed if the caller holds ANY of them, which is what
 * a cross-cutting route like global search needs: it reaches into orders and products, and someone
 * who can see either has a legitimate reason to search.
 */
export const AccessArea = (...areas: string[]) => SetMetadata(ACCESS_AREA, areas);

/**
 * Override the level the verb implies.
 *
 * The two cases that need it: a POST that only reads — a preview, an estimate, a dry run — and a
 * GET that exposes something worth holding to a higher bar than reading a list.
 */
export const Requires = (level: AccessLevel) => SetMetadata(ACCESS_LEVEL, level);

/**
 * Additionally require a capability.
 *
 * On top of the area, never instead of it: publishing a listing needs both the right to work in
 * channel listings AND the separate right to write to a marketplace. Bundling the second into the
 * first is exactly how an ordinary edit right turns into an outage.
 */
export const RequireCapability = (capability: string) => SetMetadata(ACCESS_CAPABILITY, capability);

/**
 * Exempt a route from the access check.
 *
 * The guard denies anything it cannot find a declaration for, so this is the only way past it and
 * every use should be obvious from the route: signing in, the health probe, a marketplace webhook
 * that arrives with no user at all, and progress polling for a job the caller already started.
 */
export const NoAccessCheck = () => SetMetadata(ACCESS_SKIP, true);
