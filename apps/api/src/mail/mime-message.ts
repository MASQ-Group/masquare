import { base64url } from './google-jwt';

/**
 * An email, as the bytes Gmail is handed.
 *
 * Gmail's send endpoint takes a whole RFC 5322 message, base64url encoded — it does not take a
 * subject and a body as fields. So this file is the format: the headers, the encodings, and the
 * rules that stop a perfectly good message arriving as mojibake.
 *
 * Three of those rules exist because the alternative fails silently rather than loudly:
 *
 *  - Non-ASCII in a header must be encoded (RFC 2047). A subject with a Greek name or an em dash
 *    sent raw does not bounce; it arrives as `=?` gibberish or as question marks, and only the
 *    recipient ever sees it.
 *  - Bodies go out base64 with a declared UTF-8 charset, for the same reason and with the same
 *    failure.
 *  - Lines end CRLF, and a header value may not contain a newline at all. A newline smuggled into a
 *    subject or an address is header injection — it ends that header and starts another, which is
 *    how a message acquires a second Bcc line it was never meant to have.
 *
 * PURE.
 */

export interface MailMessage {
  fromAddress: string;
  fromName?: string | null;
  to: string;
  subject: string;
  text: string;
  /** Sent alongside the text as a multipart/alternative, when given. */
  html?: string | null;
  replyTo?: string | null;
}

const CRLF = '\r\n';
const ASCII_ONLY = /^[\x20-\x7E]*$/;

/** A header value with the newlines taken out, because a newline in a header is a second header. */
export function sanitiseHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

/**
 * A header value safe to send, encoded only when it has to be.
 *
 * Plain ASCII is left exactly as typed — an encoded-word around "Your shipment" would be correct and
 * unreadable in every mail client that shows raw headers.
 */
export function encodeHeaderValue(value: string): string {
  const clean = sanitiseHeaderValue(value);
  if (ASCII_ONLY.test(clean)) return clean;
  return `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`;
}

/** `Name <address>`, with the name encoded and the address left alone. An empty name gives bare address. */
export function formatAddress(address: string, name?: string | null): string {
  const clean = sanitiseHeaderValue(address);
  const display = name ? sanitiseHeaderValue(name) : '';
  if (!display) return clean;
  return `${encodeHeaderValue(display)} <${clean}>`;
}

/** Base64 for a body: the same alphabet as anywhere else, wrapped at 76 characters as RFC 2045 asks. */
function base64Body(text: string): string {
  const encoded = Buffer.from(text, 'utf8').toString('base64');
  return (encoded.match(/.{1,76}/g) ?? []).join(CRLF);
}

/** The whole message, as a string. */
export function buildMimeMessage(m: MailMessage, opts: { boundary?: string } = {}): string {
  const headers: string[] = [
    `From: ${formatAddress(m.fromAddress, m.fromName)}`,
    `To: ${sanitiseHeaderValue(m.to)}`,
    `Subject: ${encodeHeaderValue(m.subject)}`,
    'MIME-Version: 1.0',
  ];
  if (m.replyTo) headers.splice(3, 0, `Reply-To: ${sanitiseHeaderValue(m.replyTo)}`);

  if (!m.html) {
    return [
      ...headers,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      base64Body(m.text),
    ].join(CRLF);
  }

  // Fixed boundary in tests, random in life: a boundary that appears in the body would end the part
  // early, and randomness is what makes that impossible rather than unlikely.
  const boundary = opts.boundary ?? `masquare-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return [
    ...headers,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    base64Body(m.text),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    base64Body(m.html),
    `--${boundary}--`,
    '',
  ].join(CRLF);
}

/** The message as Gmail's `raw` field wants it. */
export function encodeForGmail(m: MailMessage, opts: { boundary?: string } = {}): string {
  return base64url(buildMimeMessage(m, opts));
}

/**
 * Whether this is an address we are willing to send to.
 *
 * Deliberately permissive about what an address may contain and strict about what it may not: a
 * space, a comma or a newline turns one recipient into two, and the second is nobody's intention.
 */
export function isSendableAddress(value: string | null | undefined): boolean {
  const v = (value ?? '').trim();
  if (!v || /[\s,;<>]/.test(v)) return false;
  const at = v.indexOf('@');
  return at > 0 && at === v.lastIndexOf('@') && at < v.length - 1 && v.slice(at + 1).includes('.');
}
