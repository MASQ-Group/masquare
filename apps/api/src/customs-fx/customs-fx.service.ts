import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { parseCustomsFxCsv, type ParsedRate } from './customs-fx.parser';

// Cyprus open-data portal (DKAN). The CSV filename changes each month, so we
// resolve the current download URL from the DCAT-AP metadata rather than
// hardcoding it. Dataset 1100 = "Exchange rates for customs purposes".
const DCAT_URL = 'https://www.data.gov.cy/index.php/el/dataset/1100/dcat-ap-2.0/json';
const DATASET_PAGE = 'https://www.data.gov.cy/index.php/el/dataset/synallagmatikes-isotimies-xenon-nomismaton-me-eyro-gia-teloneiakoys-skopoys';

export interface SyncResult {
  status: 'success' | 'error';
  message?: string;
  sourceUrl?: string;
  sourceModified?: string | null;
  monthsImported: number;
  ratesImported: number;
}

@Injectable()
export class CustomsFxService implements OnModuleInit {
  private readonly logger = new Logger(CustomsFxService.name);
  private syncing = false;

  constructor(private readonly prisma: PrismaService) {}

  /** On boot, populate once if the table is empty (best-effort, non-blocking). */
  async onModuleInit() {
    const count = await this.prisma.customsExchangeRate.count();
    if (count === 0) {
      this.logger.log('No customs FX rates stored — running initial sync.');
      this.sync('startup').catch((e) => this.logger.error(`Initial customs FX sync failed: ${e?.message ?? e}`));
    }
  }

  /** Pull on the 2nd of every month at 06:00 (customs publishes early-month). */
  @Cron('0 6 2 * *')
  async scheduledSync() {
    this.logger.log('Running scheduled monthly customs FX sync.');
    await this.sync('schedule').catch((e) => this.logger.error(`Scheduled customs FX sync failed: ${e?.message ?? e}`));
  }

  private async fetchWithTimeout(url: string, ms: number): Promise<Response> {
    return fetch(url, { signal: AbortSignal.timeout(ms), headers: { 'User-Agent': 'maSquare/1.0 (+customs-fx-sync)' } });
  }

  /** Resolve the current CSV download URL + modified date from the DCAT metadata.
   *  The portal returns JSON-LD converted from RDF/XML, so values are nested under
   *  keys like `rdf:value`, `@rdf:resource` and `#`. */
  private async discoverCsv(): Promise<{ url: string; modified: string | null }> {
    const res = await this.fetchWithTimeout(DCAT_URL, 8000);
    if (!res.ok) throw new Error(`DCAT metadata request failed (HTTP ${res.status})`);
    const json: any = await res.json();

    const dists: any[] = [].concat(json['dcat:Distribution'] ?? []);
    for (const d of dists) {
      const fmt = (d['dct:format']?.['dct:MediaTypeOrExtent']?.['rdf:value'] ?? '').toString().toLowerCase();
      const media = (d['dcat:mediaType']?.['dct:MediaType']?.['rdf:value'] ?? '').toString().toLowerCase();
      const url = d['dcat:downloadURL']?.['@rdf:resource'];
      if (url && (fmt.includes('csv') || media.includes('csv'))) {
        const modified = d['dct:modified']?.['#'] ?? d['dct:issued']?.['#'] ?? null;
        return { url, modified };
      }
    }
    throw new Error('No CSV distribution found in the dataset metadata.');
  }

