/**
 * Who may use the maSquare connector, decided before any tool runs.
 *
 * The connector lets Claude — driven by a person on their own Claude plan — read products and
 * submit researched item specifics. It is reachable over HTTP, so the gate in front of it matters
 * more than any single tool behind it.
 *
 * It is a single long secret token, sent as `Authorization: Bearer <token>`, because that is what
 * Claude Code supports without OAuth and this connector has exactly one user. Three properties are
 * non-negotiable and live here where they can be tested:
 *
 *   - OFF unless configured properly. No token, or a short one, means the endpoint refuses every
 *     request. A connector that quietly accepted an empty token would be open to anyone.
 *   - Compared in constant time. A byte-by-byte early-exit comparison leaks how much of a guess was
 *     right through response timing; hashing both sides first also equalises their lengths, which
 *     `timingSafeEqual` requires.
 *   - Never echoed. Nothing here returns, logs or embeds the token in an error.
 *
 * PURE apart from reading `process.env` through the argument it is given.
 */
import { createHash, timingSafeEqual } from 'crypto';

/** 32 characters of real randomness is ~190 bits; below this a token is a password, not a key. */
export const MIN_TOKEN_LENGTH = 32;

export type McpConfig =
  | { enabled: true; token: string; userEmail: string }
  | { enabled: false; reason: string };

export function readMcpConfig(env: Record<string, string | undefined>): McpConfig {
  const token = env.MCP_TOKEN?.trim() ?? '';
  const userEmail = env.MCP_USER_EMAIL?.trim() ?? '';

  if (!token) return { enabled: false, reason: 'The maSquare connector is not enabled on this server.' };
  if (token.length < MIN_TOKEN_LENGTH) {
    // Said to the operator in logs; the caller only ever sees "not enabled".
    return { enabled: false, reason: `MCP_TOKEN is shorter than ${MIN_TOKEN_LENGTH} characters, so the connector stays off.` };
  }
  if (!userEmail) {
    return { enabled: false, reason: 'MCP_USER_EMAIL is not set, so there is nobody for the connector to act as.' };
  }
  return { enabled: true, token, userEmail };
}

/**
 * Does this Authorization header carry the configured token?
 *
 * Only the `Bearer` scheme, case-insensitively as RFC 6750 allows. Anything malformed is simply a
 * mismatch — the caller gets the same 401 whether the header was missing, mangled or wrong, so a
 * probe learns nothing about which.
 */
export function bearerMatches(header: string | string[] | undefined, expected: string): boolean {
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw || !expected) return false;

  const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
  if (!match) return false;

  const given = createHash('sha256').update(match[1].trim()).digest();
  const wanted = createHash('sha256').update(expected).digest();
  return timingSafeEqual(given, wanted);
}
