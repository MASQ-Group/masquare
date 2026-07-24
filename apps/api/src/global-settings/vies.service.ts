import { Injectable, Logger } from '@nestjs/common';

export interface ViesResult {
  /** true / false once VIES answered; null when we couldn't get an answer. */
  valid: boolean | null;
  /** Registered name VIES returned (member states may withhold it). */
  name?: string | null;
  address?: string | null;
  checkedAt: Date;
  /** Human-readable outcome for the UI. */
  message: string;
}

/** The 27 member states VIES covers, in the codes VIES itself uses (EL, not GR). */
const EU_VAT_COUNTRIES = new Set([
  'AT','BE','BG','CY','CZ','DE','DK','EE','EL','ES','FI','FR','HR','HU','IE',
  'IT','LT','LU','LV','MT','NL','PL','PT','RO','SE','SI','SK',
]);

/** VAT numbers are stored however the user typed them; VIES wants CC + digits. */
function splitVatNumber(raw: string): { country: string; number: string } | null {
  const cleaned = raw.replace(/[\s.-]/g, '').toUpperCase();
  const m = cleaned.match(/^([A-Z]{2})([0-9A-Z]{2,14})$/);
  if (!m) return null;
  // Greece files under EL in VIES even though its ISO code is GR.
  const country = m[1] === 'GR' ? 'EL' : m[1];
  return { country, number: m[2] };
}

/**
 * Checks EU VAT numbers against the Commission's VIES service.
 *
 * VIES is frequently slow or partially unavailable (individual member states drop
 * out), so every failure resolves to `valid: null` with an explanation rather than
 * throwing — the caller records the attempt and carries on. Verification is
 * advisory: it never blocks saving a vendor or raising a purchase order.
 */
@Injectable()
export class ViesService {
  private readonly logger = new Logger(ViesService.name);
  private readonly endpoint = 'https://ec.europa.eu/taxation_customs/vies/rest-api/ms';
  private readonly timeoutMs = 8000;

  async check(vatNumber: string | null | undefined): Promise<ViesResult> {
    const checkedAt = new Date();
    if (!vatNumber?.trim()) {
      return { valid: null, checkedAt, message: 'No VAT number to check' };
    }
    const parts = splitVatNumber(vatNumber);
    if (!parts) {
      return { valid: false, checkedAt, message: 'Not a valid EU VAT number format (expected e.g. CY12345678X)' };
    }
    // VIES only knows EU member states; anything else is a definite answer, not an outage.
    if (!EU_VAT_COUNTRIES.has(parts.country)) {
      return { valid: false, checkedAt, message: `${parts.country} is not an EU VAT country — VIES cannot verify it` };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.endpoint}/${parts.country}/vat/${parts.number}`, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        return { valid: null, checkedAt, message: `VIES returned HTTP ${res.status} — try again later` };
      }
      const body: any = await res.json();

      // VIES reports member-state outages in userError rather than the HTTP status.
      const userError: string | undefined = body?.userError;
      if (userError && userError !== 'VALID' && userError !== 'INVALID') {
        return { valid: null, checkedAt, message: `VIES could not answer (${userError}) — try again later` };
      }
      const valid = body?.isValid === true;
      return {
        valid,
        name: body?.name && body.name !== '---' ? body.name : null,
        address: body?.address && body.address !== '---' ? body.address : null,
        checkedAt,
        message: valid ? 'VAT number is valid in VIES' : 'VIES does not recognise this VAT number',
      };
    } catch (err: any) {
      const aborted = err?.name === 'AbortError';
      this.logger.warn(`VIES check failed for ${vatNumber}: ${aborted ? 'timeout' : String(err)}`);
      return {
        valid: null,
        checkedAt,
        message: aborted ? 'VIES did not respond in time — try again later' : 'Could not reach VIES — try again later',
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
