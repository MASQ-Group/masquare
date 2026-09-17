import { createSign } from 'node:crypto';

/**
 * The signed assertion that buys a Google access token.
 *
 * A service account does not log in. It signs a short-lived JWT with its own private key and
 * exchanges that for a token — so there is no password anywhere, nothing to rotate on a schedule,
 * and no consent screen for a person to sit in front of at three in the morning.
 *
 * `sub` is the part that makes this work for us: with domain-wide delegation, the token acts AS that
 * mailbox. Send it our own shipping address and Gmail sends from that address, filing the message in
 * its sent folder like any other. Without `sub` the token belongs to the service account, which has
 * no mailbox of its own and cannot send anything.
 *
 * Hand-built rather than pulling in googleapis: it is a header, a payload and an RS256 signature,
 * and the whole of it fits on one screen where it can be read and tested.
 *
 * PURE apart from the signature, which is deterministic for a given key and clock.
 */

export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
export const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const JWT_BEARER_GRANT = 'urn:ietf:params:oauth:grant-type:jwt-bearer';

/** Base64 as a URL wants it: no padding, and none of the characters that need escaping. */
export function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface AssertionInput {
  clientEmail: string;
  /** The mailbox to act as. This is the delegation. */
  subject: string;
  privateKeyPem: string;
  scope?: string;
  now?: Date;
  /** How long the assertion is good for. Google refuses anything over an hour. */
  lifetimeSeconds?: number;
  audience?: string;
}

export function buildAssertion(input: AssertionInput): string {
  const issuedAt = Math.floor((input.now?.getTime() ?? Date.now()) / 1000);
  const lifetime = Math.min(input.lifetimeSeconds ?? 3600, 3600);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: input.clientEmail,
    sub: input.subject,
    scope: input.scope ?? GMAIL_SEND_SCOPE,
    aud: input.audience ?? TOKEN_URL,
    iat: issuedAt,
    exp: issuedAt + lifetime,
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signature = createSign('RSA-SHA256').update(signingInput).sign(normalisePrivateKey(input.privateKeyPem));
  return `${signingInput}.${base64url(signature)}`;
}

/**
 * The key as it arrives, made usable.
 *
 * A key pasted out of a JSON file carries its newlines as the two characters `\` and `n`, because
 * that is how JSON writes them. Node's signer rejects it with "error:1E08010C:DECODER routines" —
 * a message that says nothing about newlines and sends people looking for a corrupt key.
 */
export function normalisePrivateKey(pem: string): string {
  const key = pem.includes('\\n') ? pem.replace(/\\n/g, '\n') : pem;
  return key.trim().replace(/\r\n/g, '\n');
}

/** What a service-account JSON key file holds that we need, or a reason it cannot be used. */
export function readServiceAccountKey(json: string): { ok: true; clientEmail: string; privateKey: string; keyId: string | null } | { ok: false; reason: string } {
  let parsed: any;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, reason: 'That is not the JSON key file — paste the whole file, starting with {' };
  }
  if (parsed?.type && parsed.type !== 'service_account') {
    return { ok: false, reason: `That key is for a "${parsed.type}", not a service account. Create a service account key in the Google Cloud console.` };
  }
  const clientEmail = typeof parsed?.client_email === 'string' ? parsed.client_email.trim() : '';
  const privateKey = typeof parsed?.private_key === 'string' ? parsed.private_key : '';
  if (!clientEmail || !privateKey) {
    return { ok: false, reason: 'The key file is missing client_email or private_key. Download it again from the Google Cloud console.' };
  }
  if (!normalisePrivateKey(privateKey).startsWith('-----BEGIN')) {
    return { ok: false, reason: 'The private key in that file does not look like a PEM key.' };
  }
  return { ok: true, clientEmail, privateKey, keyId: typeof parsed.private_key_id === 'string' ? parsed.private_key_id : null };
}
