/**
 * Whether the connector's sign-in (OAuth) is on, and who may use it.
 *
 * claude.ai adds connectors that sign in with OAuth; it has nowhere to paste a fixed token. This is
 * that sign-in, and it exists so a team sharing one Claude account can create product content
 * without sharing anyone's password or the owner's reach. Three rules follow from that and live here
 * where they can be tested:
 *
 *   - OFF unless configured. It needs the public address people reach maSquare at, and a list of
 *     the accounts allowed to sign in. Without either, no sign-in endpoint exists.
 *   - Only listed accounts. Being a maSquare user is not enough; the account must be named in
 *     MCP_OAUTH_ALLOWED_EMAILS, so adding a colleague to maSquare does not quietly add them here.
 *   - Never an admin. A connector added to a shared Claude account is usable by everyone on it, so
 *     an admin signing in would hand admin reach to all of them. The owner keeps their own fixed
 *     owner token (MCP_ADMIN_TOKEN) for that. The admin check itself happens at sign-in and on
 *     every request, where the user record is at hand; this file only holds the settings.
 *
 * PURE apart from reading `process.env` through the argument it is given.
 */
import { createHmac } from 'crypto';

/** A sign-in lasts this long before Claude must use its refresh token. */
export const ACCESS_TOKEN_SECONDS = 60 * 60;
/** How long a refresh token lives unused. Each use replaces it with a new one. */
export const REFRESH_TOKEN_SECONDS = 30 * 24 * 60 * 60;
/** A one-time code must be exchanged within this. */
export const CODE_SECONDS = 5 * 60;
/** How long the sign-in page stays valid once shown. */
export const LOGIN_PAGE_SECONDS = 10 * 60;

/**
 * Where an app may ask to be sent back to after sign-in. Claude on the web and its apps, plus the
 * loopback address local apps such as Claude Code listen on. Anything else is refused at
 * registration, so a look-alike app cannot collect codes.
 */
export const DEFAULT_REDIRECT_HOSTS = ['claude.ai', 'claude.com', 'localhost', '127.0.0.1'];

export type OAuthConfig =
  | {
      enabled: true;
      /** The public origin, e.g. https://app.masquare.eu — also the OAuth issuer. */
      issuer: URL;
      /** The connector's own address, the resource every token is issued for. */
      resource: URL;
      allowedEmails: ReadonlySet<string>;
      redirectHosts: readonly string[];
    }
  | { enabled: false; reason: string | null };

export function readOAuthConfig(env: Record<string, string | undefined>): OAuthConfig {
  const rawUrl = env.MCP_PUBLIC_URL?.trim() ?? '';
  const emails = splitList(env.MCP_OAUTH_ALLOWED_EMAILS).map((e) => e.toLowerCase());

  // Not configured is the normal state, not a problem worth a log line.
  if (!rawUrl && emails.length === 0) return { enabled: false, reason: null };
  if (!rawUrl) return { enabled: false, reason: 'MCP_PUBLIC_URL is not set, so connector sign-in stays off.' };
  if (emails.length === 0) {
    return { enabled: false, reason: 'MCP_OAUTH_ALLOWED_EMAILS is empty, so nobody could sign in; connector sign-in stays off.' };
  }

  let issuer: URL;
  try {
    issuer = new URL(rawUrl);
  } catch {
    return { enabled: false, reason: 'MCP_PUBLIC_URL is not a valid address, so connector sign-in stays off.' };
  }
  const local = issuer.hostname === 'localhost' || issuer.hostname === '127.0.0.1';
  if (issuer.protocol !== 'https:' && !local) {
    // Passwords and tokens would cross the network in the clear; OAuth also forbids it.
    return { enabled: false, reason: 'MCP_PUBLIC_URL must start with https://, so connector sign-in stays off.' };
  }
  // The issuer is the origin alone: a path, query or fragment would break the well-known addresses.
  issuer = new URL(issuer.origin);

  const hosts = splitList(env.MCP_OAUTH_REDIRECT_HOSTS).map((h) => h.toLowerCase());
  return {
    enabled: true,
    issuer,
    resource: new URL('/api/mcp', issuer),
    allowedEmails: new Set(emails),
    redirectHosts: hosts.length > 0 ? hosts : DEFAULT_REDIRECT_HOSTS,
  };
}

/**
 * May an app be sent back to this address? https on an allowed host, or plain http only on the
 * loopback address, where the traffic never leaves the person's own computer.
 */
export function redirectAllowed(uri: string, hosts: readonly string[]): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  const loopback = host === 'localhost' || host === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) return false;
  return hosts.some((h) => host === h || host.endsWith(`.${h}`));
}

/**
 * The key connector tokens are signed with. Derived from JWT_SECRET but never equal to it, so a
 * connector token can never pass as a maSquare web session, and a web session never as this.
 */
export function oauthSigningKey(jwtSecret: string): string {
  return createHmac('sha256', jwtSecret).update('masquare-mcp-oauth-v1').digest('base64url');
}

function splitList(raw: string | undefined): string[] {
  return (raw ?? '').split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
}
