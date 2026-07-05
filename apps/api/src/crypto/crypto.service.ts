import { Inject, Injectable, Optional } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { EnvKeyProvider, KEY_PROVIDER, type KeyProvider } from './key-provider';

export interface EncryptedValue {
  ciphertext: string; // base64
  iv: string; // base64 (96-bit nonce)
  authTag: string; // base64 (GCM tag)
  keyVersion: number;
}

/**
 * Authenticated symmetric encryption for integration secrets (AES-256-GCM).
 *
 * - A fresh random 96-bit IV per encryption (never reused).
 * - The GCM auth tag detects tampering; decryption throws if ciphertext or tag
 *   was altered.
 * - `keyVersion` is stored alongside every value so the master key can be
 *   rotated and old values re-encrypted without ambiguity.
 *
 * Plaintext only ever exists transiently in process memory; it is never logged
 * and never persisted.
 */
@Injectable()
export class CryptoService {
  private readonly keys: KeyProvider;

  // Nest injects the configured KeyProvider; plain `new CryptoService()` (tests)
  // falls back to the env-based one.
  constructor(@Optional() @Inject(KEY_PROVIDER) keys?: KeyProvider) {
    this.keys = keys ?? new EnvKeyProvider();
  }

  encrypt(plaintext: string): EncryptedValue {
    const version = this.keys.currentVersion();
    const key = this.keys.getKey(version);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      keyVersion: version,
    };
  }

  decrypt(value: EncryptedValue): string {
    const key = this.keys.getKey(value.keyVersion);
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(value.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(value.authTag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(value.ciphertext, 'base64')),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  }

  /** Last 4 characters of a secret, for a masked "•••• 1234 · set" display. */
  static last4(secret: string): string {
    return secret.length <= 4 ? secret : secret.slice(-4);
  }
}
