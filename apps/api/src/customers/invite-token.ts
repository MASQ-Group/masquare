import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Invitations to set a password.
 *
 * Two rules, and both are about what we choose NOT to hold. The platform never knows a portal
 * user's password, because an admin who sets one has to say it out loud to somebody. And only the
 * HASH of an invitation token is stored, because a database of working invitation links is a
 * database of accounts — the same reasoning as passwords, applied to the thing that creates one.
 *
 * PURE apart from the random bytes, which is the one part that must not be.
 */

/** How long an invitation is good for. Long enough for a holiday, short enough to be worth resending. */
export const INVITE_TTL_DAYS = 7;

/** The shortest password we will accept. Length beats cleverness, so nothing else is demanded. */
export const MIN_PASSWORD_LENGTH = 10;

/** A fresh invitation: the token to email, and the hash to keep. */
export function createInviteToken(): { token: string; tokenHash: string } {
  // 32 bytes: far beyond guessing, and short enough to survive an email client's line wrapping.
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token.trim()).digest('hex');
}

/**
 * Whether two hashes match, without leaking how far the comparison got.
 *
 * A token is looked up by its hash, so this is belt and braces — but the cost is a line, and the
 * habit is worth more than the line.
 */
export function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function expiryFrom(now: Date, days = INVITE_TTL_DAYS): Date {
  return new Date(now.getTime() + days * 86_400_000);
}

export type InviteState = 'valid' | 'used' | 'expired';

/** What an invitation is worth now. Used beats expired: it is the more useful thing to be told. */
export function inviteState(invite: { expiresAt: Date; usedAt: Date | null }, now: Date = new Date()): InviteState {
  if (invite.usedAt) return 'used';
  if (invite.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'valid';
}

/** What to tell somebody holding an invitation that will not work. */
export const INVITE_REFUSALS: Record<Exclude<InviteState, 'valid'>, string> = {
  used: 'This invitation has already been used. If that was not you, ask your contact to send a new one.',
  expired: `This invitation has expired — they are good for ${INVITE_TTL_DAYS} days. Ask your contact to send a new one.`,
};

/**
 * What is wrong with a proposed password, if anything.
 *
 * A length floor and nothing else. Composition rules — a capital, a digit, a symbol — push people
 * towards `Password1!` and away from the long unremarkable phrases that are actually harder to
 * guess, so they are deliberately absent.
 */
export function passwordProblems(password: string | null | undefined): string[] {
  const value = password ?? '';
  const problems: string[] = [];
  if (value.length < MIN_PASSWORD_LENGTH) problems.push(`The password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  if (value.trim().length === 0) problems.push('The password cannot be only spaces.');
  return problems;
}
