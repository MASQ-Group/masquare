import { describe, expect, it } from 'vitest';
import { checkUrl, isPrivateAddress } from './fetch-guard';

const refused = (raw: string) => {
  const v = checkUrl(raw);
  expect(v.ok).toBe(false);
  return !v.ok ? v.reason : '';
};

describe('checkUrl', () => {
  it('allows an ordinary manufacturer product page', () => {
    const v = checkUrl('https://www.beurer.com/web/gb/products/air/air-purifier/lr-200');
    expect(v.ok).toBe(true);
    expect(v.ok && v.url.hostname).toBe('www.beurer.com');
  });

  it('allows plain http, since not every manufacturer has moved on', () => {
    expect(checkUrl('http://example.com/spec').ok).toBe(true);
  });

  it('refuses anything that is not a web address', () => {
    expect(refused('file:///etc/passwd')).toContain('only http and https');
    expect(refused('ftp://example.com/x')).toContain('only http and https');
    expect(refused('javascript:alert(1)')).toContain('only http and https');
    expect(refused('not a url')).toContain('not a web address');
  });

  it('refuses credentials embedded in the address', () => {
    expect(refused('https://user:pass@example.com/x')).toContain('username or password');
  });

  describe('the network this server sits on', () => {
    it('refuses this machine, by name or by address', () => {
      expect(refused('http://localhost:3200/api/auth/me')).toContain('this network');
      expect(refused('http://127.0.0.1/')).toContain('private network');
      expect(refused('http://[::1]/')).toContain('private network');
      expect(refused('http://0.0.0.0/')).toContain('private network');
    });

    /** The one that matters most on a hosted platform. */
    it('refuses the cloud metadata endpoint', () => {
      expect(refused('http://169.254.169.254/latest/meta-data/')).toContain('private network');
    });

    it('refuses private ranges', () => {
      expect(refused('http://10.0.0.5/')).toContain('private network');
      expect(refused('http://192.168.1.1/')).toContain('private network');
      expect(refused('http://172.16.0.1/')).toContain('private network');
    });

    it('refuses names that mean the local network', () => {
      expect(refused('http://printer.local/')).toContain('this network');
      expect(refused('http://api.internal/status')).toContain('this network');
      expect(refused('http://intranet/')).toContain('this network');
    });
  });

  /** 172.32 is public even though 172.16–31 is not; an over-broad rule would block real sites. */
  it('does not refuse a public address that merely looks nearby', () => {
    expect(checkUrl('http://172.32.0.1/').ok).toBe(true);
    expect(checkUrl('http://11.0.0.1/').ok).toBe(true);
  });
});

describe('isPrivateAddress', () => {
  it('classifies what DNS actually returned', () => {
    expect(isPrivateAddress('93.184.216.34')).toBe(false);
    expect(isPrivateAddress('2606:2800:220:1:248:1893:25c8:1946')).toBe(false);
    expect(isPrivateAddress('10.1.2.3')).toBe(true);
    expect(isPrivateAddress('fe80::1')).toBe(true);
    expect(isPrivateAddress('fd00::1')).toBe(true);
  });

  /** The costume trick: an IPv4 loopback written as IPv6. */
  it('sees through an IPv4 address mapped into IPv6', () => {
    expect(isPrivateAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateAddress('::ffff:93.184.216.34')).toBe(false);
  });

  /**
   * Failing closed. Refusing a good page costs a message; allowing a bad one costs the inside of
   * the network, so anything unclassifiable is treated as private.
   */
  it('treats anything it cannot classify as private', () => {
    expect(isPrivateAddress('')).toBe(true);
    expect(isPrivateAddress('not-an-address')).toBe(true);
    expect(isPrivateAddress('999.999.999.999')).toBe(true);
    expect(isPrivateAddress('10.1')).toBe(true);
  });
});
