/**
 * Source of the master key(s) used to encrypt integration secrets.
 *
 * This is intentionally an interface so the storage backend can change without
 * touching any call site. Today: the key comes from an environment variable
 * (EnvKeyProvider). Later a KmsKeyProvider (AWS/GCP/Azure/Vault) can implement
 * the same contract — the master key never leaving the KMS/HSM — with no changes
 * to CryptoService or the integrations module.
 */
export interface KeyProvider {
  /** The version stamped onto newly-encrypted values (for rotation). */
  currentVersion(): number;
  /** The 32-byte (AES-256) key for a given version. */
  getKey(version: number): Buffer;
}

/** DI token for the active KeyProvider (swap the factory to move to KMS). */
export const KEY_PROVIDER = 'KEY_PROVIDER';

/**
 * Reads the master key from `SECRETS_MASTER_KEY` (base64-encoded 32 bytes).
 * Fails fast at startup if it's missing or malformed — we never fall back to a
 * weak/default key, because this protects real third-party API credentials.
 */
export class EnvKeyProvider implements KeyProvider {
  private readonly key: Buffer;
  private readonly version = 1;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    const raw = env.SECRETS_MASTER_KEY;
    if (!raw) {
      throw new Error(
        'SECRETS_MASTER_KEY is not set. Provide a base64-encoded 32-byte key ' +
          '(e.g. `node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"`).',
      );
    }
    const key = Buffer.from(raw, 'base64');
    if (key.length !== 32) {
      throw new Error(`SECRETS_MASTER_KEY must decode to exactly 32 bytes (got ${key.length}).`);
    }
    this.key = key;
  }

  currentVersion(): number {
    return this.version;
  }

  getKey(version: number): Buffer {
    if (version !== this.version) {
      throw new Error(`No master key available for version ${version}.`);
    }
    return this.key;
  }
}
