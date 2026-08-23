// Whether a product may be sold on a marketplace at all.
//
// Distinct from readiness, and the distinction is the point. Readiness asks "do we hold everything
// this channel needs?" and is fixed by typing. Eligibility asks "is this product permitted here?"
// and cannot be fixed by typing — a 230V appliance must never reach a US listing however complete
// its record is. The failure mode is a customer receiving something that cannot be plugged in.
//
// PURE: the caller supplies the product facts and the marketplace facts. No database, no clock.

export interface ProductTechnical {
  /** The mains range the product is rated for. Null = not stated, which is not the same as none. */
  voltageMinV: number | null;
  voltageMaxV: number | null;
  /** Free text, because dual-frequency is normal: "50", "60", "50/60". */
  frequencyHz: string | null;
  /** IEC plug letter. */
  plugType: string | null;
  batteryRequired: boolean | null;
  hazmatClass: string | null;
}

export interface MarketProfile {
  channelType: string;
  marketplace: string;
  label: string;
  mainsVoltageMinV: number | null;
  mainsVoltageMaxV: number | null;
  mainsFrequencyHz: string | null;
  plugTypes: string[];
  allowBatteries: boolean;
  allowHazmat: boolean;
  active: boolean;
}

export type FindingCode = 'VOLTAGE' | 'PLUG' | 'FREQUENCY' | 'BATTERY' | 'HAZMAT';

export interface Finding {
  code: FindingCode;
  /**
   * 'block' refuses the listing. 'warn' is a commercial judgement left to a human.
   *
   * Only physical impossibility blocks. A UK plug in Germany is an adapter and a customer
   * complaint; 230V on 120V mains is a dead appliance, and sometimes a fire.
   */
  severity: 'block' | 'warn';
  reason: string;
}

export interface EligibilityVerdict {
  eligible: boolean;
  findings: Finding[];
  /** Facts the product does not state, so we could not check them. Never a block on its own. */
  unchecked: FindingCode[];
}

/**
 * Judge one product against one marketplace.
 *
 * Silence is not consent: a product that states no voltage is reported as unchecked rather than
 * cleared, so "we looked and it is fine" stays distinguishable from "we had nothing to look at".
 */
export function evaluateEligibility(product: ProductTechnical, market: MarketProfile): EligibilityVerdict {
  const findings: Finding[] = [];
  const unchecked: FindingCode[] = [];

  // --- Mains voltage ------------------------------------------------------
  const pv = range(product.voltageMinV, product.voltageMaxV);
  const mv = range(market.mainsVoltageMinV, market.mainsVoltageMaxV);
  if (!pv) {
    unchecked.push('VOLTAGE');
  } else if (mv && !intersects(pv, mv)) {
    // Intersection rather than containment on purpose. A product recorded as "230-230" is still
    // fine on 220-240V mains, and demanding exact band arithmetic would block correct products
    // on a data-entry technicality.
    findings.push({
      code: 'VOLTAGE',
      severity: 'block',
      reason: `Rated ${fmt(pv)}V; ${market.label} mains is ${fmt(mv)}V`,
    });
  }

  // --- Frequency ----------------------------------------------------------
  if (product.frequencyHz && market.mainsFrequencyHz) {
    const productHz = hzSet(product.frequencyHz);
    const marketHz = hzSet(market.mainsFrequencyHz);
    if (productHz.length && marketHz.length && !marketHz.some((h) => productHz.includes(h))) {
      // A warning, not a block: most modern electronics do not care, but anything with a motor or
      // a mains-synchronous clock does, and only a human knows which this is.
      findings.push({
        code: 'FREQUENCY',
        severity: 'warn',
        reason: `Rated ${product.frequencyHz}Hz; ${market.label} mains is ${market.mainsFrequencyHz}Hz`,
      });
    }
  } else if (!product.frequencyHz) {
    unchecked.push('FREQUENCY');
  }

  // --- Plug type ----------------------------------------------------------
  if (!product.plugType) {
    unchecked.push('PLUG');
  } else if (market.plugTypes.length && !market.plugTypes.includes(product.plugType.toUpperCase())) {
    findings.push({
      code: 'PLUG',
      severity: 'warn',
      reason: `Type ${product.plugType.toUpperCase()} plug; ${market.label} uses ${market.plugTypes.join(', ')}`,
    });
  }

  // --- Batteries and dangerous goods --------------------------------------
  if (product.batteryRequired === true && !market.allowBatteries) {
    findings.push({ code: 'BATTERY', severity: 'block', reason: `${market.label} does not accept battery products` });
  }
  if (product.hazmatClass && !market.allowHazmat) {
    findings.push({ code: 'HAZMAT', severity: 'block', reason: `${market.label} does not accept ${product.hazmatClass}` });
  }

  return {
    eligible: !findings.some((f) => f.severity === 'block'),
    findings,
    unchecked,
  };
}

type Range = { lo: number; hi: number };

/** A single stated figure is a range of one — "230V" and "230-230V" mean the same thing. */
function range(min: number | null, max: number | null): Range | null {
  const lo = min ?? max;
  const hi = max ?? min;
  if (lo == null || hi == null) return null;
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo <= 0 || hi <= 0) return null;
  return { lo: Math.min(lo, hi), hi: Math.max(lo, hi) };
}

const intersects = (a: Range, b: Range): boolean => a.lo <= b.hi && b.lo <= a.hi;
const fmt = (r: Range): string => (r.lo === r.hi ? `${r.lo}` : `${r.lo}-${r.hi}`);

/** "50/60" and "50-60" both mean a product that handles either. */
function hzSet(value: string): number[] {
  return value
    .split(/[^0-9]+/)
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n) && n > 0);
}
