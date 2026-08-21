import { createPrivateKey, createSign, sign as edSign } from 'node:crypto';

// eBay digital signatures (RFC 9421) for the Finances API.
//
// Sellers domiciled in the EU/UK must sign requests to eBay's financial APIs. Without them the
// Finances API answers "Missing x-ebay-signature-key header", which is why eBay's own conversion
// rate — the one that actually reaches the bank — cannot be read for a non-EUR order.
//
// The signature covers a "signature base": a canonical, newline-joined list of the components
// being signed, in the exact order declared in Signature-Input. It has to be byte-identical to
// what eBay reconstructs, so the shape here is deliberately rigid and covered by tests.

export type SigningCipher = 'ED25519' | 'RSA';

export interface SigningKey {
  /** eBay's id for the keypair, for support and rotation. */
  signingKeyId: string;
  /** PKCS#8 PEM body as eBay returns it (base64, no header/footer). */
  privateKey: string;
  /** The public key as a JWE — sent verbatim as the x-ebay-signature-key header. */
  jwe: string;
  cipher: SigningCipher;
}

/** eBay returns the key as bare base64; PEM needs the armour and 64-char lines. */
export function toPem(body: string, label: 'PRIVATE KEY' | 'PUBLIC KEY'): string {
  const clean = body.replace(/-----(BEGIN|END)[^-]+-----/g, '').replace(/\s+/g, '');
  const lines = clean.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}

/**
 * The signature base for a GET.
 *
 * Order matters and must match Signature-Input exactly. eBay signs the key header plus the
 * request target: the derived components carry the method, path and authority so a signature
 * cannot be replayed against a different endpoint.
 */
export function buildSignatureBase(params: {
  jwe: string;
  method: string;
  path: string;
  authority: string;
  created: number;
}): { base: string; signatureInput: string } {
  const components = ['"x-ebay-signature-key"', '"@method"', '"@path"', '"@authority"'];
  const sigParams = `(${components.join(' ')});created=${params.created}`;

  const lines = [
    `"x-ebay-signature-key": ${params.jwe}`,
    `"@method": ${params.method.toUpperCase()}`,
    `"@path": ${params.path}`,
    `"@authority": ${params.authority}`,
    `"@signature-params": ${sigParams}`,
  ];
  return { base: lines.join('\n'), signatureInput: `sig1=${sigParams}` };
}

/** Sign the base. Ed25519 signs the message directly; RSA needs an explicit digest. */
export function signBase(base: string, privateKeyPem: string, cipher: SigningCipher): string {
  const key = createPrivateKey(privateKeyPem);
  if (cipher === 'ED25519') {
    return edSign(null, Buffer.from(base, 'utf8'), key).toString('base64');
  }
  const signer = createSign('RSA-SHA256');
  signer.update(base, 'utf8');
  signer.end();
  return signer.sign(key).toString('base64');
}

/** The headers eBay requires on a signed GET. */
export function signedHeaders(key: SigningKey, url: string, nowSeconds: number): Record<string, string> {
  const u = new URL(url);
  const path = `${u.pathname}${u.search}`;
  const { base, signatureInput } = buildSignatureBase({
    jwe: key.jwe,
    method: 'GET',
    path,
    authority: u.host,
    created: nowSeconds,
  });
  const signature = signBase(base, toPem(key.privateKey, 'PRIVATE KEY'), key.cipher);
  return {
    'x-ebay-signature-key': key.jwe,
    'Signature-Input': signatureInput,
    Signature: `sig1=:${signature}:`,
  };
}
