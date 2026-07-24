import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { Browser } from 'puppeteer';

/**
 * Renders HTML to PDF with a headless browser, so the document is authored as a
 * normal HTML/CSS template (see purchase-order-template.ts) rather than drawn by
 * hand. One browser is launched lazily and reused — starting Chromium per request
 * costs about a second — and is closed when the app shuts down.
 */
@Injectable()
export class PdfService implements OnModuleDestroy {
  private readonly logger = new Logger(PdfService.name);
  private browser: Browser | null = null;
  private launching: Promise<Browser> | null = null;

  private async getBrowser(): Promise<Browser> {
    if (this.browser?.connected) return this.browser;
    // Collapse concurrent first-hits onto a single launch.
    if (!this.launching) {
      const puppeteer = await import('puppeteer');
      this.launching = puppeteer
        .launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
        .then((b) => {
          this.browser = b;
          this.launching = null;
          return b;
        })
        .catch((err) => {
          this.launching = null;
          throw err;
        });
    }
    return this.launching;
  }

  async htmlToPdf(html: string): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      // The template is self-contained (inlined logo, no webfonts), so there is
      // nothing to wait on beyond the document itself.
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      const pdf = await page.pdf({ format: 'A4', printBackground: true });
      return Buffer.from(pdf);
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  async onModuleDestroy() {
    if (this.browser) {
      await this.browser.close().catch((e) => this.logger.warn(`Could not close browser: ${String(e)}`));
      this.browser = null;
    }
  }
}
