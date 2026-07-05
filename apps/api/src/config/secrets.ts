/** JWT signing secret. In production it MUST come from the environment — we never
 *  fall back to a hardcoded value there, or tokens could be forged. A weak dev
 *  fallback is allowed only outside production for local convenience. */
export function jwtSecret(): string {
  const s = process.env.JWT_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set in production.');
  }
  return 'dev-secret-change-me';
}