  /** Full pull: discover URL → download CSV → parse → upsert → log the run. */
  async sync(trigger: 'manual' | 'schedule' | 'startup' = 'manual'): Promise<SyncResult> {
    if (this.syncing) return { status: 'error', message: 'A sync is already in progress.', monthsImported: 0, ratesImported: 0 };
    this.syncing = true;
    let sourceUrl: string | undefined;
    let sourceModified: string | null = null;
    try {
      const discovered = await this.discoverCsv();
      sourceUrl = discovered.url;
      sourceModified = discovered.modified;

      const res = await this.fetchWithTimeout(sourceUrl, 20000);
      if (!res.ok) throw new Error(`CSV download failed (HTTP ${res.status})`);
      const csv = await res.text();
      const rates = parseCustomsFxCsv(csv);
      if (rates.length === 0) throw new Error('The downloaded CSV produced no rows.');

      const months = new Set(rates.map((r) => `${r.year}-${r.month}`));
      await this.upsertRates(rates);

      const result: SyncResult = {
        status: 'success',
        sourceUrl,
        sourceModified,
        monthsImported: months.size,
        ratesImported: rates.length,
      };
      await this.prisma.customsFxSync.create({
        data: {
          status: 'success', sourceUrl, sourceModified: sourceModified ? new Date(sourceModified) : null,
          monthsImported: months.size, ratesImported: rates.length, trigger,
        },
      });
      this.logger.log(`Customs FX sync ok — ${rates.length} rates across ${months.size} months.`);
      return result;
    } catch (e: any) {
      const message = e?.message ?? String(e);
      await this.prisma.customsFxSync.create({
        data: { status: 'error', message, sourceUrl, sourceModified: sourceModified ? new Date(sourceModified) : null, trigger },
      }).catch(() => undefined);
      this.logger.error(`Customs FX sync failed: ${message}`);
      return { status: 'error', message, sourceUrl, sourceModified, monthsImported: 0, ratesImported: 0 };
    } finally {
      this.syncing = false;
    }
  }

  /** Upsert each (year, month, currency) → rate in batches. */
  private async upsertRates(rates: ParsedRate[]) {
    const CHUNK = 200;
    for (let i = 0; i < rates.length; i += CHUNK) {
      const slice = rates.slice(i, i + CHUNK);
      await this.prisma.$transaction(
        async (tx) => {
          for (const r of slice) {
            await tx.customsExchangeRate.upsert({
              where: { year_month_currencyCode: { year: r.year, month: r.month, currencyCode: r.currencyCode } },
              create: { year: r.year, month: r.month, currencyCode: r.currencyCode, currencyName: r.currencyName, rate: r.rate },
              update: { rate: r.rate, currencyName: r.currencyName },
            });
          }
        },
        { timeout: 30000, maxWait: 15000 },
      );
    }
  }

  /** Pivoted view for a given year (defaults to the latest stored year). */
  async list(yearInput?: number) {
    const years = await this.prisma.customsExchangeRate.findMany({
      distinct: ['year'], select: { year: true }, orderBy: { year: 'desc' },
    });
    const availableYears = years.map((y) => y.year);
    const year = yearInput && availableYears.includes(yearInput) ? yearInput : availableYears[0] ?? null;

    const currencies = await this.currencyList();
    const lastSync = await this.lastSync();

    if (year == null) return { year: null, availableYears, currencies, months: [], lastSync, source: DATASET_PAGE };

    const rows = await this.prisma.customsExchangeRate.findMany({
      where: { year }, orderBy: [{ month: 'asc' }],
    });
    const byMonth = new Map<number, Record<string, number>>();
    for (const r of rows) {
      if (!byMonth.has(r.month)) byMonth.set(r.month, {});
      byMonth.get(r.month)![r.currencyCode] = r.rate;
    }
    const months = [...byMonth.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([month, rates]) => ({ month, rates }));

    return { year, availableYears, currencies, months, lastSync, source: DATASET_PAGE };
  }

  /** Distinct currencies present, ordered by how often the platform uses them, then alpha. */
  private async currencyList() {
    const rows = await this.prisma.customsExchangeRate.findMany({
      distinct: ['currencyCode'], select: { currencyCode: true, currencyName: true },
    });
    const priority = ['USD', 'GBP', 'AED', 'SAR', 'AUD', 'CAD', 'JPY', 'MXN', 'PLN', 'SEK', 'SGD', 'TRY'];
    return rows
      .map((r) => ({ code: r.currencyCode, name: r.currencyName }))
      .sort((a, b) => {
        const pa = priority.indexOf(a.code); const pb = priority.indexOf(b.code);
        if (pa !== -1 || pb !== -1) return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
        return a.code.localeCompare(b.code);
      });
  }

  async lastSync() {
    return this.prisma.customsFxSync.findFirst({ orderBy: { createdAt: 'desc' } });
  }
}
