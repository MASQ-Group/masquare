import { describe, expect, it } from 'vitest';
import {
  INVITE_TTL_DAYS, MIN_PASSWORD_LENGTH, createInviteToken, expiryFrom, hashToken, hashesMatch, inviteState, passwordProblems,
} from './invite-token';

const NOW = new Date('2026-09-17T12:00:00Z');

describe('the token', () => {
  it('is different every time', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => createInviteToken().token));
    expect(tokens.size).toBe(50);
  });

  it('is long enough not to be guessed, and safe in a URL', () => {
    const { token } = createInviteToken();
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  /** The point of the whole file: a stolen database is a list of hashes, not working invitations. */
  it('is never itself what gets stored', () => {
    const { token, tokenHash } = createInviteToken();
    expect(tokenHash).not.toContain(token);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).toBe(tokenHash);
  });

  it('hashes the same token to the same value, whitespace and all', () => {
    const { token, tokenHash } = createInviteToken();
    expect(hashToken(`  ${token}\n`)).toBe(tokenHash);
  });

  it('compares hashes without leaking where they differ', () => {
    const a = hashToken('one');
    expect(hashesMatch(a, hashToken('one'))).toBe(true);
    expect(hashesMatch(a, hashToken('two'))).toBe(false);
    expect(hashesMatch(a, 'short')).toBe(false);
  });
});

describe('how long an invitation lasts', () => {
  it('expires a week after it was sent', () => {
    expect(expiryFrom(NOW).toISOString()).toBe('2026-09-24T12:00:00.000Z');
    expect(INVITE_TTL_DAYS).toBe(7);
  });

  it('is good until then', () => {
    expect(inviteState({ expiresAt: expiryFrom(NOW), usedAt: null }, NOW)).toBe('valid');
  });

  it('is expired the moment it runs out, not a moment after', () => {
    const expiresAt = expiryFrom(NOW);
    expect(inviteState({ expiresAt, usedAt: null }, expiresAt)).toBe('expired');
  });

  it('is spent once it has been used — one link, one password', () => {
    expect(inviteState({ expiresAt: expiryFrom(NOW), usedAt: NOW }, NOW)).toBe('used');
  });

  /** Being told it was already used is more useful than being told it also happens to be old. */
  it('says used rather than expired when it is both', () => {
    expect(inviteState({ expiresAt: new Date('2026-01-01'), usedAt: new Date('2026-01-01') }, NOW)).toBe('used');
  });
});

describe('the password somebody chooses', () => {
  it('accepts an ordinary long one', () => {
    expect(passwordProblems('correct horse battery staple')).toEqual([]);
  });

  it('insists on a length', () => {
    expect(passwordProblems('short')).toHaveLength(1);
    expect(passwordProblems('a'.repeat(MIN_PASSWORD_LENGTH))).toEqual([]);
  });

  it('refuses a password of spaces however long', () => {
    expect(passwordProblems('              ')).toContain('The password cannot be only spaces.');
  });

  /**
   * No composition rules, deliberately: demanding a capital, a digit and a symbol produces
   * `Password1!` and rules out the long unremarkable phrases that are harder to guess.
   */
  it('asks for nothing but length', () => {
    expect(passwordProblems('aaaaaaaaaaaaaaa')).toEqual([]);
  });

  it('refuses nothing at all', () => {
    expect(passwordProblems('').length).toBeGreaterThan(0);
    expect(passwordProblems(null).length).toBeGreaterThan(0);
  });
});
