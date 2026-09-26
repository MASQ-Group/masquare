import { describe, expect, it } from 'vitest';
import { DEFAULT_REDIRECT_HOSTS, oauthSigningKey, readOAuthConfig, redirectAllowed } from './oauth-config';

const ON = { MCP_PUBLIC_URL: 'https://app.masquare.eu', MCP_OAUTH_ALLOWED_EMAILS: 'Content@Masquare.eu' };

describe('readOAuthConfig', () => {
  it('turns on with a public https address and at least one allowed account', () => {
    const c = readOAuthConfig(ON);
    expect(c.enabled).toBe(true);
    if (!c.enabled) return;
    expect(c.issuer.href).toBe('https://app.masquare.eu/');
    expect(c.resource.href).toBe('https://app.masquare.eu/api/mcp');
    expect([...c.allowedEmails]).toEqual(['content@masquare.eu']);
    expect(c.redirectHosts).toEqual(DEFAULT_REDIRECT_HOSTS);
  });

  it('is quietly off when neither setting is present', () => {
    expect(readOAuthConfig({})).toEqual({ enabled: false, reason: null });
  });

  /** An empty list would mean a sign-in page nobody can pass; better that it does not exist. */
  it('stays off, and says why, with only one of the two settings', () => {
    for (const env of [{ MCP_PUBLIC_URL: ON.MCP_PUBLIC_URL }, { MCP_OAUTH_ALLOWED_EMAILS: ON.MCP_OAUTH_ALLOWED_EMAILS }]) {
      const c = readOAuthConfig(env);
      expect(c.enabled).toBe(false);
      expect(!c.enabled && c.reason).toBeTruthy();
    }
  });

  it('refuses a plain http address except on this computer', () => {
    expect(readOAuthConfig({ ...ON, MCP_PUBLIC_URL: 'http://app.masquare.eu' }).enabled).toBe(false);
    expect(readOAuthConfig({ ...ON, MCP_PUBLIC_URL: 'http://localhost:3000' }).enabled).toBe(true);
    expect(readOAuthConfig({ ...ON, MCP_PUBLIC_URL: 'not a url' }).enabled).toBe(false);
  });

  it('keeps only the origin, so a stray path does not move the well-known addresses', () => {
    const c = readOAuthConfig({ ...ON, MCP_PUBLIC_URL: 'https://app.masquare.eu/api/' });
    expect(c.enabled && c.resource.href).toBe('https://app.masquare.eu/api/mcp');
  });

  it('reads several allowed accounts, separated by commas or spaces', () => {
    const c = readOAuthConfig({ ...ON, MCP_OAUTH_ALLOWED_EMAILS: 'a@x.eu, b@x.eu  c@x.eu' });
    expect(c.enabled && [...c.allowedEmails]).toEqual(['a@x.eu', 'b@x.eu', 'c@x.eu']);
  });
});

describe('redirectAllowed', () => {
  const hosts = DEFAULT_REDIRECT_HOSTS;

  it("accepts Claude's own callback and local apps on the loopback address", () => {
    expect(redirectAllowed('https://claude.ai/api/mcp/auth_callback', hosts)).toBe(true);
    expect(redirectAllowed('https://claude.com/api/mcp/auth_callback', hosts)).toBe(true);
    expect(redirectAllowed('http://localhost:53682/callback', hosts)).toBe(true);
    expect(redirectAllowed('http://127.0.0.1:8080/cb', hosts)).toBe(true);
  });

  it('refuses anywhere else, look-alikes, and plain http off this computer', () => {
    expect(redirectAllowed('https://evil.example/callback', hosts)).toBe(false);
    expect(redirectAllowed('https://claude.ai.evil.example/cb', hosts)).toBe(false);
    expect(redirectAllowed('https://notclaude.ai/cb', hosts)).toBe(false);
    expect(redirectAllowed('http://claude.ai/cb', hosts)).toBe(false);
    expect(redirectAllowed('javascript:alert(1)', hosts)).toBe(false);
    expect(redirectAllowed('not a url', hosts)).toBe(false);
  });
});

describe('oauthSigningKey', () => {
  /** Equal keys would let a connector token pass as a maSquare web session. */
  it('never equals the web session secret, and is stable for the same secret', () => {
    expect(oauthSigningKey('s3cret')).not.toBe('s3cret');
    expect(oauthSigningKey('s3cret')).toBe(oauthSigningKey('s3cret'));
    expect(oauthSigningKey('s3cret')).not.toBe(oauthSigningKey('other'));
  });
});
