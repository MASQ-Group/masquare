import { describe, expect, it } from 'vitest';
import { buildMimeMessage, encodeForGmail, encodeHeaderValue, formatAddress, isSendableAddress, sanitiseHeaderValue } from './mime-message';

const base = { fromAddress: 'shipments@masquare.eu', to: 'someone@example.com', subject: 'Hello', text: 'Body' };
const headersOf = (raw: string) => raw.split('\r\n\r\n')[0].split('\r\n');
const decode = (raw: string, part = 0) => {
  const blocks = raw.split('\r\n\r\n');
  return Buffer.from(blocks[part + 1].split('\r\n--')[0].replace(/\r\n/g, ''), 'base64').toString('utf8');
};

describe('the envelope', () => {
  it('addresses the message and says who it is from', () => {
    const headers = headersOf(buildMimeMessage({ ...base, fromName: 'maSquare' }));
    expect(headers).toContain('From: maSquare <shipments@masquare.eu>');
    expect(headers).toContain('To: someone@example.com');
    expect(headers).toContain('Subject: Hello');
  });

  it('sends a bare address when there is no display name', () => {
    expect(formatAddress('a@b.com')).toBe('a@b.com');
  });

  it('adds a reply-to only when one is given', () => {
    expect(headersOf(buildMimeMessage(base)).some((h) => h.startsWith('Reply-To:'))).toBe(false);
    expect(headersOf(buildMimeMessage({ ...base, replyTo: 'ops@masquare.eu' }))).toContain('Reply-To: ops@masquare.eu');
  });

  it('uses CRLF line endings, as the format requires', () => {
    expect(buildMimeMessage(base)).toContain('\r\n');
    expect(buildMimeMessage(base).replace(/\r\n/g, '')).not.toContain('\n');
  });
});

describe('characters that are not ASCII', () => {
  /** Sent raw, a subject like this arrives as question marks — and only the recipient sees it. */
  it('encodes a subject that needs it, and leaves a plain one alone', () => {
    expect(encodeHeaderValue('Shipment CY-0001')).toBe('Shipment CY-0001');
    expect(encodeHeaderValue('Αποστολή')).toBe('=?UTF-8?B?zpHPgM6/z4PPhM6/zrvOrg==?=');
  });

  it('encodes a display name without touching the address', () => {
    expect(formatAddress('a@b.com', 'Γιώργος')).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <a@b\.com>$/);
  });

  it('carries a body through intact', () => {
    const raw = buildMimeMessage({ ...base, text: 'Παραλαβή — 2 δέματα' });
    expect(decode(raw)).toBe('Παραλαβή — 2 δέματα');
  });
});

describe('header injection', () => {
  /**
   * A newline inside a header value ends that header and starts another. This is how a message
   * acquires a Bcc line nobody wrote, so the newline never survives.
   */
  it('strips newlines out of a subject', () => {
    const raw = buildMimeMessage({ ...base, subject: 'Hello\r\nBcc: someone-else@example.com' });
    expect(headersOf(raw).some((h) => h.toLowerCase().startsWith('bcc'))).toBe(false);
    expect(raw).toContain('Subject: Hello Bcc: someone-else@example.com');
  });

  it('strips them out of a display name too', () => {
    expect(formatAddress('a@b.com', 'A\nB')).toBe('A B <a@b.com>');
  });

  it('collapses a newline rather than dropping the text around it', () => {
    expect(sanitiseHeaderValue('one\n\ntwo')).toBe('one two');
  });
});

describe('a message with HTML', () => {
  it('sends both versions, so a plain-text client still has something to read', () => {
    const raw = buildMimeMessage({ ...base, html: '<p>Body</p>' }, { boundary: 'B' });
    expect(headersOf(raw)).toContain('Content-Type: multipart/alternative; boundary="B"');
    expect(raw).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(raw).toContain('Content-Type: text/html; charset="UTF-8"');
    expect(raw.trimEnd().endsWith('--B--')).toBe(true);
  });

  it('sends a single part when there is no HTML', () => {
    expect(buildMimeMessage(base)).not.toContain('multipart/alternative');
  });
});

describe('what Gmail is handed', () => {
  it('is base64url — no padding, and nothing that needs escaping in a URL', () => {
    const encoded = encodeForGmail(base);
    expect(encoded).not.toMatch(/[+/=]/);
    expect(Buffer.from(encoded, 'base64url').toString('utf8')).toContain('Subject: Hello');
  });
});

describe('addresses we will send to', () => {
  it('accepts an ordinary one', () => {
    expect(isSendableAddress('a.b+c@example.co.uk')).toBe(true);
  });

  it.each(['', '   ', 'no-at-sign', 'two@at@signs.com', 'a@b', 'a b@c.com', 'a@c.com, b@c.com', 'a@c.com\nBcc: x@y.com'])(
    'refuses %j',
    (value) => {
      expect(isSendableAddress(value)).toBe(false);
    },
  );

  it('refuses nothing at all', () => {
    expect(isSendableAddress(null)).toBe(false);
  });
});
