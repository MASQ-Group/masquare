/**
 * Deciding whether a URL is safe for the server to fetch.
 *
 * The manufacturer source takes a URL from a person and the API server goes and reads it. That is a
 * server-side request forgery surface in its plainest form: whatever is pasted, our server fetches,
 * from inside our network, with our network's reach. `http://169.254.169.254/` is a cloud metadata
 * endpoint; `http://localhost:3200/api/...` is this API; `http://10.0.0.5/` is whatever else is on
 * the private network. None of those are manufacturer product pages.
 *
 * So the rule is an allowlist of shapes, not a blocklist of known-bad strings: http or https, a
 * public host, no credentials, no port games. Everything else is refused with a reason.
 *
 * Checking the hostname is not enough on its own — a public name can resolve to a private address —
 * so `isPrivateAddress` is exported for the caller to apply to the RESOLVED addresses before any
 * connection is made, and again on every redirect hop.
 *
 * PURE.
 */

export type UrlVerdict = { ok: true; url: URL } | { ok: false; reason: string };

/** Names that mean "this machine" or "this network" without ever looking like an address. */
const LOCAL_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa'];

export function checkUrl(raw: string): UrlVerdict {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: 'that is not a web address' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: `only http and https can be read, not ${url.protocol.replace(':', '')}` };
  }
  /** Credentials in a URL are never how a manufacturer publishes a product page. */
  if (url.username || url.password) {
    return { ok: false, reason: 'a web address with a username or password in it will not be fetched' };
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return { ok: false, reason: 'that address has no host' };
  if (host === 'localhost' || LOCAL_SUFFIXES.some((s) => host.endsWith(s))) {
    return { ok: false, reason: 'that address points at this network rather than the internet' };
  }
  /** An address typed as digits skips DNS entirely, so it is judged here and now. */
  if (isIpLiteral(host) && isPrivateAddress(host)) {
    return { ok: false, reason: 'that address points at a private network rather than the internet' };
  }
  /** A public name with no dot in it is a short local name — an intranet host, not a manufacturer. */
  if (!isIpLiteral(host) && !host.includes('.')) {
    return { ok: false, reason: 'that address points at this network rather than the internet' };
  }

  return { ok: true, url };
}

export function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
}

/**
 * Is this resolved address somewhere on a private, local or otherwise non-internet network?
 *
 * Applied to what DNS actually returned, not to what was typed — a hostname the owner controls can
 * be pointed at 127.0.0.1, and that is the whole trick.
 *
 * Unrecognisable input is treated as private. Failing closed on an address we cannot classify is
 * the only safe direction: the cost of refusing a good page is a message, and the cost of allowing
 * a bad one is the inside of the network.
 */
export function isPrivateAddress(address: string): boolean {
  const addr = address.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  if (!addr) return true;

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(addr)) return isPrivateV4(addr);
  if (!addr.includes(':')) return true;

  // An IPv4 address wearing an IPv6 costume is still that IPv4 address.
  const mapped = addr.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return isPrivateV4(mapped[1]);

  if (addr === '::' || addr === '::1') return true;
  const head = parseInt(addr.split(':')[0] || '0', 16);
  if (Number.isNaN(head)) return true;
  if ((head & 0xfe00) === 0xfc00) return true; // fc00::/7  unique local
  if ((head & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
  if ((head & 0xff00) === 0xff00) return true; // ff00::/8  multicast
  return false;
}

function isPrivateV4(addr: string): boolean {
  const parts = addr.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;

  if (a === 0) return true;                        // 0.0.0.0/8      this network
  if (a === 10) return true;                       // 10.0.0.0/8     private
  if (a === 127) return true;                      // 127.0.0.0/8    loopback
  if (a === 169 && b === 254) return true;         // 169.254.0.0/16 link local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true;         // 192.168.0.0/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 carrier NAT
  if (a === 192 && b === 0) return true;           // 192.0.0.0/24   protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
  if (a >= 224) return true;                       // multicast and reserved
  return false;
}
