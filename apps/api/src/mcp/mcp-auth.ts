/**
 * Who may use the maSquare connector, decided before any tool runs.
 *
 * The connector lets Claude — driven by a person on their own Claude plan — read products and
 * submit researched item specifics. It is reachable over HTTP, so the gate in front of it matters
 * more than any single tool behind it.
 *
 * It is a long secret token, sent as `Authorization: Bearer <token>`, because that is what Claude
 * Code supports without OAuth. There are at most two: the everyday token, and an optional owner token
 * that acts as a different user (see `McpCredential`). Three properties are
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

/**
 * One way in: a token and the maSquare user it acts as. There are at most two. The everyday one
 * (MCP_TOKEN) is meant to act as a restricted content user and may be shared with the team; the
 * optional owner one (MCP_ADMIN_TOKEN) acts as the owner and must stay with the owner alone.
 */
export interface McpCredential {
  kind: 'standard' | 'admin';
  token: string;
  userEmail: string;
}

export type McpConfig =
  | { enabled: true; credentials: McpCredential[]; warnings: string[] }
  | { enabled: false; reason: string };

export function readMcpConfig(env: Record<string, string | undefined>): McpConfig {
  const standard = readCredential('standard', env.MCP_TOKEN, env.MCP_USER_EMAIL, 'MCP_TOKEN', 'MCP_USER_EMAIL');
  const admin = readCredential('admin', env.MCP_ADMIN_TOKEN, env.MCP_ADMIN_USER_EMAIL, 'MCP_ADMIN_TOKEN', 'MCP_ADMIN_USER_EMAIL');

  // The standard pair decides whether the connector is on at all, exactly as before the owner token
  // existed; the owner pair is an extra door, never the only one, so a stray MCP_ADMIN_TOKEN on its
  // own cannot switch on a connector the operator believes is off.
  if (!standard.ok) return { enabled: false, reason: standard.reason ?? 'The maSquare connector is not enabled on this server.' };

  const warnings: string[] = [];
  const credentials: McpCredential[] = [standard.credential];
  if (admin.ok) {
    if (admin.credential.token === standard.credential.token) {
      // One token for both doors would make the restricted user and the owner indistinguishable.
      warnings.push('MCP_ADMIN_TOKEN is the same as MCP_TOKEN, so the owner token stays off.');
    } else {
      credentials.push(admin.credential);
    }
  } else if (admin.reason) {
    warnings.push(admin.reason);
  }
  return { enabled: true, credentials, warnings };
}

type CredentialRead =
  | { ok: true; credential: McpCredential }
  | { ok: false; reason: string | null };

function readCredential(
  kind: McpCredential['kind'],
  rawToken: string | undefined,
  rawEmail: string | undefined,
  tokenName: string,
  emailName: string,
): CredentialRead {
  const token = rawToken?.trim() ?? '';
  const userEmail = rawEmail?.trim() ?? '';

  if (!token) {
    if (kind === 'admin') return { ok: false, reason: null }; // Not configured is the normal state.
    return { ok: false, reason: 'The maSquare connector is not enabled on this server.' };
  }
  if (token.length < MIN_TOKEN_LENGTH) {
    // Said to the operator in logs; the caller only ever sees "not enabled".
    return { ok: false, reason: `${tokenName} is shorter than ${MIN_TOKEN_LENGTH} characters, so it stays off.` };
  }
  if (!userEmail) {
    return { ok: false, reason: `${emailName} is not set, so there is nobody for ${tokenName} to act as.` };
  }
  return { ok: true, credential: { kind, token, userEmail } };
}

/**
 * Which configured credential, if any, this Authorization header carries.
 *
 * Every credential is compared, whether or not an earlier one matched, so the time taken does not
 * say which door a guess was nearer to.
 */
export function matchCredential(
  header: string | string[] | undefined,
  credentials: readonly McpCredential[],
): McpCredential | null {
  let hit: McpCredential | null = null;
  for (const c of credentials) {
    if (bearerMatches(header, c.token) && !hit) hit = c;
  }
  return hit;
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
