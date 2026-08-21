import { describe, it, expect } from 'vitest';
import { generateKeyPairSync, verify as edVerify } from 'node:crypto';
import { buildSignatureBase, signBase, signedHeaders, toPem } from './ebay-signature';

// The signature base must be byte-identical to what eBay reconstructs, so these pin its exact
// shape rather than just checking a signature verifies.

describe('signature base', () => {
  const parts = { jwe: 'eyJraWQiOiJ0ZXN0In0', method: 'get', path: '/sell/finances/v1/transaction?filter=x', authority: 'api.ebay.com', created: 1_700_000_000 };

  it('lists components in the declared order, newline joined', () => {
    const { base, signatureInput } = buildSignatureBase(parts);
    expect(base).toBe(
      [
        '"x-ebay-signature-key": eyJraWQiOiJ0ZXN0In0',
        '"@method": GET',
        '"@path": /sell/finances/v1/transaction?filter=x',
        '"@authority": api.ebay.com',
        '"@signature-params": ("x-ebay-signature-key" "@method" "@path" "@authority");created=1700000000',
      ].join('\n'),
    );
    expect(signatureInput).toBe('sig1=("x-ebay-signature-key" "@method" "@path" "@authority");created=1700000000');
  });

  it('signs the target, so a signature cannot be replayed against another path', () => {
    const a = buildSignatureBase(parts).base;
    const b = buildSignatureBase({ ...parts, path: '/sell/finances/v1/payout' }).base;
    expect(a).not.toBe(b);
  });

  it('uppercases the method and keeps the query string', () => {
    const { base } = buildSignatureBase(parts);
    expect(base).toContain('"@method": GET');
    expect(base).toContain('?filter=x');
  });
});

describe('PEM handling', () => {
  it('armours bare base64 into 64-character lines', () => {
    const pem = toPem('AAAA'.repeat(30), 'PRIVATE KEY');
    expect(pem.startsWith('-----BEGIN PRIVATE KEY-----\n')).toBe(true);
    expect(pem.trimEnd().endsWith('-----END PRIVATE KEY-----')).toBe(true);
    const body = pem.split('\n').slice(1, -2);
    expect(body.every((l) => l.length <= 64)).toBe(true);
  });

  it('accepts a key that already carries its armour', () => {
    const pem = toPem('AAAA'.repeat(30), 'PRIVATE KEY');
    expect(toPem(pem, 'PRIVATE KEY')).toBe(pem);
  });
});

describe('signing', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

  it('produces a signature the public key verifies', () => {
    const base = 'hello signature base';
    const sig = signBase(base, privPem, 'ED25519');
    expect(edVerify(null, Buffer.from(base, 'utf8'), publicKey, Buffer.from(sig, 'base64'))).toBe(true);
  });

  it('emits the three headers eBay requires, with the signature wrapped in colons', () => {
    const h = signedHeaders(
      { signingKeyId: 'k1', privateKey: privPem, jwe: 'JWEVALUE', cipher: 'ED25519' },
      'https://api.ebay.com/sell/finances/v1/transaction?filter=orderId%3A%7B1-2%7D',
      1_700_000_000,
    );
    expect(h['x-ebay-signature-key']).toBe('JWEVALUE');
    expect(h['Signature-Input']).toContain('created=1700000000');
    expect(h.Signature).toMatch(/^sig1=:[A-Za-z0-9+/=]+:$/);
  });

  it('signs the encoded path exactly as sent', () => {
    const url = 'https://api.ebay.com/sell/finances/v1/transaction?filter=orderId%3A%7B1-2%7D';
    const { base } = buildSignatureBase({ jwe: 'J', method: 'GET', path: new URL(url).pathname + new URL(url).search, authority: 'api.ebay.com', created: 1 });
    expect(base).toContain('%3A%7B1-2%7D'); // not decoded on the way into the signature
  });
});
