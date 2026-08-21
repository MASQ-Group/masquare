import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { generateSignature, generateSignatureInput } from 'digital-signature-nodejs-sdk';
import { signedRequest } from './ebay-signature';

// Compare our signing against eBay's own SDK, byte for byte.
//
// Ed25519 is deterministic: the same key over the same message always yields the same signature.
// So if our signature equals the SDK's for the same request and instant, our signature base is
// identical to theirs — and any remaining rejection is not our construction.
//
// This exists because four rounds of correcting the base by reasoning about the spec all failed.
// A local comparison against their implementation settles it without another round trip.

const { privateKey } = generateKeyPairSync('ed25519');
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const JWE = 'eyJ6aXAiOiJERUYiLCJraWQiOiJ0ZXN0In0.AAAA.BBBB.CCCC.DDDD';
const URL_UNDER_TEST = 'https://apiz.ebay.com/sell/finances/v1/transaction?filter=orderId%3A%7B26-15031-86756%7D';
const FROZEN_MS = 1_787_325_185_000;

/** The SDK's headers for the same GET, built exactly as their example does. */
function sdkHeaders(url: string): { signatureInput: string; signature: string } {
  const u = new global.URL(url);
  const config = {
    privateKey: PEM,
    jwe: JWE,
    digestAlgorithm: 'sha256',
    signatureParams: ['content-digest', 'x-ebay-signature-key', '@method', '@path', '@authority'],
    signatureComponents: {
      method: 'GET',
      authority: u.host,
      path: u.pathname + u.search,
      targetUri: u.toString(),
      scheme: 'https',
      requestTarget: '',
    },
  } as any;

  const headers: Record<string, string> = {};
  const signatureInput = generateSignatureInput(headers, config);
  headers['signature-input'] = signatureInput;
  headers['x-ebay-signature-key'] = JWE;
  const signature = generateSignature(headers, config);
  return { signatureInput, signature };
}

describe('our signing vs eBaydotcom SDK', () => {
  beforeAll(() => {
    // Their SDK reads the clock inside both calls; freezing it removes that as a variable.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FROZEN_MS));
  });
  afterAll(() => vi.useRealTimers());

  it('produces the identical Signature-Input header', () => {
    const ours = signedRequest({ signingKeyId: 'k', privateKey: PEM, jwe: JWE, cipher: 'ED25519' }, URL_UNDER_TEST, Math.floor(FROZEN_MS / 1000));
    expect(ours.headers['Signature-Input']).toBe(sdkHeaders(URL_UNDER_TEST).signatureInput);
  });

  it('produces the identical Signature, so the signed base matches byte for byte', () => {
    const ours = signedRequest({ signingKeyId: 'k', privateKey: PEM, jwe: JWE, cipher: 'ED25519' }, URL_UNDER_TEST, Math.floor(FROZEN_MS / 1000));
    expect(ours.headers.Signature).toBe(sdkHeaders(URL_UNDER_TEST).signature);
  });

  it('still matches on a different path and query', () => {
    const other = 'https://apiz.ebay.com/sell/finances/v1/payout?filter=payoutDate%3A%5B2026-08-01..%5D';
    const ours = signedRequest({ signingKeyId: 'k', privateKey: PEM, jwe: JWE, cipher: 'ED25519' }, other, Math.floor(FROZEN_MS / 1000));
    expect(ours.headers.Signature).toBe(sdkHeaders(other).signature);
  });
});
