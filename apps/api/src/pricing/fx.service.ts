import { Injectable, Logger } from '@nestjs/common';

/**
 * Foreign currency -> EUR rates for the pricing module.
 *
 * Deliberately a self-contained copy of the rate lookup the sales-transaction module
 * performs internally (same Frankfurter/ECB source, same USD pegs, same 6dp rounding)
 * rather than a refactor of that module — pricing must not change how existing
 * transactions are valued. If the two are ever consolidated, this is the piece to lift.
 *
 * Pricing is forward-looking, so it always uses today's rate and caches it in memory for
 * the day; nothing here is snapshotted onto a record.
 */
@Injectable()
export class PricingFxService {
  private readonly logger = new Logger(PricingFxService.name);
  /** Currencies pegged to USD that the ECB does not publish. */
  private static readonly USD_PEG: Record<string, number> = { AED: 3.6725, SAR: 3.75 };

  private cache = new Map<string, { rate: number | null; day: string }>();

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private async frankfurter(currency: string): Promise<number | null> {
    try {
      const res = await fetch(`https://api.frankfurter.dev/v1/latest?from=${currency}&to=EUR`, {
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) return null;
      const json: any = await res.json();
      const rate = json?.rates?.EUR;
      return typeof rate === 'number' ? rate : null;
    } catch {
      return null;
    }
  }

  /** Multiplier taking one unit of `currency` to EUR. Null when the rate is unavailable. */
  async toEur(currency: string | null | undefined): Promise<number | null> {
    if (!currency) return null;
    const cur = currency.toUpperCase();
    if (cur === 'EUR') return 1;

    const day = this.today();
    const hit = this.cache.get(cur);
    if (hit && hit.day === day) return hit.rate;

    let rate: number | null;
    const peg = PricingFxService.USD_PEG[cur];
    if (peg) {
      const usdEur = await this.frankfurter('USD');
      rate = usdEur != null ? round6(usdEur / peg) : null;
    } else {
      const r = await this.frankfurter(cur);
      rate = r != null ? round6(r) : null;
    }
    if (rate == null) this.logger.warn(`No FX rate for ${cur} — pricing for that channel will be unavailable`);
    this.cache.set(cur, { rate, day });
    return rate;
  }

  /** Resolve every currency once, so a cross-channel run makes one call per currency. */
  async ratesFor(currencies: (string | null | undefined)[]): Promise<Map<string, number | null>> {
    const unique = [...new Set(currencies.filter(Boolean).map((c) => c!.toUpperCase()))];
    const out = new Map<string, number | null>();
    await Promise.all(unique.map(async (c) => out.set(c, await this.toEur(c))));
    return out;
  }
}

const round6 = (v: number) => Number(v.toFixed(6));
