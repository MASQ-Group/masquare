import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { pctToFraction } from '../common/money';
import { MARKETPLACE_TO_ISO, toCountryIso } from '../config/repricing.config';

// The solver must NOT own VAT rate tables (spec §4.3) — it takes the resolved rate as an input.
// maSquare has no single "VAT determination engine" (Deviation D-2); this thin adapter resolves
// the rate from what exists: the destination marketplace country's standard `Country.vatRate`.
//
// GAP (D-2, `TO VERIFY` with finance): reduced rates per product tax code for DE/FR/ES are NOT
// modelled — `VatClass` in this ERP is Cyprus-specific. Until a per-destination reduced-rate
// source exists, we resolve the marketplace's STANDARD rate only. A product that genuinely sells
// at a reduced rate would get too-high a floor here (conservative/safe, but flagged).

@Injectable()
export class VatService {
  private readonly logger = new Logger(VatService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Destination VAT rate for an Amazon marketplace, as a fraction (0.19 = 19%). Returns null when
   * it can't be resolved (unknown marketplace or missing Country row) — the caller then excludes
   * the SKU from automation (VAT_UNKNOWN) rather than guessing.
   */
  async resolveVatRate(marketplaceId: string): Promise<number | null> {
    // Amazon's marketplace code is not always the ISO code Country uses ('UK' vs 'GB') — normalise,
    // or the lookup silently misses and every SKU on that marketplace excludes as VAT_UNKNOWN.
    const iso = toCountryIso(MARKETPLACE_TO_ISO[marketplaceId]);
    if (!iso) {
      this.logger.warn(`No ISO mapping for marketplace ${marketplaceId}; cannot resolve VAT.`);
      return null;
    }
    const country = await this.prisma.country.findUnique({
      where: { isoCode: iso },
      select: { vatRate: true },
    });
    if (!country) {
      this.logger.warn(`No Country row for ISO ${iso} (marketplace ${marketplaceId}).`);
      return null;
    }
    return pctToFraction(Number(country.vatRate));
  }
}
