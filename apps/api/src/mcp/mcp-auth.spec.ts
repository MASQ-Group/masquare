import { describe, expect, it } from 'vitest';
import { bearerMatches, matchCredential, MIN_TOKEN_LENGTH, readMcpConfig } from './mcp-auth';

const TOKEN = 'a'.repeat(MIN_TOKEN_LENGTH) + 'Zq9';
const ADMIN = 'b'.repeat(MIN_TOKEN_LENGTH) + 'Xw4';
const BOTH = { MCP_TOKEN: TOKEN, MCP_USER_EMAIL: 'content@example.com', MCP_ADMIN_TOKEN: ADMIN, MCP_ADMIN_USER_EMAIL: 'owner@example.com' };

describe('readMcpConfig', () => {
  it('turns on only with a long enough token and a user to act as', () => {
    expect(readMcpConfig({ MCP_TOKEN: TOKEN, MCP_USER_EMAIL: 'me@example.com' }))
      .toEqual({
        enabled: true,
        credentials: [{ kind: 'standard', token: TOKEN, userEmail: 'me@example.com' }],
        warnings: [],
      });
  });

  /** The failure that matters: a connector that accepted an empty token would be open to anyone. */
  it('stays off without a token', () => {
    expect(readMcpConfig({ MCP_USER_EMAIL: 'me@example.com' }).enabled).toBe(false);
    expect(readMcpConfig({ MCP_TOKEN: '   ', MCP_USER_EMAIL: 'me@example.com' }).enabled).toBe(false);
  });

  it('stays off with a token too short to be a key', () => {
    const v = readMcpConfig({ MCP_TOKEN: 'password123', MCP_USER_EMAIL: 'me@example.com' });
    expect(v.enabled).toBe(false);
  });

  it('stays off with nobody to act as', () => {
    expect(readMcpConfig({ MCP_TOKEN: TOKEN }).enabled).toBe(false);
  });

  it('never puts the token in the reason it gives', () => {
    const v = readMcpConfig({ MCP_TOKEN: TOKEN });
    expect(!v.enabled && v.reason).not.toContain(TOKEN);
  });
});

describe('readMcpConfig, owner token', () => {
  it('adds the owner token as a second credential acting as its own user', () => {
    const v = readMcpConfig(BOTH);
    expect(v.enabled && v.credentials).toEqual([
      { kind: 'standard', token: TOKEN, userEmail: 'content@example.com' },
      { kind: 'admin', token: ADMIN, userEmail: 'owner@example.com' },
    ]);
    expect(v.enabled && v.warnings).toEqual([]);
  });

  /** A stray owner token must not switch on a connector the operator believes is off. */
  it('does not turn the connector on by itself', () => {
    expect(readMcpConfig({ MCP_ADMIN_TOKEN: ADMIN, MCP_ADMIN_USER_EMAIL: 'owner@example.com' }).enabled).toBe(false);
  });

  it('keeps the everyday token working when the owner token is misconfigured, and says why', () => {
    for (const env of [
      { ...BOTH, MCP_ADMIN_TOKEN: 'short' },
      { ...BOTH, MCP_ADMIN_USER_EMAIL: '' },
      { ...BOTH, MCP_ADMIN_TOKEN: TOKEN },
    ]) {
      const v = readMcpConfig(env);
      expect(v.enabled && v.credentials.map((c) => c.kind)).toEqual(['standard']);
      expect(v.enabled && v.warnings).toHaveLength(1);
      expect(v.enabled && v.warnings.join(' ')).not.toContain(TOKEN);
    }
  });
});

describe('matchCredential', () => {
  const v = readMcpConfig(BOTH);
  const credentials = v.enabled ? v.credentials : [];

  it('names the user each token acts as', () => {
    expect(matchCredential(`Bearer ${TOKEN}`, credentials)?.userEmail).toBe('content@example.com');
    expect(matchCredential(`Bearer ${ADMIN}`, credentials)?.userEmail).toBe('owner@example.com');
  });

  it('refuses anything else', () => {
    expect(matchCredential(`Bearer ${ADMIN}x`, credentials)).toBeNull();
    expect(matchCredential(undefined, credentials)).toBeNull();
    expect(matchCredential(`Bearer ${TOKEN}`, [])).toBeNull();
  });
});

describe('bearerMatches', () => {
  it('accepts the configured token as a bearer credential', () => {
    expect(bearerMatches(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
    expect(bearerMatches(`bearer ${TOKEN}`, TOKEN)).toBe(true);
  });

  it('refuses a wrong token, including one that shares a long prefix', () => {
    expect(bearerMatches(`Bearer ${TOKEN.slice(0, -1)}X`, TOKEN)).toBe(false);
    expect(bearerMatches(`Bearer ${TOKEN}extra`, TOKEN)).toBe(false);
  });

  it('refuses the token under any scheme but Bearer, or bare', () => {
    expect(bearerMatches(TOKEN, TOKEN)).toBe(false);
    expect(bearerMatches(`Basic ${TOKEN}`, TOKEN)).toBe(false);
  });

  it('refuses a missing or empty header, and never matches an empty expected token', () => {
    expect(bearerMatches(undefined, TOKEN)).toBe(false);
    expect(bearerMatches('', TOKEN)).toBe(false);
    expect(bearerMatches('Bearer ', TOKEN)).toBe(false);
    expect(bearerMatches('Bearer anything', '')).toBe(false);
  });

  it('reads the first value when a header arrives twice', () => {
    expect(bearerMatches([`Bearer ${TOKEN}`, 'Bearer wrong'], TOKEN)).toBe(true);
  });
});
