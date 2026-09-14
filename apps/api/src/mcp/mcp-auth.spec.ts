import { describe, expect, it } from 'vitest';
import { bearerMatches, MIN_TOKEN_LENGTH, readMcpConfig } from './mcp-auth';

const TOKEN = 'a'.repeat(MIN_TOKEN_LENGTH) + 'Zq9';

describe('readMcpConfig', () => {
  it('turns on only with a long enough token and a user to act as', () => {
    expect(readMcpConfig({ MCP_TOKEN: TOKEN, MCP_USER_EMAIL: 'me@example.com' }))
      .toEqual({ enabled: true, token: TOKEN, userEmail: 'me@example.com' });
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
