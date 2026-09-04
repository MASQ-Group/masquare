import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'auth:public';

/**
 * No sign-in required.
 *
 * Distinct from `@NoAccessCheck()`, and the pair is easy to confuse: this one says "there is no
 * user", the other says "there is a user and we are not asking what they may do". `/auth/me` needs
 * the second and must NOT have the first — it is your own profile, and it has to know whose.
 *
 * Three things legitimately need it: signing in, the health probe, and a marketplace webhook that
 * arrives from eBay with no user at all and is gated by its own signature check.
 */
export const Public = () => SetMetadata(IS_PUBLIC, true);
