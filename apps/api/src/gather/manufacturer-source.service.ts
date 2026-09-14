import { Injectable, Logger } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { checkUrl, isPrivateAddress } from './fetch-guard';
import { extractPageIdentity, extractSpecPairs, type SpecPair } from './spec-extract';

/**
 * Reading a manufacturer's own product page.
 *
 * The authoritative source, and the only one whose findings publish without anybody confirming
 * them — which is exactly why every judgement it makes is narrow and every refusal is loud.
 *
 * It reads a page somebody nominated. It does not search, guess a URL, or follow its nose from a
 * brand's home page to something that looks like the right product: an automatically-found page that
 * turns out to be the wrong model would write a wrong specification with maximum confidence behind
 * it. A person says which page; the machine reads it.
 *
 * The fetch itself is hostile-input handling from start to finish. The URL comes from a person, the
 * server does the fetching, and the server sits on a private network — so the address is checked
 * before the connection, the RESOLVED addresses are checked before the connection, and both are
 * checked again on every redirect. See `fetch-guard`.
 */
@Injectable()
export class ManufacturerSourceService {
  private readonly logger = new Logger(ManufacturerSourceService.name);

  /** A product page is tens of kilobytes. Anything far past that is not one, and is dropped. */
  private static readonly MAX_BYTES = 3_000_000;
  private static readonly TIMEOUT_MS = 12_000;
  /** Enough for the http→https and apex→www hops real sites use, and no further. */
  private static readonly MAX_REDIRECTS = 4;

  async read(rawUrl: string): Promise<{
    ok: boolean;
    message?: string;
    finalUrl: string | null;
    identity: { brand: string | null; mpns: string[]; title: string | null };
    pairs: SpecPair[];
  }> {
    const nobody = { brand: null, mpns: [] as string[], title: null };

    const fetched = await this.fetchHtml(rawUrl);
    if (!fetched.ok) return { ok: false, message: fetched.message, finalUrl: null, identity: nobody, pairs: [] };

    const pairs = extractSpecPairs(fetched.html);
    const identity = extractPageIdentity(fetched.html);

    if (pairs.length === 0) {
      return {
        ok: false,
        message: 'the page was read but states no specification table — nothing on it could be used without guessing at prose',
        finalUrl: fetched.finalUrl,
        identity,
        pairs: [],
      };
    }

    this.logger.log(`Manufacturer page read: ${pairs.length} pairs from ${fetched.finalUrl}`);
    return { ok: true, finalUrl: fetched.finalUrl, identity, pairs };
  }

  /**
   * Fetch one page, re-validating at every hop.
   *
   * Redirects are followed by hand rather than by `fetch`, because the check that matters has to
   * happen between hops: a public URL is allowed to redirect to `http://169.254.169.254/`, and
   * `redirect: 'follow'` would take us there without another word.
   */
  private async fetchHtml(rawUrl: string): Promise<{ ok: true; html: string; finalUrl: string } | { ok: false; message: string }> {
    let target = rawUrl;

    for (let hop = 0; hop <= ManufacturerSourceService.MAX_REDIRECTS; hop += 1) {
      const checked = checkUrl(target);
      if (!checked.ok) return { ok: false, message: checked.reason };

      const resolved = await this.resolvesPublicly(checked.url.hostname);
      if (!resolved.ok) return { ok: false, message: resolved.reason };

      let res: Response;
      try {
        res = await fetch(checked.url, {
          redirect: 'manual',
          signal: AbortSignal.timeout(ManufacturerSourceService.TIMEOUT_MS),
          headers: {
            // Stated plainly. A manufacturer blocking us should be able to see who we are.
            'user-agent': 'maSquare/1.0 (product data; contact via the shop that sells your products)',
            accept: 'text/html,application/xhtml+xml',
            'accept-language': 'en-GB,en;q=0.9',
          },
        });
      } catch (e) {
        const why = (e as Error)?.name === 'TimeoutError' ? 'it did not answer in time' : 'it could not be reached';
        return { ok: false, message: why };
      }

      if (res.status >= 300 && res.status < 400) {
        const next = res.headers.get('location');
        if (!next) return { ok: false, message: `it answered ${res.status} without saying where to go` };
        target = new URL(next, checked.url).toString();
        continue;
      }

      if (!res.ok) return { ok: false, message: `it answered ${res.status}` };

      const type = (res.headers.get('content-type') ?? '').toLowerCase();
      /**
       * HTML only, for now. A PDF datasheet is the other half of what the business called
       * authoritative, and reading one needs a parser this repo does not have — so it is refused
       * clearly rather than fetched and silently misread as text.
       */
      if (!type.includes('text/html') && !type.includes('application/xhtml')) {
        const kind = type.includes('pdf') ? 'a PDF, which cannot be read yet' : `a ${type.split(';')[0] || 'file'} rather than a web page`;
        return { ok: false, message: `that address is ${kind}` };
      }

      const declared = Number(res.headers.get('content-length') ?? '0');
      if (declared > ManufacturerSourceService.MAX_BYTES) return { ok: false, message: 'that page is too large to read' };

      const buf = await res.arrayBuffer();
      if (buf.byteLength > ManufacturerSourceService.MAX_BYTES) return { ok: false, message: 'that page is too large to read' };

      return { ok: true, html: new TextDecoder('utf-8').decode(buf), finalUrl: checked.url.toString() };
    }

    return { ok: false, message: 'it redirected too many times' };
  }

  /**
   * Does this hostname resolve only to public addresses?
   *
   * Checked because the name check cannot catch it: anybody may point a name they own at a private
   * address, and that is the whole of the attack. EVERY answer must be public — one private address
   * among several is enough to refuse, since we do not choose which one the connection uses.
   */
  private async resolvesPublicly(hostname: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    try {
      const addresses = await lookup(hostname, { all: true });
      if (addresses.length === 0) return { ok: false, reason: 'that address does not resolve' };
      if (addresses.some((a) => isPrivateAddress(a.address))) {
        return { ok: false, reason: 'that address resolves to a private network rather than the internet' };
      }
      return { ok: true };
    } catch {
      return { ok: false, reason: 'that address does not resolve' };
    }
  }
}
