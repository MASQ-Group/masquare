import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { GMAIL_SEND_SCOPE, TOKEN_URL, base64url, buildAssertion, normalisePrivateKey, readServiceAccountKey } from './google-jwt';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const NOW = new Date('2026-09-17T12:00:00Z');

const claimsOf = (jwt: string) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));

describe('buildAssertion', () => {
  it('claims to be the service account, acting as the mailbox', () => {
    const claims = claimsOf(buildAssertion({ clientEmail: 'bot@project.iam.gserviceaccount.com', subject: 'shipments@masquare.eu', privateKeyPem: PEM, now: NOW }));
    expect(claims.iss).toBe('bot@project.iam.gserviceaccount.com');
    // The delegation: without `sub` the token belongs to a service account with no mailbox.
    expect(claims.sub).toBe('shipments@masquare.eu');
    expect(claims.aud).toBe(TOKEN_URL);
    expect(claims.scope).toBe(GMAIL_SEND_SCOPE);
  });

  it('is short-lived, from now', () => {
    const claims = claimsOf(buildAssertion({ clientEmail: 'a@b.iam.gserviceaccount.com', subject: 'c@d.eu', privateKeyPem: PEM, now: NOW }));
    expect(claims.iat).toBe(Math.floor(NOW.getTime() / 1000));
    expect(claims.exp - claims.iat).toBe(3600);
  });

  /** Google refuses an assertion good for longer than an hour, so the ceiling is enforced here. */
  it('never asks for more than an hour, however long it is told', () => {
    const claims = claimsOf(buildAssertion({ clientEmail: 'a@b.eu', subject: 'c@d.eu', privateKeyPem: PEM, now: NOW, lifetimeSeconds: 86_400 }));
    expect(claims.exp - claims.iat).toBe(3600);
  });

  it('signs with RS256, verifiably', () => {
    const jwt = buildAssertion({ clientEmail: 'a@b.eu', subject: 'c@d.eu', privateKeyPem: PEM, now: NOW });
    const [header, payload, signature] = jwt.split('.');
    expect(JSON.parse(Buffer.from(header, 'base64url').toString('utf8'))).toEqual({ alg: 'RS256', typ: 'JWT' });
    const { createVerify } = require('node:crypto');
    expect(createVerify('RSA-SHA256').update(`${header}.${payload}`).verify(publicKey, Buffer.from(signature, 'base64url'))).toBe(true);
  });

  /**
   * The failure this prevents: a key pasted from JSON carries its newlines as the characters \ and
   * n, and Node's signer rejects it with a message that says nothing about newlines.
   */
  it('accepts a key whose newlines are still escaped', () => {
    const escaped = PEM.replace(/\n/g, '\\n');
    expect(() => buildAssertion({ clientEmail: 'a@b.eu', subject: 'c@d.eu', privateKeyPem: escaped, now: NOW })).not.toThrow();
  });

  it('accepts one with Windows line endings', () => {
    expect(normalisePrivateKey(PEM.replace(/\n/g, '\r\n'))).toBe(PEM.trim());
  });
});

describe('base64url', () => {
  it('drops the padding and the characters a URL would escape', () => {
    expect(base64url('any carnal pleasure.')).not.toMatch(/[+/=]/);
  });
});

describe('reading the key file', () => {
  const file = JSON.stringify({
    type: 'service_account',
    project_id: 'masquare',
    private_key_id: 'abc123',
    private_key: PEM,
    client_email: 'bot@masquare.iam.gserviceaccount.com',
  });

  it('takes what it needs from the file Google gives you', () => {
    const read = readServiceAccountKey(file);
    expect(read).toMatchObject({ ok: true, clientEmail: 'bot@masquare.iam.gserviceaccount.com', keyId: 'abc123' });
  });

  it('says so plainly when the paste is not JSON at all', () => {
    const read = readServiceAccountKey('-----BEGIN PRIVATE KEY-----');
    expect(read).toMatchObject({ ok: false });
    expect((read as { reason: string }).reason).toContain('whole file');
  });

  /** An OAuth client id and a service account key look alike at a glance and are not interchangeable. */
  it('rejects a key of the wrong kind, naming what it is', () => {
    const read = readServiceAccountKey(JSON.stringify({ type: 'authorized_user', client_email: 'a@b', private_key: PEM }));
    expect(read).toMatchObject({ ok: false });
    expect((read as { reason: string }).reason).toContain('authorized_user');
  });

  it('rejects a file with no key in it', () => {
    expect(readServiceAccountKey(JSON.stringify({ type: 'service_account', client_email: 'a@b' })).ok).toBe(false);
  });

  it('rejects a private key that is not a PEM', () => {
    expect(readServiceAccountKey(JSON.stringify({ type: 'service_account', client_email: 'a@b', private_key: 'not a key' })).ok).toBe(false);
  });
});
