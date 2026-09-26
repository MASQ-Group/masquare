import { describe, expect, it } from 'vitest';
import { loginPageHeaders, renderLoginPage } from './login-page';

describe('renderLoginPage', () => {
  /** The app names itself at registration, so its name is outside input on a password page. */
  it('escapes everything it places on the page', () => {
    const html = renderLoginPage({
      clientName: '<script>alert(1)</script>',
      pending: '"><img src=x>',
      action: '/api/mcp/oauth/login',
      cancelUrl: 'https://claude.ai/cb?error=access_denied&state=a"b',
      email: 'x"@y.eu',
      error: '<b>no</b>',
    });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>no</b>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('state=a&quot;b');
  });

  it('never carries a script of its own', () => {
    const html = renderLoginPage({ clientName: 'Claude', pending: 'p', action: '/a', cancelUrl: 'https://claude.ai/cb' });
    expect(html).not.toMatch(/<script/i);
  });
});

describe('loginPageHeaders', () => {
  it('cannot be framed or cached, and posts only here and on to the app', () => {
    const h = loginPageHeaders('https://claude.ai/api/mcp/auth_callback');
    expect(h['X-Frame-Options']).toBe('DENY');
    expect(h['Cache-Control']).toBe('no-store');
    expect(h['Content-Security-Policy']).toContain("form-action 'self' https://claude.ai;");
    expect(h['Content-Security-Policy']).toContain("frame-ancestors 'none'");
  });
});
