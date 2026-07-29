import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../crypto/crypto.service';
import { StorageService } from '../storage/storage.service';
import { SalesTransactionsService } from '../sales-transactions/sales-transactions.service';
import { configFieldKeys, getConnector, getMarketplace, listConnectors, secretFieldKeys, type ConnectorDef } from './connectors';
import { CreateIntegrationDto, UpdateIntegrationDto } from './dto/integration.dto';
import { mapOnBuyOrder } from './mappings/onbuy-mapping';
import { mapAmazonOrder } from './mappings/amazon-mapping';
import { mapEbayOrder, ebayMarketplaceToIso } from './mappings/ebay-mapping';
import type { MappedOrder } from './mappings/types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const num = (v: any) => { const x = Number(String(v ?? '').trim()); return Number.isFinite(x) ? x : 0; };
const round2 = (x: number) => Math.round(x * 100) / 100;

interface FeeBucket { bySku: Map<string, number>; total: number }
interface AmazonFees { sales: FeeBucket; fba: FeeBucket }

@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly salesTx: SalesTransactionsService,
    private readonly storage: StorageService,
  ) {}

  connectors() {
    return listConnectors();
  }

  private requireConnector(type: string): ConnectorDef {
    const c = getConnector(type);
    if (!c) throw new BadRequestException(`Unknown channel type: ${type}`);
    return c;
  }

  // ---------------------------------------------------------------- channel logos

  /** Every channel type's logo as a map { channelType: url }. Types without one are absent. */
  async listChannelLogos(): Promise<Record<string, string>> {
    const rows = await this.prisma.channelLogo.findMany({ select: { channelType: true, url: true } });
    return Object.fromEntries(rows.map((r) => [r.channelType, this.resolveLogoUrl(r.url)]));
  }

  /** Turn a stored logo reference into a live public URL. Newer rows store the bare
   *  object key; older rows stored a full absolute URL, sometimes against a stale base
   *  (e.g. the local MinIO `http://localhost:9000` endpoint, carried into prod by a DB
   *  migration). Either way we re-derive from the object key so the CURRENT public base
   *  always wins — a config change can never leave a frozen, broken URL again. */
  private resolveLogoUrl(stored: string): string {
    if (!stored) return stored;
    const idx = stored.indexOf('channel-logos/');
    if (idx === -1) return stored; // unrecognised shape — leave untouched
    return this.storage.publicUrl(stored.slice(idx));
  }

  /** Upload/replace the brand logo for a channel family. Keyed by the connector type. */
  async setChannelLogo(
    channelType: string,
    file: { buffer: Buffer; originalname: string; mimetype: string } | undefined,
    actorId?: string,
  ) {
    this.requireConnector(channelType); // only real connector types get a logo
    if (!file?.buffer?.length) throw new BadRequestException('No image was uploaded');

    const ext = (file.originalname.split('.').pop() || '').toLowerCase();
    const allowed = ['png', 'jpg', 'jpeg', 'webp', 'svg'];
    if (!allowed.includes(ext)) throw new BadRequestException('Logo must be a PNG, JPG, WEBP or SVG image');
    const MAX_BYTES = 1_000_000;
    if (file.buffer.length > MAX_BYTES) throw new BadRequestException('Logo must be 1 MB or smaller');

    const contentType = ext === 'svg' ? 'image/svg+xml' : file.mimetype || `image/${ext === 'jpg' ? 'jpeg' : ext}`;
    // A stable-ish key per upload avoids CDN cache collisions when a logo is replaced.
    const key = `channel-logos/${channelType}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    let url: string;
    try {
      url = await this.storage.putObject(key, file.buffer, contentType);
    } catch (e: any) {
      const cfg = this.storage.describe();
      this.logger.error(`Channel-logo upload to storage failed (${channelType}): ${e?.name ?? ''} ${e?.message ?? e} | cfg=${JSON.stringify(cfg)}`);
      throw new ServiceUnavailableException(`Image storage rejected the upload: ${(e?.name ? `${e.name}: ` : '') + (e?.message ?? 'unknown error')} — endpoint=${cfg.endpoint} (valid=${cfg.endpointValid}), bucket=${cfg.bucket}, publicBase=${cfg.publicBase}`.slice(0, 300));
    }

    // Persist the bare object key (not the absolute URL); the public URL is derived
    // on read against the current base, so it survives any storage-endpoint change.
    await this.prisma.channelLogo.upsert({
      where: { channelType },
      create: { channelType, url: key, updatedById: actorId ?? null },
      update: { url: key, updatedById: actorId ?? null },
    });
    return { channelType, url };
  }

  async removeChannelLogo(channelType: string) {
    await this.prisma.channelLogo.deleteMany({ where: { channelType } });
    return { channelType, removed: true };
  }

  /** Public shape — config + which secret fields are set (masked). NEVER secrets. */
  private serialize(row: any, secrets: { fieldKey: string; last4: string }[]) {
    const connector = getConnector(row.channelType);
    const setKeys = new Map(secrets.map((s) => [s.fieldKey, s.last4]));
    const secretFields = (connector ? secretFieldKeys(connector) : []).map((key) => ({
      fieldKey: key,
      set: setKeys.has(key),
      last4: setKeys.get(key) ?? null,
    }));
    const marketplace = getMarketplace(row.channelType, row.marketplace);
    return {
      id: row.id,
      name: row.name,
      channelType: row.channelType,
      connectorLabel: connector?.label ?? row.channelType,
      marketplace: row.marketplace ?? null,
      marketplaceLabel: marketplace?.label ?? row.marketplace ?? null,
      config: row.config ?? {},
      status: row.status,
      lastTestedAt: row.lastTestedAt,
      lastTestStatus: row.lastTestStatus,
      lastTestMessage: row.lastTestMessage,
      mappingVerifiedAt: row.mappingVerifiedAt ?? null,
      targetSalesChannelId: row.targetSalesChannelId ?? null,
      targetCompanyId: row.targetCompanyId ?? null,
      autoSyncEnabled: row.autoSyncEnabled ?? false,
      backfillDays: row.backfillDays ?? 30,
      lastSyncedAt: row.lastSyncedAt ?? null,
      lastSyncRunAt: row.lastSyncRunAt ?? null,
      lastSyncStatus: row.lastSyncStatus ?? null,
      lastSyncMessage: row.lastSyncMessage ?? null,
      secretFields,
      createdAt: row.createdAt,
    };
  }

  async list() {
    const rows = await this.prisma.channelIntegration.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { secrets: { select: { fieldKey: true, last4: true } } },
    });
    return rows.map((r) => this.serialize(r, r.secrets));
  }

  async get(id: string) {
    const row = await this.prisma.channelIntegration.findFirst({
      where: { id, deletedAt: null },
      include: { secrets: { select: { fieldKey: true, last4: true } } },
    });
    if (!row) throw new NotFoundException('Integration not found');
    return this.serialize(row, row.secrets);
  }

  /** Keep only known config keys as strings (drops unknown/secret keys). */
  private cleanConfig(connector: ConnectorDef, config?: Record<string, string>) {
    const allowed = new Set(configFieldKeys(connector));
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(config ?? {})) {
      if (allowed.has(k) && v != null) out[k] = String(v);
    }
    return out;
  }

  async create(dto: CreateIntegrationDto, actorId?: string) {
    const connector = this.requireConnector(dto.channelType);
    const config = this.cleanConfig(connector, dto.config);
    const created = await this.prisma.channelIntegration.create({
      data: { name: dto.name, channelType: dto.channelType, marketplace: dto.marketplace ?? null, config, createdById: actorId, updatedById: actorId },
    });
    await this.audit(created.id, actorId, 'create', dto.name);
    if (dto.secrets) await this.writeSecrets(created.id, connector, dto.secrets, actorId, true);
    return this.get(created.id);
  }

  async update(id: string, dto: UpdateIntegrationDto, actorId?: string) {
    const existing = await this.prisma.channelIntegration.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Integration not found');
    const connector = this.requireConnector(existing.channelType);
    const nextConfig = dto.config ? { ...(existing.config as object), ...this.cleanConfig(connector, dto.config) } : undefined;
    await this.prisma.channelIntegration.update({
      where: { id },
      data: {
        name: dto.name, status: dto.status, marketplace: dto.marketplace,
        targetSalesChannelId: dto.targetSalesChannelId, targetCompanyId: dto.targetCompanyId,
        autoSyncEnabled: dto.autoSyncEnabled, backfillDays: dto.backfillDays,
        ...(nextConfig ? { config: nextConfig } : {}), updatedById: actorId,
      },
    });
    await this.audit(id, actorId, 'update');
    if (dto.secrets) await this.writeSecrets(id, connector, dto.secrets, actorId, false);
    return this.get(id);
  }

  /** Encrypt + upsert provided secret fields. Empty/blank values are left unchanged. */
  private async writeSecrets(integrationId: string, connector: ConnectorDef, secrets: Record<string, string>, actorId: string | undefined, isCreate: boolean) {
    const allowed = new Set(secretFieldKeys(connector));
    for (const [fieldKey, rawValue] of Object.entries(secrets)) {
      if (!allowed.has(fieldKey)) continue;
      const value = (rawValue ?? '').trim();
      if (value === '') continue; // omitted → leave existing secret untouched
      const enc = this.crypto.encrypt(value);
      const existed = await this.prisma.integrationSecret.findUnique({ where: { integrationId_fieldKey: { integrationId, fieldKey } } });
      await this.prisma.integrationSecret.upsert({
        where: { integrationId_fieldKey: { integrationId, fieldKey } },
        create: { integrationId, fieldKey, ...enc, last4: CryptoService.last4(value) },
        update: { ...enc, last4: CryptoService.last4(value) },
      });
      await this.audit(integrationId, actorId, existed ? 'secret.replace' : 'secret.set', fieldKey);
    }
  }

  async remove(id: string, actorId?: string) {
    const existing = await this.prisma.channelIntegration.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Integration not found');
    await this.prisma.channelIntegration.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit(id, actorId, 'delete', existing.name);
    return { ok: true };
  }

  /** Decrypt secrets into memory. INTERNAL ONLY — never exposed through a controller. */
  private async decryptedSecrets(integrationId: string): Promise<Record<string, string>> {
    const rows = await this.prisma.integrationSecret.findMany({ where: { integrationId } });
    const out: Record<string, string> = {};
    for (const r of rows) out[r.fieldKey] = this.crypto.decrypt({ ciphertext: r.ciphertext, iv: r.iv, authTag: r.authTag, keyVersion: r.keyVersion });
    return out;
  }

  /** Test connectivity using stored keys — returns ok/fail only, no secrets. */
  async test(id: string, mode: 'live' | 'test' = 'test', actorId?: string) {
    const row = await this.prisma.channelIntegration.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException('Integration not found');
    const result = await this.runTest(row, mode);
    await this.prisma.channelIntegration.update({
      where: { id },
      data: { lastTestedAt: new Date(), lastTestStatus: result.ok ? 'ok' : 'fail', lastTestMessage: result.message.slice(0, 300) },
    });
    await this.audit(id, actorId, 'test', `${mode}: ${result.ok ? 'ok' : 'fail'}`);
    return result;
  }

  private async runTest(row: any, mode: 'live' | 'test'): Promise<{ ok: boolean; message: string }> {
    const config = (row.config ?? {}) as Record<string, string>;
    const secrets = await this.decryptedSecrets(row.id);
    if (row.channelType === 'amazon') return this.testAmazon(config, secrets);
    if (row.channelType === 'ebay') return this.testEbay(config, secrets);
    if (row.channelType === 'onbuy') return this.testOnBuy(config, secrets, mode);
    return { ok: false, message: 'Testing not supported for this channel yet.' };
  }

  /** Amazon LWA: exchange the refresh token for an access token (validates the
   *  Client ID/Secret + Refresh Token). Endpoint is global (region-independent). */
  private async testAmazon(config: Record<string, string>, secrets: Record<string, string>): Promise<{ ok: boolean; message: string }> {
    const clientId = config.lwaClientId;
    const clientSecret = secrets.lwaClientSecret;
    const refreshToken = secrets.refreshToken;
    if (!clientId || !clientSecret || !refreshToken) return { ok: false, message: 'Need LWA Client ID, Client Secret and Refresh Token.' };
    try {
      const res = await fetch('https://api.amazon.com/auth/o2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret }).toString(),
        signal: AbortSignal.timeout(8000),
      });
      const json: any = await res.json().catch(() => null);
      if (res.ok && json?.access_token) return { ok: true, message: 'Authenticated with Amazon LWA — access token received.' };
      const detail = (json?.error_description || json?.error || '').toString().slice(0, 160);
      return { ok: false, message: `Amazon responded ${res.status}${detail ? `: ${detail}` : ''}` };
    } catch (e: any) {
      return { ok: false, message: e?.name === 'TimeoutError' ? 'Request timed out.' : 'Could not reach Amazon LWA.' };
    }
  }

  /** eBay OAuth: client-credentials grant validates the App ID + Cert ID keyset. */
  private async testEbay(config: Record<string, string>, secrets: Record<string, string>): Promise<{ ok: boolean; message: string }> {
    const appId = config.appId;
    const certId = secrets.certId;
    if (!appId || !certId) return { ok: false, message: 'Need App ID (Client ID) and Cert ID (Client Secret).' };
    const base = config.env === 'sandbox' ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com';
    try {
      const res = await fetch(`${base}/identity/v1/oauth2/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(`${appId}:${certId}`).toString('base64')}`,
        },
        body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'https://api.ebay.com/oauth/api_scope' }).toString(),
        signal: AbortSignal.timeout(8000),
      });
      const json: any = await res.json().catch(() => null);
      if (res.ok && json?.access_token) return { ok: true, message: 'Authenticated with eBay — application token received.' };
      const detail = (json?.error_description || json?.error || '').toString().slice(0, 160);
      return { ok: false, message: `eBay responded ${res.status}${detail ? `: ${detail}` : ''}` };
    } catch (e: any) {
      return { ok: false, message: e?.name === 'TimeoutError' ? 'Request timed out.' : 'Could not reach the eBay API.' };
    }
  }

  /** Read-only Sell API scopes (the default — what every historical token was granted). The scope
   *  set requested on refresh MUST be a subset of what the stored token carries, so a read-only
   *  token must keep refreshing with read-only scopes. */
  private readonly ebayReadScopes = [
    'https://api.ebay.com/oauth/api_scope',
    'https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly',
    'https://api.ebay.com/oauth/api_scope/sell.inventory.readonly',
    'https://api.ebay.com/oauth/api_scope/sell.account.readonly',
    'https://api.ebay.com/oauth/api_scope/sell.finances',
    'https://api.ebay.com/oauth/api_scope/commerce.identity.readonly',
  ];
  /** Write-enabled set: the full sell.inventory scope (read + WRITE) replaces the read-only one, so
   *  ReviseInventoryStatus / quantity pushes are authorised. Only used once the integration's token
   *  was granted this scope (config.ebayWriteEnabled), else the refresh would fail as out-of-scope. */
  private readonly ebayWriteScopes = [
    'https://api.ebay.com/oauth/api_scope',
    'https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly',
    'https://api.ebay.com/oauth/api_scope/sell.inventory',
    'https://api.ebay.com/oauth/api_scope/sell.account.readonly',
    'https://api.ebay.com/oauth/api_scope/sell.finances',
    'https://api.ebay.com/oauth/api_scope/commerce.identity.readonly',
  ];
  /** Opt-in per integration: only request the write scope once the operator has supplied a token
   *  granted for it (config.ebayWriteEnabled = 'true'). Default stays read-only → zero downtime. */
  private ebayScopesFor(config: Record<string, any>): string[] {
    const on = config?.ebayWriteEnabled === true || config?.ebayWriteEnabled === 'true';
    return on ? this.ebayWriteScopes : this.ebayReadScopes;
  }

  /** Build the eBay OAuth consent URL for an integration (state = integration id). */
  async ebayConsentUrl(integrationId: string): Promise<string> {
    const row = await this.prisma.channelIntegration.findFirst({ where: { id: integrationId, deletedAt: null, channelType: 'ebay' } });
    if (!row) throw new NotFoundException('eBay integration not found');
    const config = row.config as Record<string, string>;
    if (!config.appId || !config.ruName) throw new BadRequestException('Set the eBay App ID and RuName on the integration first.');
    const authHost = config.env === 'sandbox' ? 'https://auth.sandbox.ebay.com' : 'https://auth.ebay.com';
    const q = new URLSearchParams({ client_id: config.appId, response_type: 'code', redirect_uri: config.ruName, scope: this.ebayScopesFor(config).join(' '), state: row.id });
    return `${authHost}/oauth2/authorize?${q.toString()}`;
  }

  /** Resolve which eBay integration a callback targets: the state id if valid, else the
   *  single configured eBay integration (so the flow works without threading the prod id). */
  private async resolveEbayIntegration(stateId?: string) {
    // Only look up by id when state is actually a UUID — the id column is @db.Uuid, so a
    // non-UUID state (e.g. our "ebay-connect" marker) would throw at the DB layer.
    const isUuid = !!stateId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(stateId);
    if (isUuid) {
      const byId = await this.prisma.channelIntegration.findFirst({ where: { id: stateId, deletedAt: null, channelType: 'ebay' } });
      if (byId) return byId;
    }
    const all = await this.prisma.channelIntegration.findMany({ where: { deletedAt: null, channelType: 'ebay' } });
    if (all.length === 0) throw new NotFoundException('No eBay integration is configured. Add one under Integrations first (App ID, Cert ID, RuName).');
    if (all.length > 1) throw new BadRequestException('More than one eBay integration exists — cannot tell which to connect.');
    return all[0];
  }

  /** Exchange an eBay OAuth authorization code for a long-lived refresh token; store it. */
  async exchangeEbayOAuthCode(integrationId: string | undefined, code: string, actorId?: string) {
    const row = await this.resolveEbayIntegration(integrationId);
    const connector = this.requireConnector('ebay');
    const config = row.config as Record<string, string>;
    const secrets = await this.decryptedSecrets(row.id);
    const { appId, ruName } = config;
    const certId = secrets.certId;
    if (!appId || !certId || !ruName) throw new BadRequestException('eBay integration is missing App ID, Cert ID or RuName — set them on the integration first.');
    const base = config.env === 'sandbox' ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com';
    const res = await fetch(`${base}/identity/v1/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${Buffer.from(`${appId}:${certId}`).toString('base64')}` },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: ruName }).toString(),
      signal: AbortSignal.timeout(15000),
    });
    const json: any = await res.json().catch(() => null);
    if (!res.ok || !json?.refresh_token) {
      const detail = (json?.error_description || json?.error || `HTTP ${res.status}`).toString().slice(0, 200);
      throw new BadRequestException(`eBay token exchange failed: ${detail}`);
    }
    await this.writeSecrets(row.id, connector, { refreshToken: json.refresh_token }, actorId, false);
    await this.prisma.channelIntegration.update({ where: { id: row.id }, data: { lastTestStatus: 'ok', lastTestMessage: 'eBay account connected (OAuth).', lastTestedAt: new Date() } });
    await this.audit(row.id, actorId, 'oauth.connect', 'ebay');
    return { ok: true, integrationId: row.id, name: row.name, refreshTokenExpiresInDays: json.refresh_token_expires_in ? Math.round(Number(json.refresh_token_expires_in) / 86400) : null };
  }

  /** eBay OAuth: refresh-token grant → short-lived user access token for Sell API calls. */
  private async ebayAccessToken(config: Record<string, string>, secrets: Record<string, string>): Promise<string> {
    const appId = config.appId;
    const certId = secrets.certId;
    const refreshToken = secrets.refreshToken;
    if (!appId || !certId || !refreshToken) throw new BadRequestException('eBay integration is missing App ID, Cert ID or Refresh Token.');
    const base = config.env === 'sandbox' ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com';
    const res = await fetch(`${base}/identity/v1/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${Buffer.from(`${appId}:${certId}`).toString('base64')}` },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, scope: this.ebayScopesFor(config).join(' ') }).toString(),
      signal: AbortSignal.timeout(10000),
    });
    const json: any = await res.json().catch(() => null);
    if (!res.ok || !json?.access_token) throw new BadRequestException(`eBay token refresh failed (${res.status}${json?.error ? `: ${json.error}` : ''}).`);
    return json.access_token as string;
  }

  /** One page of eBay Sell Fulfillment API orders (line items + pricing included in the order). */
  private async ebayGetOrdersPage(base: string, token: string, opts: { filter?: string; limit?: number; offset?: number }): Promise<{ ok: boolean; status?: number; message?: string; orders: any[]; total: number }> {
    const q = new URLSearchParams();
    if (opts.filter) q.set('filter', opts.filter);
    q.set('limit', String(opts.limit ?? 50));
    if (opts.offset) q.set('offset', String(opts.offset));
    const res = await fetch(`${base}/sell/fulfillment/v1/order?${q.toString()}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(20000),
    });
    const json: any = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, status: res.status, message: (json?.errors?.[0]?.message || `HTTP ${res.status}`).toString().slice(0, 200), orders: [], total: 0 };
    return { ok: true, orders: json?.orders ?? [], total: Number(json?.total ?? (json?.orders?.length ?? 0)) };
  }

  /** Read-only: fetch + map recent eBay orders for connection + mapping validation. */
  private async fetchEbayOrders(row: any, limit: number): Promise<{ ok: boolean; status?: number; message?: string; total: number; mapped: MappedOrder[] }> {
    const config = (row.config ?? {}) as Record<string, string>;
    const secrets = await this.decryptedSecrets(row.id);
    const token = await this.ebayAccessToken(config, secrets);
    const base = config.env === 'sandbox' ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com';
    const from = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString().replace(/\.\d+Z$/, '.000Z');
    const page = await this.ebayGetOrdersPage(base, token, { filter: `creationdate:[${from}..]`, limit });
    if (!page.ok) return { ok: false, status: page.status, message: page.message, total: 0, mapped: [] };
    return { ok: true, total: page.total, mapped: page.orders.slice(0, limit).map((o) => mapEbayOrder(o)) };
  }

  private async testOnBuy(config: Record<string, string>, secrets: Record<string, string>, mode: 'live' | 'test'): Promise<{ ok: boolean; message: string }> {
    const consumerKey = secrets[mode === 'live' ? 'liveConsumerKey' : 'testConsumerKey'];
    const secretKey = secrets[mode === 'live' ? 'liveSecretKey' : 'testSecretKey'];
    if (!consumerKey || !secretKey) return { ok: false, message: `Missing ${mode} Consumer/Secret key.` };
    const base = (config.url || 'https://api.onbuy.com/v2').replace(/\/+$/, '');
    try {
      // OnBuy v2 auth (docs.api.onbuy.com): POST /auth/request-token with
      // consumer_key + secret_key in an x-www-form-urlencoded body. A response
      // containing access_token = success. Token is valid ~15 minutes.
      const res = await fetch(`${base}/auth/request-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ consumer_key: consumerKey, secret_key: secretKey }).toString(),
        signal: AbortSignal.timeout(8000),
      });
      const text = await res.text();
      let json: any = null;
      try { json = JSON.parse(text); } catch { /* non-JSON */ }
      if (res.ok && json?.access_token) return { ok: true, message: 'Authenticated successfully — access token received.' };
      // Surface OnBuy's own error text (never contains our keys) to aid debugging.
      const detail = (json?.error?.message || json?.message || text || '').toString().slice(0, 160);
      return { ok: false, message: `OnBuy responded ${res.status}${detail ? `: ${detail}` : ''}` };
    } catch (e: any) {
      return { ok: false, message: e?.name === 'TimeoutError' ? 'Request timed out.' : 'Could not reach the OnBuy API — check the API URL.' };
    }
  }

  // --- OnBuy data pull (read-only preview for now) --------------------------

  /** Fresh OnBuy access token (valid ~15 min). Prefers live keys, else test. */
  private async onbuyAccessToken(config: Record<string, string>, secrets: Record<string, string>): Promise<{ token: string; mode: 'live' | 'test'; base: string }> {
    const mode: 'live' | 'test' = secrets.liveConsumerKey && secrets.liveSecretKey ? 'live' : 'test';
    const consumerKey = secrets[mode === 'live' ? 'liveConsumerKey' : 'testConsumerKey'];
    const secretKey = secrets[mode === 'live' ? 'liveSecretKey' : 'testSecretKey'];
    if (!consumerKey || !secretKey) throw new BadRequestException('No OnBuy keys set.');
    const base = (config.url || 'https://api.onbuy.com/v2').replace(/\/+$/, '');
    const res = await fetch(`${base}/auth/request-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ consumer_key: consumerKey, secret_key: secretKey }).toString(),
      signal: AbortSignal.timeout(8000),
    });
    const json: any = await res.json().catch(() => null);
    if (!res.ok || !json?.access_token) throw new BadRequestException(`OnBuy auth failed (${res.status}).`);
    return { token: json.access_token, mode, base };
  }

  /** One page of OnBuy orders (read-only) using an already-obtained token.
   *  IMPORTANT: without filter[status], OnBuy returns ONLY awaiting-dispatch
   *  orders — so we always request status=all to see dispatched/complete/etc.
   *  Date filters use OnBuy's `YYYY-MM-DD HH:MM:SS` format; sort by created desc. */
  private async onbuyOrdersPage(base: string, token: string, siteId: string | null, limit: number, offset: number, opts?: { dateFrom?: string; dateTo?: string }): Promise<{ ok: boolean; status?: number; message?: string; total: number | null; orders: any[] }> {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset), 'filter[status]': 'all', 'sort[created]': 'desc' });
    if (siteId) params.set('site_id', siteId);
    if (opts?.dateFrom) params.set('filter[date_from]', opts.dateFrom);
    if (opts?.dateTo) params.set('filter[date_to]', opts.dateTo);
    const res = await fetch(`${base}/orders?${params.toString()}`, { headers: { Authorization: token }, signal: AbortSignal.timeout(15000) });
    const json: any = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, status: res.status, message: (json?.error?.message || json?.message || '').toString().slice(0, 200), total: null, orders: [] };
    return { ok: true, total: json?.metadata?.total_rows ?? json?.total ?? null, orders: json?.results ?? (Array.isArray(json) ? json : []) };
  }

  /** Fetch recent OnBuy orders (read-only). Shared by preview + mapping. */
  private async fetchOnBuyOrders(row: any, limit: number): Promise<{ ok: boolean; mode: 'live' | 'test'; status?: number; message?: string; siteId: string | null; total: number | null; orders: any[] }> {
    const config = (row.config ?? {}) as Record<string, string>;
    const secrets = await this.decryptedSecrets(row.id);
    const { token, mode, base } = await this.onbuyAccessToken(config, secrets);
    const siteId = (config.siteIds || '').match(/\d+/)?.[0] ?? null;
    const page = await this.onbuyOrdersPage(base, token, siteId, limit, 0);
    return { ...page, mode, siteId };
  }

  // --- Amazon SP-API data pull ---------------------------------------------

  /** LWA: exchange the refresh token for a short-lived access token (~1h).
   *  The same token authorises every marketplace the refresh token covers. */
  private async amazonAccessToken(config: Record<string, string>, secrets: Record<string, string>): Promise<string> {
    const clientId = config.lwaClientId;
    const clientSecret = secrets.lwaClientSecret;
    const refreshToken = secrets.refreshToken;
    if (!clientId || !clientSecret || !refreshToken) throw new BadRequestException('Amazon integration is missing LWA Client ID, Client Secret or Refresh Token.');
    const res = await fetch('https://api.amazon.com/auth/o2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret }).toString(),
      signal: AbortSignal.timeout(10000),
    });
    const json: any = await res.json().catch(() => null);
    if (!res.ok || !json?.access_token) throw new BadRequestException(`Amazon LWA auth failed (${res.status}${json?.error ? `: ${json.error}` : ''}).`);
    return json.access_token as string;
  }

  /** Resolve the SP-API endpoint + marketplace id + a default destination country
   *  (used when Amazon withholds the shipping address without Restricted Data access). */
  private amazonMarketMeta(row: any): { endpoint: string; marketplaceId: string; defaultCountry: string } {
    const mkt = getMarketplace(row.channelType, row.marketplace);
    const endpoint = mkt?.meta?.endpoint;
    const marketplaceId = mkt?.meta?.marketplaceId;
    if (!mkt || !endpoint || !marketplaceId) throw new BadRequestException('This Amazon integration has no marketplace selected.');
    const defaultCountry = mkt.id === 'UK' ? 'GB' : mkt.id; // our ids are ISO codes except UK→GB
    return { endpoint, marketplaceId, defaultCountry };
  }

  /** SP-API GET with the LWA access token. Retries on 429 (rate limit) with backoff.
   *  SP-API no longer requires AWS SigV4 signing — the access token alone authorises. */
  private async amzFetch(url: string, token: string): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, { headers: { 'x-amz-access-token': token, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
      if (res.status !== 429 || attempt >= 3) return res;
      await sleep(2000 * 2 ** attempt); // 2s, 4s, 8s
    }
  }

  private async amzWrite(url: string, token: string, method: string, body: unknown): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, { method, headers: { 'x-amz-access-token': token, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
      if (res.status !== 429 || attempt >= 3) return res;
      await sleep(2000 * 2 ** attempt);
    }
  }

  /** Push a listing's available quantity to Amazon (FBM/MFN only) via the Listings Items PATCH.
   *  dryRun uses mode=VALIDATION_PREVIEW — a real API call that validates the write WITHOUT
   *  applying it, so the preview genuinely confirms the push would succeed. */
  async pushAmazonQuantity(integrationId: string, channelSku: string, quantity: number, dryRun = false): Promise<{ ok: boolean; message: string }> {
    const row = await this.prisma.channelIntegration.findFirst({ where: { id: integrationId, deletedAt: null } });
    if (!row) return { ok: false, message: 'Integration not found' };
    const config = (row.config ?? {}) as Record<string, string>;
    const sellerId = config.sellerId;
    if (!sellerId) return { ok: false, message: 'Amazon integration has no Seller ID' };
    const meta = this.amazonMarketMeta(row);
    const secrets = await this.decryptedSecrets(row.id);
    const token = await this.amazonAccessToken(config, secrets);
    const qty = Math.max(0, Math.trunc(quantity));

    // The PATCH requires the item's productType — fetch it from the listing summary.
    const getRes = await this.amzFetch(`${meta.endpoint}/listings/2021-08-01/items/${encodeURIComponent(sellerId)}/${encodeURIComponent(channelSku)}?marketplaceIds=${meta.marketplaceId}&includedData=summaries`, token);
    const getJson: any = await getRes.json().catch(() => null);
    if (!getRes.ok) return { ok: false, message: `getItem ${getRes.status}${IntegrationsService.amzErr(getJson) ? ': ' + IntegrationsService.amzErr(getJson) : ''}` };
    const productType = getJson?.summaries?.[0]?.productType;
    if (!productType) return { ok: false, message: 'Could not resolve productType' };

    const url = `${meta.endpoint}/listings/2021-08-01/items/${encodeURIComponent(sellerId)}/${encodeURIComponent(channelSku)}?marketplaceIds=${meta.marketplaceId}${dryRun ? '&mode=VALIDATION_PREVIEW' : ''}`;
    const body = { productType, patches: [{ op: 'replace', path: '/attributes/fulfillment_availability', value: [{ fulfillment_channel_code: 'DEFAULT', quantity: qty }] }] };
    const res = await this.amzWrite(url, token, 'PATCH', body);
    const json: any = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, message: `PATCH ${res.status}${IntegrationsService.amzErr(json) ? ': ' + IntegrationsService.amzErr(json) : ''}` };
    if (json?.status === 'INVALID') return { ok: false, message: (json?.issues?.[0]?.message ?? 'INVALID').toString().slice(0, 200) };
    return { ok: true, message: dryRun ? 'validated' : (json?.status ?? 'ACCEPTED') };
  }

  /** Push a listing's available quantity to OnBuy via the v2 stock-update endpoint
   *  (`PUT /listings/by-sku` by default; override with config.stockUpdatePath / stockUpdateMethod
   *  if an account differs). Body: `{ site_id, listings: [{ sku, stock }] }`. dryRun does not call
   *  OnBuy — it only confirms we can build the request. */
  async pushOnBuyQuantity(integrationId: string, channelSku: string, quantity: number, dryRun = false): Promise<{ ok: boolean; message: string }> {
    const row = await this.prisma.channelIntegration.findFirst({ where: { id: integrationId, deletedAt: null } });
    if (!row) return { ok: false, message: 'Integration not found' };
    const config = (row.config ?? {}) as Record<string, string>;
    const qty = Math.max(0, Math.trunc(quantity));
    const siteId = (config.siteIds || '').match(/\d+/)?.[0] ?? '2000'; // 2000 = OnBuy UK
    if (dryRun) return { ok: true, message: `validated (set SKU ${channelSku} → ${qty} on site ${siteId})` };

    const secrets = await this.decryptedSecrets(row.id);
    const { token, base } = await this.onbuyAccessToken(config, secrets);
    const path = config.stockUpdatePath || '/listings/by-sku';
    const res = await fetch(`${base}${path.startsWith('/') ? path : '/' + path}`, {
      method: (config.stockUpdateMethod || 'PUT').toUpperCase(),
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ site_id: Number(siteId), listings: [{ sku: channelSku, stock: qty }] }),
      signal: AbortSignal.timeout(15000),
    });
    const json: any = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, message: `OnBuy ${res.status}${json?.error?.message || json?.message ? ': ' + (json.error?.message || json.message) : ''}`.slice(0, 200) };
    // OnBuy returns per-SKU results; surface a per-SKU rejection even on a 200.
    const r0 = (json?.results ?? [])[0];
    if (r0 && r0.success === false) return { ok: false, message: (r0.errors?.[0]?.message || r0.message || 'OnBuy rejected the update').toString().slice(0, 200) };
    return { ok: true, message: `stock set to ${qty}` };
  }

  /** eBay Trading-API site id (X-EBAY-API-SITEID) keyed by our stored marketplace ISO. */
  private static readonly EBAY_ISO_SITEID: Record<string, string> = {
    US: '0', CA: '2', GB: '3', AU: '15', AT: '16', BE: '23', FR: '71', DE: '77', IT: '101',
    NL: '146', ES: '186', CH: '193', IE: '205', PL: '212',
  };
  private static xmlEscape(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }

  /** Push a listing's available quantity to eBay via the Trading-API ReviseInventoryStatus call.
   *  Targets the listing by SKU when it has one, else by the ItemID we encoded as `EBAY-<id>` at
   *  pull time. The OAuth user token goes in X-EBAY-API-IAF-TOKEN — this is a WRITE call, so the
   *  token must carry the sell.inventory scope; a read-only connection returns an auth error here
   *  (reconnect the eBay integration to grant write access). dryRun does not call eBay. */
  async pushEbayQuantity(integrationId: string, channelSku: string, marketplace: string | null, quantity: number, dryRun = false): Promise<{ ok: boolean; message: string }> {
    const row = await this.prisma.channelIntegration.findFirst({ where: { id: integrationId, deletedAt: null } });
    if (!row) return { ok: false, message: 'Integration not found' };
    const config = (row.config ?? {}) as Record<string, string>;
    const qty = Math.max(0, Math.trunc(quantity));
    const iso = (marketplace || '').toUpperCase();
    const siteId = IntegrationsService.EBAY_ISO_SITEID[iso] ?? (config.ebaySiteIds || '3').split(',')[0].trim();
    const m = /^EBAY-(\d+)$/i.exec(channelSku.trim());
    const targetXml = m ? `<ItemID>${m[1]}</ItemID>` : `<SKU>${IntegrationsService.xmlEscape(channelSku)}</SKU>`;
    if (dryRun) return { ok: true, message: `validated (revise ${m ? 'item ' + m[1] : 'SKU ' + channelSku} on site ${siteId})` };

    const secrets = await this.decryptedSecrets(row.id);
    const token = await this.ebayAccessToken(config, secrets);
    const base = config.env === 'sandbox' ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com';
    const body = `<?xml version="1.0" encoding="utf-8"?>\n<ReviseInventoryStatusRequest xmlns="urn:ebay:apis:eBLBaseComponents"><InventoryStatus>${targetXml}<Quantity>${qty}</Quantity></InventoryStatus></ReviseInventoryStatusRequest>`;
    const res = await fetch(`${base}/ws/api.dll`, {
      method: 'POST',
      headers: {
        'X-EBAY-API-CALL-NAME': 'ReviseInventoryStatus',
        'X-EBAY-API-SITEID': siteId,
        'X-EBAY-API-COMPATIBILITY-LEVEL': '1155',
        'X-EBAY-API-IAF-TOKEN': token,
        'Content-Type': 'text/xml',
      },
      body,
      signal: AbortSignal.timeout(20000),
    });
    const xml = await res.text();
    if (!res.ok) return { ok: false, message: `eBay ${res.status}` };
    const ack = /<Ack>([^<]+)<\/Ack>/.exec(xml)?.[1] ?? '';
    if (/Success|Warning/i.test(ack)) return { ok: true, message: `revised → ${qty}` };
    const err = /<(?:ShortMessage|LongMessage)>([\s\S]*?)<\/(?:ShortMessage|LongMessage)>/.exec(xml)?.[1] ?? 'unknown error';
    return { ok: false, message: (this.decodeXmlEntities(err) ?? 'error').slice(0, 200) };
  }

  private static amzErr(json: any): string {
    const e = json?.errors?.[0];
    return (e?.message || e?.code || '').toString().slice(0, 200);
  }

  /** Read-only pull of all Listings Items for one Amazon integration (SKU, ASIN, title, FBM
   *  quantity, offer price, listing status). Paginated via pageToken; capped to avoid runaway.
   *  Feeds the Channel Listings dashboard. */
  async fetchAmazonListings(integrationId: string, opts: { maxPages?: number } = {}): Promise<Array<{
    sku: string; asin: string | null; title: string | null; quantity: number | null;
    price: number | null; currency: string | null; fulfilmentChannel: 'FBM' | 'FBA' | null; status: string | null;
    marketplace: string | null;
  }>> {
    const row = await this.prisma.channelIntegration.findFirst({ where: { id: integrationId, deletedAt: null } });
    if (!row) throw new NotFoundException('Integration not found');
    const config = (row.config ?? {}) as Record<string, string>;
    const sellerId = config.sellerId;
    if (!sellerId) throw new BadRequestException('This Amazon integration has no Seller ID (merchant token) stored.');
    const meta = this.amazonMarketMeta(row);
    const secrets = await this.decryptedSecrets(row.id);
    const token = await this.amazonAccessToken(config, secrets);

    const out: any[] = [];
    const maxPages = opts.maxPages ?? 400;
    let pageToken: string | null = null;
    for (let page = 0; page < maxPages; page++) {
      const params = new URLSearchParams({ marketplaceIds: meta.marketplaceId, includedData: 'summaries,offers,fulfillmentAvailability', pageSize: '20' });
      if (pageToken) params.set('pageToken', pageToken);
      const res = await this.amzFetch(`${meta.endpoint}/listings/2021-08-01/items/${encodeURIComponent(sellerId)}?${params.toString()}`, token);
      const json: any = await res.json().catch(() => null);
      if (!res.ok) throw new BadRequestException(`Amazon listings fetch failed (${res.status}${IntegrationsService.amzErr(json) ? ': ' + IntegrationsService.amzErr(json) : ''}).`);
      for (const it of json?.items ?? []) {
        const summ = it.summaries?.[0] ?? {};
        const avail: any[] = it.fulfillmentAvailability ?? [];
        const merchant = avail.filter((a) => (a.fulfillmentChannelCode || 'DEFAULT') === 'DEFAULT');
        const isFbm = merchant.length > 0;
        const offer = (it.offers ?? [])[0] ?? null;
        out.push({
          sku: it.sku,
          asin: summ.asin ?? null,
          title: summ.itemName ?? null,
          quantity: isFbm ? merchant.reduce((s: number, a: any) => s + (a.quantity || 0), 0) : null,
          price: offer?.price?.amount != null ? Number(offer.price.amount) : null,
          currency: offer?.price?.currencyCode ?? null,
          fulfilmentChannel: isFbm ? 'FBM' : (avail.length ? 'FBA' : null),
          status: Array.isArray(summ.status) ? summ.status.join(',') : (summ.status ?? null),
          marketplace: null, // Amazon integration is already marketplace-specific → single column
        });
      }
      pageToken = json?.pagination?.nextToken ?? null;
      if (!pageToken) break;
    }
    return out;
  }

  /** Read-only pull of eBay listings via the Sell Inventory API (scope `sell.inventory.readonly`,
   *  already granted). Lists inventory items (SKU, title, quantity), then reads each SKU's offer
   *  for price + listing status. Feeds Channel Listings, same shape as fetchAmazonListings.
   *  NOTE: the Inventory API only surfaces listings MANAGED by the Inventory API — classic
   *  (Trading-API) listings may not all appear; if coverage is short we add GetMyeBaySelling. */
  async fetchEbayListings(integrationId: string, opts: { maxItems?: number } = {}): Promise<Array<{
    sku: string; asin: string | null; title: string | null; quantity: number | null;
    price: number | null; currency: string | null; fulfilmentChannel: 'FBM' | 'FBA' | null; status: string | null;
    marketplace: string | null;
  }>> {
    const row = await this.prisma.channelIntegration.findFirst({ where: { id: integrationId, deletedAt: null } });
    if (!row) throw new NotFoundException('Integration not found');
    const config = (row.config ?? {}) as Record<string, string>;
    const secrets = await this.decryptedSecrets(row.id);
    const token = await this.ebayAccessToken(config, secrets);
    const base = config.env === 'sandbox' ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com';
    // eBay's Sell Inventory API validates Accept-Language / Content-Language and 400s without a
    // valid value ("Invalid value for header Accept-Language."), so set them explicitly.
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Accept-Language': 'en-US',
      'Content-Language': 'en-US',
    };
    const maxItems = opts.maxItems ?? 8000; // sellers can have thousands of listings
    const limit = 100;

    // 1) Inventory items: SKU, title, quantity.
    const items: Array<{ sku: string; title: string | null; quantity: number | null }> = [];
    for (let offset = 0; offset < maxItems; offset += limit) {
      const res = await fetch(`${base}/sell/inventory/v1/inventory_item?limit=${limit}&offset=${offset}`, { headers, signal: AbortSignal.timeout(20000) });
      const json: any = await res.json().catch(() => null);
      if (!res.ok) throw new BadRequestException(`eBay inventory fetch failed (${res.status}${json?.errors?.[0]?.message ? ': ' + json.errors[0].message : ''}).`);
      for (const it of json?.inventoryItems ?? []) {
        items.push({ sku: it.sku, title: it.product?.title ?? null, quantity: it.availability?.shipToLocationAvailability?.quantity ?? null });
      }
      const total = Number(json?.total ?? 0);
      if (!json?.inventoryItems?.length || offset + limit >= total) break;
    }

    // Classic listings (created via the Trading API / the normal Sell flow) don't appear in the
    // Inventory API. If it returned nothing, fall back to GetMyeBaySelling which covers them all.
    if (items.length === 0) {
      return this.ebayTradingListings(base, token, config, maxItems);
    }

    // 2) Each SKU's offer → price, currency, listing status (getOffers is per-SKU).
    const out: any[] = [];
    for (const it of items) {
      let price: number | null = null, currency: string | null = null, status: string | null = null, marketplace: string | null = null;
      try {
        const res = await fetch(`${base}/sell/inventory/v1/offer?sku=${encodeURIComponent(it.sku)}`, { headers, signal: AbortSignal.timeout(15000) });
        const json: any = await res.json().catch(() => null);
        if (res.ok) {
          const offer = (json?.offers ?? [])[0] ?? null;
          const p = offer?.pricingSummary?.price;
          price = p?.value != null ? Number(p.value) : null;
          currency = p?.currency ?? null;
          status = offer?.status ?? offer?.listing?.listingStatus ?? null;
          marketplace = ebayMarketplaceToIso(offer?.marketplaceId ?? null);
        }
      } catch { /* leave price null on a per-SKU error */ }
      out.push({ sku: it.sku, asin: null, title: it.title, quantity: it.quantity, price, currency, fulfilmentChannel: null, status, marketplace });
    }
    return out;
  }

  /** eBay Trading API GetMyeBaySelling (ActiveList) — covers ALL active listings, including
   *  classic ones the Inventory API doesn't surface. XML in/out; the OAuth user token is passed
   *  via X-EBAY-API-IAF-TOKEN. Iterates the seller's sites (config.ebaySiteIds, default UK/AU/US)
   *  and dedupes by ItemID, so it's correct whether GetMyeBaySelling is account-wide or per-site. */
  private async ebayTradingListings(base: string, token: string, config: Record<string, string>, maxItems: number): Promise<Array<{
    sku: string; asin: string | null; title: string | null; quantity: number | null;
    price: number | null; currency: string | null; fulfilmentChannel: 'FBM' | 'FBA' | null; status: string | null;
    marketplace: string | null;
  }>> {
    const endpoint = `${base}/ws/api.dll`;
    // GetMyeBaySelling ActiveList is account-wide, so one site call returns every active listing
    // regardless of the site it's on — a single request avoids re-fetching thousands per extra
    // site. Override with config.ebaySiteIds (comma-separated) only if a site is genuinely missing.
    const siteIds = (config.ebaySiteIds || '3').split(',').map((s) => s.trim()).filter(Boolean); // 3=UK
    const seen = new Set<string>();
    const out: any[] = [];
    const pick = (block: string, re: RegExp) => re.exec(block)?.[1] ?? null;

    for (const siteId of siteIds) {
      for (let pageNum = 1; pageNum <= 50 && out.length < maxItems; pageNum++) {
        const body = `<?xml version="1.0" encoding="utf-8"?>\n<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ActiveList><Include>true</Include><Pagination><EntriesPerPage>200</EntriesPerPage><PageNumber>${pageNum}</PageNumber></Pagination></ActiveList></GetMyeBaySellingRequest>`;
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'X-EBAY-API-CALL-NAME': 'GetMyeBaySelling',
            'X-EBAY-API-SITEID': siteId,
            'X-EBAY-API-COMPATIBILITY-LEVEL': '1155',
            'X-EBAY-API-IAF-TOKEN': token,
            'Content-Type': 'text/xml',
          },
          body,
          signal: AbortSignal.timeout(25000),
        });
        const xml = await res.text();
        if (!res.ok) throw new BadRequestException(`eBay Trading API failed (${res.status}).`);
        const ack = /<Ack>([^<]+)<\/Ack>/.exec(xml)?.[1] ?? '';
        if (/Failure/i.test(ack)) {
          const err = /<(?:ShortMessage|LongMessage)>([\s\S]*?)<\/(?:ShortMessage|LongMessage)>/.exec(xml)?.[1] ?? 'unknown error';
          throw new BadRequestException(`eBay Trading API error (site ${siteId}): ${this.decodeXmlEntities(err)}`.slice(0, 250));
        }
        const activeList = /<ActiveList>[\s\S]*?<\/ActiveList>/.exec(xml)?.[0] ?? '';
        const blocks = activeList.match(/<Item>[\s\S]*?<\/Item>/g) ?? [];
        for (const b of blocks) {
          const itemId = pick(b, /<ItemID>([^<]+)<\/ItemID>/);
          if (!itemId || seen.has(itemId)) continue;
          seen.add(itemId);
          const rawSku = pick(b, /<SKU>([\s\S]*?)<\/SKU>/);
          const priceM = /<CurrentPrice[^>]*currencyID="([^"]+)"[^>]*>([\d.]+)<\/CurrentPrice>/.exec(b);
          const qty = pick(b, /<QuantityAvailable>(\d+)<\/QuantityAvailable>/);
          const currency = priceM ? priceM[1] : null;
          // GetMyeBaySelling omits <Site> by default, so resolve the marketplace from the item URL
          // domain (ebay.co.uk → GB, ebay.de → DE…) or, failing that, the listing currency
          // (GBP → GB, AUD → AU…). EUR is ambiguous so the URL is the reliable signal there.
          const marketplace =
            IntegrationsService.ebaySiteNameToIso(pick(b, /<Site>([^<]+)<\/Site>/))
            ?? IntegrationsService.ebayUrlToIso(pick(b, /<ViewItemURL>([\s\S]*?)<\/ViewItemURL>/))
            ?? IntegrationsService.ebayCurrencyToIso(currency);
          out.push({
            sku: (rawSku && rawSku.trim()) || `EBAY-${itemId}`,
            asin: null,
            title: this.decodeXmlEntities(pick(b, /<Title>([\s\S]*?)<\/Title>/)),
            quantity: qty != null ? Number(qty) : null,
            price: priceM ? Number(priceM[2]) : null,
            currency,
            fulfilmentChannel: null,
            status: pick(b, /<ListingStatus>([^<]+)<\/ListingStatus>/),
            marketplace,
          });
        }
        const totalPages = Number(/<TotalNumberOfPages>(\d+)<\/TotalNumberOfPages>/.exec(activeList)?.[1] ?? '1');
        if (blocks.length === 0 || pageNum >= totalPages) break;
      }
    }
    return out;
  }

  /** Minimal XML entity decode for Trading-API text values. `&amp;` last to avoid double-decode. */
  private decodeXmlEntities(s: string | null): string | null {
    if (s == null) return null;
    return s
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
      .replace(/&amp;/g, '&');
  }

  /** eBay Trading `Site` name (e.g. "UK", "US", "Australia") → ISO-2 country, for per-market columns. */
  private static readonly EBAY_SITE_ISO: Record<string, string> = {
    us: 'US', ebaymotors: 'US', uk: 'GB', 'ebay uk': 'GB', australia: 'AU', austria: 'AT',
    belgiumdutch: 'BE', belgiumfrench: 'BE', canada: 'CA', canadafrench: 'CA', switzerland: 'CH',
    germany: 'DE', spain: 'ES', france: 'FR', ireland: 'IE', italy: 'IT', netherlands: 'NL',
    poland: 'PL', hongkong: 'HK', singapore: 'SG', malaysia: 'MY', philippines: 'PH', india: 'IN',
  };
  static ebaySiteNameToIso(site: string | null): string | null {
    if (!site) return null;
    const key = site.trim().toLowerCase();
    return IntegrationsService.EBAY_SITE_ISO[key] ?? (/^[a-z]{2}$/.test(key) ? key.toUpperCase() : null);
  }

  /** eBay item URL domain → ISO. Order matters: match longer/compound TLDs before `.com`. */
  static ebayUrlToIso(url: string | null): string | null {
    if (!url) return null;
    const u = url.toLowerCase();
    const map: Array<[RegExp, string]> = [
      [/ebay\.co\.uk/, 'GB'], [/ebay\.com\.au/, 'AU'], [/ebay\.ca/, 'CA'], [/ebay\.de/, 'DE'],
      [/ebay\.fr/, 'FR'], [/ebay\.it/, 'IT'], [/ebay\.es/, 'ES'], [/ebay\.ie/, 'IE'], [/ebay\.nl/, 'NL'],
      [/ebay\.at/, 'AT'], [/ebay\.ch/, 'CH'], [/ebay\.be/, 'BE'], [/ebay\.pl/, 'PL'], [/ebay\.com/, 'US'],
    ];
    for (const [re, iso] of map) if (re.test(u)) return iso;
    return null;
  }

  /** Listing currency → ISO for the marketplaces with a distinct currency (EUR is ambiguous → null). */
  private static readonly EBAY_CCY_ISO: Record<string, string> = {
    GBP: 'GB', USD: 'US', AUD: 'AU', CAD: 'CA', CHF: 'CH', PLN: 'PL', SEK: 'SE',
    HKD: 'HK', SGD: 'SG', MYR: 'MY', PHP: 'PH', INR: 'IN', JPY: 'JP',
  };
  static ebayCurrencyToIso(ccy: string | null): string | null {
    if (!ccy) return null;
    return IntegrationsService.EBAY_CCY_ISO[ccy.toUpperCase()] ?? null;
  }

  /** Read-only pull of OnBuy listings (SKU, price, stock, status) for the seller's site.
   *  Feeds Channel Listings, same shape as fetchAmazonListings. Field names are parsed
   *  defensively — verify against a real pull, as OnBuy's listing schema varies by account. */
  async fetchOnBuyListings(integrationId: string, opts: { maxItems?: number } = {}): Promise<Array<{
    sku: string; asin: string | null; title: string | null; quantity: number | null;
    price: number | null; currency: string | null; fulfilmentChannel: 'FBM' | 'FBA' | null; status: string | null;
    marketplace: string | null;
  }>> {
    const row = await this.prisma.channelIntegration.findFirst({ where: { id: integrationId, deletedAt: null } });
    if (!row) throw new NotFoundException('Integration not found');
    const config = (row.config ?? {}) as Record<string, string>;
    const secrets = await this.decryptedSecrets(row.id);
    const { token, base } = await this.onbuyAccessToken(config, secrets);
    const siteId = (config.siteIds || '').match(/\d+/)?.[0] ?? null;
    const maxItems = opts.maxItems ?? 2000;
    const limit = 100;

    const out: any[] = [];
    for (let offset = 0; offset < maxItems; offset += limit) {
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      if (siteId) params.set('site_id', siteId);
      const res = await fetch(`${base}/listings?${params.toString()}`, { headers: { Authorization: token }, signal: AbortSignal.timeout(15000) });
      const json: any = await res.json().catch(() => null);
      if (!res.ok) throw new BadRequestException(`OnBuy listings fetch failed (${res.status}${json?.error?.message || json?.message ? ': ' + (json.error?.message || json.message) : ''}).`);
      const results: any[] = json?.results ?? (Array.isArray(json) ? json : []);
      for (const l of results) {
        out.push({
          sku: l.sku ?? l.seller_sku ?? l.merchant_sku ?? null,
          asin: null,
          title: l.product_name ?? l.name ?? l.product?.name ?? l.title ?? null,
          quantity: l.stock ?? l.quantity ?? l.stock_level ?? null,
          price: l.price != null ? Number(l.price) : (l.unit_price != null ? Number(l.unit_price) : null),
          currency: 'GBP', // OnBuy is a GB marketplace
          fulfilmentChannel: null,
          status: (l.status ?? l.listing_status ?? null)?.toString() ?? null,
          marketplace: null, // OnBuy is single-marketplace → single column
        });
      }
      const total = Number(json?.metadata?.total_rows ?? json?.total ?? 0);
      if (!results.length || offset + limit >= total) break;
    }
    return out.filter((x) => x.sku);
  }

  /** One page of orders. When paging with NextToken, SP-API forbids other filters. */
  private async amazonGetOrdersPage(endpoint: string, token: string, marketplaceId: string, opts: { createdAfter?: string; createdBefore?: string; lastUpdatedAfter?: string; nextToken?: string | null }): Promise<{ ok: boolean; status?: number; message?: string; orders: any[]; nextToken: string | null }> {
    const params = new URLSearchParams({ MarketplaceIds: marketplaceId });
    if (opts.nextToken) {
      params.set('NextToken', opts.nextToken);
    } else {
      if (opts.createdAfter) params.set('CreatedAfter', opts.createdAfter);
      if (opts.createdBefore) params.set('CreatedBefore', opts.createdBefore);
      if (opts.lastUpdatedAfter) params.set('LastUpdatedAfter', opts.lastUpdatedAfter);
    }
    const res = await this.amzFetch(`${endpoint}/orders/v0/orders?${params.toString()}`, token);
    const json: any = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, status: res.status, message: IntegrationsService.amzErr(json), orders: [], nextToken: null };
    const p = json?.payload ?? {};
    return { ok: true, orders: p.Orders ?? [], nextToken: p.NextToken ?? null };
  }

  /** All line items for one order (paginated via its own NextToken). */
  private async amazonGetOrderItems(endpoint: string, token: string, orderId: string): Promise<any[]> {
    const items: any[] = [];
    let nextToken: string | null = null;
    do {
      const qs = nextToken ? `?NextToken=${encodeURIComponent(nextToken)}` : '';
      const res = await this.amzFetch(`${endpoint}/orders/v0/orders/${encodeURIComponent(orderId)}/orderItems${qs}`, token);
      const json: any = await res.json().catch(() => null);
      if (!res.ok) throw new Error(`getOrderItems ${res.status}: ${IntegrationsService.amzErr(json)}`);
      const p = json?.payload ?? {};
      items.push(...(p.OrderItems ?? []));
      nextToken = p.NextToken ?? null;
    } while (nextToken);
    return items;
  }

  /** Best-effort per-order Amazon fees from the Finances API, keyed by SellerSKU and
   *  split into referral/selling fees vs FBA fulfilment fees (FeeType starting "FBA").
   *  Returns empty when the app lacks Finances access or the fees haven't posted yet —
   *  fee data lags the sale by Amazon's settlement schedule. */
  private async fetchAmazonOrderFees(endpoint: string, token: string, orderId: string): Promise<AmazonFees> {
    const sales: FeeBucket = { bySku: new Map(), total: 0 };
    const fba: FeeBucket = { bySku: new Map(), total: 0 };
    try {
      const res = await this.amzFetch(`${endpoint}/finances/v0/orders/${encodeURIComponent(orderId)}/financialEvents`, token);
      const json: any = await res.json().catch(() => null);
      if (!res.ok) { this.logger.warn(`Amazon finances ${res.status} for ${orderId}: ${IntegrationsService.amzErr(json)}`); return { sales, fba }; }
      const events = json?.payload?.FinancialEvents ?? {};
      // Fees sit in each shipment item's ItemFeeList, reported as negatives — sum
      // magnitudes. FBA fulfilment fees have FeeType starting "FBA" (FBAPerUnitFulfillmentFee,
      // FBAWeightBasedFee, …); everything else (Commission, closing fees) is the selling fee.
      // NB: the Finances API Currency shape is { CurrencyCode, CurrencyAmount }, unlike the
      // Orders API which uses { CurrencyCode, Amount }.
      const amt = (m: any) => num(m?.CurrencyAmount ?? m?.Amount);
      const add = (bucket: FeeBucket, sku: string, v: number) => { bucket.bySku.set(sku, round2((bucket.bySku.get(sku) ?? 0) + v)); bucket.total = round2(bucket.total + v); };
      // Marketplace-facilitator tax lines (AU GST / JP consumption tax / US sales tax on the sale,
      // and any tax Amazon charges on its own fees) show up in ItemFeeList but are a pass-through
      // Amazon collects & remits — NOT a selling fee. Counting them overstated the AU fee (e.g.
      // 85.23 instead of the 63.60 referral). Exclude any tax/facilitator fee type.
      const isTaxLine = (type: string) => /tax|facilitator|gst|\bvat\b/i.test(type);
      const breakdown: Record<string, number> = {};
      for (const ev of events.ShipmentEventList ?? []) {
        for (const item of ev.ShipmentItemList ?? []) {
          const sku = item.SellerSKU ?? '';
          for (const f of item.ItemFeeList ?? []) {
            const type = String(f?.FeeType ?? '');
            const v = Math.abs(amt(f?.FeeAmount));
            if (v <= 0) continue;
            breakdown[type] = round2((breakdown[type] ?? 0) + v);
            if (type.startsWith('FBA')) { add(fba, sku, v); continue; }
            if (isTaxLine(type)) continue; // pass-through tax, not a seller fee
            add(sales, sku, v);
          }
        }
      }
      if (Object.keys(breakdown).length) this.logger.log(`Amazon fee breakdown ${orderId}: ${JSON.stringify(breakdown)} → selling ${sales.total}, fba ${fba.total}`);
    } catch (e: any) {
      this.logger.warn(`Amazon finances fetch failed for ${orderId}: ${e?.message ?? e}`);
    }
    return { sales, fba };
  }

  /**
   * Refunds posted in a window, from the range-level Finances API, keyed by AmazonOrderId.
   *
   * Uses `/finances/v0/financialEvents?PostedAfter=…` rather than the per-order endpoint because
   * a refund can post days after the sale WITHOUT moving the order's LastUpdatedDate — so an
   * order-driven re-fetch would miss it. This pass finds every refund event directly.
   *
   * Per order we sum the ex-VAT revenue returned to the buyer (Principal + ShippingCharge
   * adjustments — the Finances API reports these already ex-tax, Tax being its own charge type)
   * and note whether the referral fee was credited back (a net-positive fee adjustment).
   */
  private async fetchAmazonRefunds(endpoint: string, token: string, postedAfter: Date): Promise<Map<string, { refundedExVat: number; currency: string | null; feeReturned: boolean }>> {
    const out = new Map<string, { refundedExVat: number; currency: string | null; feeReturned: boolean }>();
    const amt = (m: any) => num(m?.CurrencyAmount ?? m?.Amount);
    const REVENUE_CHARGES = new Set(['Principal', 'ShippingCharge']);
    const MAX_PAGES = 50;
    let nextToken: string | null = null;
    try {
      for (let page = 0; page < MAX_PAGES; page++) {
        const url = nextToken
          ? `${endpoint}/finances/v0/financialEvents?NextToken=${encodeURIComponent(nextToken)}`
          : `${endpoint}/finances/v0/financialEvents?PostedAfter=${encodeURIComponent(postedAfter.toISOString())}&MaxResultsPerPage=100`;
        const res = await this.amzFetch(url, token);
        const json: any = await res.json().catch(() => null);
        if (!res.ok) { this.logger.warn(`Amazon finances range ${res.status}: ${IntegrationsService.amzErr(json)}`); break; }
        const events = json?.payload?.FinancialEvents ?? {};
        for (const rev of events.RefundEventList ?? []) {
          const orderId = rev.AmazonOrderId;
          if (!orderId) continue;
          const acc = out.get(orderId) ?? { refundedExVat: 0, currency: null as string | null, feeReturned: false };
          for (const adj of rev.ShipmentItemAdjustmentList ?? []) {
            for (const c of adj.ItemChargeAdjustmentList ?? []) {
              if (!REVENUE_CHARGES.has(String(c?.ChargeType ?? ''))) continue;
              acc.refundedExVat += Math.abs(amt(c?.ChargeAmount)); // charges are negative (money back)
              acc.currency = acc.currency ?? c?.ChargeAmount?.CurrencyCode ?? null;
            }
            // A net-positive fee adjustment = the referral fee credited back to us.
            const netFee = (adj.ItemFeeAdjustmentList ?? []).reduce((s: number, f: any) => s + amt(f?.FeeAmount), 0);
            if (netFee > 0) acc.feeReturned = true;
          }
          acc.refundedExVat = round2(acc.refundedExVat);
          out.set(orderId, acc);
        }
        nextToken = events?.NextToken ?? json?.payload?.NextToken ?? null;
        if (!nextToken) break;
      }
    } catch (e: any) {
      this.logger.warn(`Amazon refund fetch failed: ${e?.message ?? e}`);
    }
    return out;
  }

  /** Overlay one fee bucket onto the mapped order's items (per SellerSKU; any order-level
   *  remainder to line 1), writing `field` in both the importer payload and the review row. */
  private applyFeeBucket(mapped: MappedOrder, bucket: FeeBucket, field: 'salesChannelSalesFeeAmount' | 'fbaFulfilmentFeeAmount'): void {
    if (mapped.items.length === 0) return;
    let attributed = 0;
    for (const it of mapped.items) {
      const fee = bucket.bySku.get(it.sku ?? '') ?? 0;
      it.payload[field] = fee;
      const f = it.fields.find((x) => x.target === field);
      if (f) f.value = fee;
      attributed = round2(attributed + fee);
    }
    const remainder = round2(bucket.total - attributed);
    if (remainder > 0) {
      const first = mapped.items[0];
      first.payload[field] = round2(first.payload[field] + remainder);
      const f = first.fields.find((x) => x.target === field);
      if (f) f.value = first.payload[field];
    }
  }

  /** Overlay Finances-API fees (referral + FBA) onto a mapped Amazon order. */
  private applyAmazonFees(mapped: MappedOrder, fees: AmazonFees): void {
    this.applyFeeBucket(mapped, fees.sales, 'salesChannelSalesFeeAmount');
    this.applyFeeBucket(mapped, fees.fba, 'fbaFulfilmentFeeAmount');
  }

  /** Refresh fees for recently-imported Amazon drafts whose fees hadn't posted at
   *  import time. Amazon posts financial events on its settlement cycle (up to ~2
   *  weeks after the sale), and a shipped order's LastUpdatedDate may not change when
   *  they post — so each sync re-checks zero-fee drafts from the trailing window and
   *  fills them once available. Updates item fees directly (fee doesn't affect FX/VAT;
   *  profit is computed on read). Returns how many transactions were filled. */
  private async refreshRecentAmazonFees(row: any, endpoint: string, token: string, sinceDays: number): Promise<number> {
    const since = new Date(Date.now() - sinceDays * 24 * 3600 * 1000);
    // Any status (not just draft): FBA orders import as 'submitted', and their fees still post
    // later on Amazon's settlement cycle. Fees are written directly on the item rows, which
    // bypasses the submitted-edit lock, so this safely refreshes submitted orders too.
    const txs = await this.prisma.salesTransaction.findMany({
      where: { integrationId: row.id, deletedAt: null, date: { gte: since } },
      select: { id: true, transactionRef: true, items: { where: { deletedAt: null }, select: { id: true, sku: true, salesChannelSalesFeeAmount: true, fbaFulfilmentFeeAmount: true } } },
      take: 1000,
    });
    // Attribute a bucket across the tx's items (per SKU; remainder to line 1), returning per-item amounts.
    const spread = (items: { id: string; sku: string }[], bucket: FeeBucket) => {
      let attributed = 0;
      const out = items.map((it) => { const v = bucket.bySku.get(it.sku ?? '') ?? 0; attributed = round2(attributed + v); return { id: it.id, value: v }; });
      const remainder = round2(bucket.total - attributed);
      if (remainder > 0 && out.length) out[0].value = round2(out[0].value + remainder);
      return out;
    };
    let updated = 0;
    for (const tx of txs) {
      const currentFee = tx.items.reduce((s, it) => s + num(it.salesChannelSalesFeeAmount) + num(it.fbaFulfilmentFeeAmount), 0);
      if (currentFee > 0) continue; // already has fees
      const fees = await this.fetchAmazonOrderFees(endpoint, token, tx.transactionRef);
      await sleep(300);
      if (fees.sales.total <= 0 && fees.fba.total <= 0) continue; // still not posted at Amazon
      const salesUps = new Map(spread(tx.items, fees.sales).map((u) => [u.id, u.value]));
      const fbaUps = new Map(spread(tx.items, fees.fba).map((u) => [u.id, u.value]));
      await this.prisma.$transaction(tx.items.map((it) =>
        this.prisma.salesTransactionItem.update({ where: { id: it.id }, data: { salesChannelSalesFeeAmount: salesUps.get(it.id) ?? 0, fbaFulfilmentFeeAmount: fbaUps.get(it.id) ?? 0 } }),
      ));
      updated++;
    }
    return updated;
  }

  /** Fetch recent Amazon orders (read-only), mapped with fees. Shared by preview + mapping. */
  private async fetchAmazonOrders(row: any, limit: number): Promise<{ ok: boolean; status?: number; message?: string; total: number; mapped: MappedOrder[] }> {
    const config = (row.config ?? {}) as Record<string, string>;
    const secrets = await this.decryptedSecrets(row.id);
    const { endpoint, marketplaceId, defaultCountry } = this.amazonMarketMeta(row);
    const token = await this.amazonAccessToken(config, secrets);
    const createdAfter = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const page = await this.amazonGetOrdersPage(endpoint, token, marketplaceId, { createdAfter });
    if (!page.ok) return { ok: false, status: page.status, message: page.message, total: 0, mapped: [] };
    // Exclude Multi-Channel Fulfillment orders (SalesChannel="Non-Amazon") — not Amazon sales.
    const sellable = page.orders.filter((o) => String(o.SalesChannel ?? '') !== 'Non-Amazon');
    const slice = sellable.slice(0, limit);
    const mapped: MappedOrder[] = [];
    for (const o of slice) {
      const items = await this.amazonGetOrderItems(endpoint, token, o.AmazonOrderId);
      const order = mapAmazonOrder(o, items, defaultCountry);
      this.applyAmazonFees(order, await this.fetchAmazonOrderFees(endpoint, token, o.AmazonOrderId));
      mapped.push(order);
      await sleep(300); // stay under the getOrderItems / finances rate limits
    }
    return { ok: true, total: sellable.length, mapped };
  }

  // --- Order preview / mapping ----------------------------------------------

  /** Read-only: fetch a few recent orders to validate the connection. */
  async previewOrders(id: string, actorId?: string, limit = 5) {
    const row = await this.prisma.channelIntegration.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException('Integration not found');
    if (row.channelType === 'amazon') {
      const r = await this.fetchAmazonOrders(row, limit);
      await this.audit(id, actorId, 'preview', `amazon status=${r.status ?? 200}`);
      return r.ok ? { ok: true, mode: 'live', total: r.total, count: r.mapped.length, orders: r.mapped.map((m) => m.raw) } : { ok: false, mode: 'live', status: r.status, message: r.message };
    }
    if (row.channelType === 'ebay') {
      const r = await this.fetchEbayOrders(row, limit);
      await this.audit(id, actorId, 'preview', `ebay status=${r.status ?? 200}`);
      return r.ok ? { ok: true, mode: 'live', total: r.total, count: r.mapped.length, orders: r.mapped.map((m) => m.raw) } : { ok: false, mode: 'live', status: r.status, message: r.message };
    }
    if (row.channelType !== 'onbuy') throw new BadRequestException('Order preview supports OnBuy, Amazon and eBay only.');
    const r = await this.fetchOnBuyOrders(row, limit);
    await this.audit(id, actorId, 'preview', `mode=${r.mode} status=${r.status ?? 200}`);
    return r.ok ? { ok: true, mode: r.mode, siteId: r.siteId, total: r.total, count: r.orders.length, orders: r.orders } : { ok: false, mode: r.mode, status: r.status, message: r.message };
  }

  /** Read-only listings preview: fetch a few live listings and return the mapped rows WITHOUT
   *  writing to Channel Listings — lets the operator confirm the pull (esp. OnBuy field mapping)
   *  before a real sync. */
  async previewListings(id: string, actorId?: string, limit = 10) {
    const row = await this.prisma.channelIntegration.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException('Integration not found');
    const type = row.channelType;
    if (!['amazon', 'ebay', 'onbuy'].includes(type)) throw new BadRequestException('Listings preview supports Amazon, eBay and OnBuy only.');
    try {
      const listings =
        type === 'amazon' ? await this.fetchAmazonListings(id, { maxPages: 1 })
        : type === 'ebay' ? await this.fetchEbayListings(id, { maxItems: limit })
        : await this.fetchOnBuyListings(id, { maxItems: limit });
      await this.audit(id, actorId, 'listings.preview', `${type} count=${listings.length}`);
      return { ok: true, channelType: type, count: listings.length, listings: listings.slice(0, limit) };
    } catch (e: any) {
      await this.audit(id, actorId, 'listings.preview', `${type} error`);
      return { ok: false, channelType: type, message: (e?.message ?? 'failed').toString().slice(0, 200) };
    }
  }

  /** First-run mapping verification: fetch sample orders, apply the mapping, and
   *  return target ← source = value for each field so the user can confirm it. */
  async previewMapping(id: string, actorId?: string, limit = 3) {
    const row = await this.prisma.channelIntegration.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException('Integration not found');

    // Fetch + map sample orders per connector; both yield the shared MappedOrder shape.
    let mode = 'live';
    let mapped: MappedOrder[];
    if (row.channelType === 'amazon') {
      const r = await this.fetchAmazonOrders(row, limit);
      await this.audit(id, actorId, 'mapping.preview', `amazon status=${r.status ?? 200}`);
      if (!r.ok) return { ok: false, mode, status: r.status, message: r.message };
      mapped = r.mapped;
    } else if (row.channelType === 'onbuy') {
      const r = await this.fetchOnBuyOrders(row, limit);
      await this.audit(id, actorId, 'mapping.preview', `mode=${r.mode} status=${r.status ?? 200}`);
      if (!r.ok) return { ok: false, mode: r.mode, status: r.status, message: r.message };
      mode = r.mode;
      mapped = r.orders.map((o) => mapOnBuyOrder(o));
    } else if (row.channelType === 'ebay') {
      const r = await this.fetchEbayOrders(row, limit);
      await this.audit(id, actorId, 'mapping.preview', `ebay status=${r.status ?? 200}`);
      if (!r.ok) return { ok: false, mode, status: r.status, message: r.message };
      mapped = r.mapped;
    } else {
      throw new BadRequestException('Mapping preview supports OnBuy, Amazon and eBay only.');
    }

    // Resolve destination country codes to names for the review.
    const codes = [...new Set(mapped.map((m) => m.payload.destinationCountryCode).filter(Boolean) as string[])];
    const countries = codes.length ? await this.prisma.country.findMany({ where: { isoCode: { in: codes } }, select: { isoCode: true, name: true } }) : [];
    const nameByCode = new Map(countries.map((c) => [c.isoCode, c.name]));
    for (const m of mapped) {
      const dest = m.header.find((f) => f.target === 'destinationCountry');
      if (dest && dest.value) dest.resolved = nameByCode.get(String(dest.value)) ?? null;
    }
    return {
      ok: true,
      mode,
      verifiedAt: row.mappingVerifiedAt ?? null,
      target: 'Sales transaction',
      samples: mapped.map((m) => ({ orderId: m.orderId, header: m.header, items: m.items.map((it) => ({ sku: it.sku, fields: it.fields })), raw: m.raw })),
    };
  }

  /** Record that the user reviewed & confirmed the field mapping (import gate). */
  async verifyMapping(id: string, confirmed: boolean, actorId?: string) {
    const row = await this.prisma.channelIntegration.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!row) throw new NotFoundException('Integration not found');
    await this.prisma.channelIntegration.update({ where: { id }, data: { mappingVerifiedAt: confirmed ? new Date() : null } });
    await this.audit(id, actorId, confirmed ? 'mapping.verify' : 'mapping.unverify');
    return this.get(id);
  }

  // --- Order import ---------------------------------------------------------

  /** Match an incoming SKU to a product (main SKU, then alias), case-insensitively. */
  private async resolveProductId(sku: string | null): Promise<string | null> {
    const s = (sku ?? '').trim();
    if (!s) return null;
    const p = await this.prisma.product.findFirst({ where: { deletedAt: null, mainSku: { equals: s, mode: 'insensitive' } }, select: { id: true } });
    if (p) return p.id;
    const a = await this.prisma.productSkuAlias.findFirst({ where: { deletedAt: null, skuValue: { equals: s, mode: 'insensitive' } }, select: { productId: true } });
    return a?.productId ?? null;
  }

  /** Re-resolve product links for this integration's still-unlinked items. Handles the
   *  case where a product / SKU alias was added AFTER an order was imported (a shipped
   *  order isn't re-pulled, so it would otherwise never link). Cheap: distinct SKUs only. */
  private async relinkUnlinkedItems(integrationId: string): Promise<number> {
    const unlinked = await this.prisma.salesTransactionItem.findMany({
      where: { productId: null, deletedAt: null, transaction: { integrationId, deletedAt: null } },
      select: { id: true, sku: true },
      take: 2000,
    });
    if (!unlinked.length) return 0;
    const cache = new Map<string, string | null>();
    let relinked = 0;
    for (const it of unlinked) {
      const key = (it.sku ?? '').trim().toLowerCase();
      if (!key) continue;
      if (!cache.has(key)) cache.set(key, await this.resolveProductId(it.sku));
      const pid = cache.get(key);
      if (pid) { await this.prisma.salesTransactionItem.update({ where: { id: it.id }, data: { productId: pid } }); relinked++; }
    }
    return relinked;
  }

  /** Build + upsert one sales transaction from a mapped order. Deduped by
   *  (integration, transactionRef): updates the existing draft, else creates one.
   *  Returns true when a row was written, so the caller can advance the high-water
   *  mark. Never touches manually-entered transactions (they have no integrationId). */
  private async importMappedOrder(row: any, mapped: MappedOrder, orderDate: Date, sysUser: any, actorId: string | undefined, counts: { created: number; updated: number; errors: number }, salesChannelIdOverride?: string | null): Promise<boolean> {
    const destCountry = mapped.payload.destinationCountryCode
      ? await this.prisma.country.findFirst({ where: { deletedAt: null, isoCode: mapped.payload.destinationCountryCode }, select: { id: true } })
      : null;
    const items = await Promise.all(mapped.items.map(async (it) => ({ ...it.payload, productId: await this.resolveProductId(it.sku) })));
    const dto: any = {
      date: orderDate.toISOString(),
      transactionRef: mapped.payload.transactionRef,
      salesChannelId: salesChannelIdOverride ?? row.targetSalesChannelId,
      destinationCountryId: destCountry?.id ?? null,
      companyId: row.targetCompanyId,
      // FBA orders are fulfilled by the channel with no action needed from us, so they're
      // imported as 'submitted' (finalised). Everything else imports as an editable draft.
      status: mapped.payload.fulfilmentType === 'FBA' ? 'submitted' : 'draft',
      // Platform shipment status is derived from shipment registration, not the channel.
      // Store the channel-reported status separately (for future mismatch alarms).
      channelShipmentStatus: mapped.payload.channelShipmentStatus,
      // Only Amazon can be FBA; anything without an explicit type is FBM.
      fulfilmentType: mapped.payload.fulfilmentType ?? 'FBM',
      source: row.channelType,
      integrationId: row.id,
      items,
    };
    try {
      const existing = await this.prisma.salesTransaction.findFirst({ where: { integrationId: row.id, transactionRef: dto.transactionRef, deletedAt: null }, select: { id: true } });
      if (existing) { await this.salesTx.update(existing.id, dto, sysUser); counts.updated++; }
      else { await this.salesTx.create(dto, actorId); counts.created++; }
      return true;
    } catch (e: any) {
      counts.errors++;
      this.logger.warn(`Import failed for order ${dto.transactionRef}: ${e?.message ?? e}`);
      return false;
    }
  }

  /** Import channel orders into sales transactions. Incremental after the first
   *  run; imports as drafts, deduped by (integration + order id), never touching
   *  manual entries. Gated on a verified mapping + active status + configured target. */
  async syncOrders(id: string, trigger: 'manual' | 'schedule', actorId?: string, range?: { from?: string; to?: string }) {
    const row = await this.prisma.channelIntegration.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException('Integration not found');
    if (!['onbuy', 'amazon', 'ebay'].includes(row.channelType)) throw new BadRequestException('Order import supports OnBuy, Amazon and eBay only.');
    if (row.status !== 'active') throw new BadRequestException('Integration is disabled.');
    if (!row.mappingVerifiedAt) throw new BadRequestException('Confirm the field mapping before importing.');
    if (!row.targetSalesChannelId || !row.targetCompanyId) throw new BadRequestException('Set the target sales channel and company in the integration settings first.');

    // An explicit range = a backdated pull (e.g. all of 2026). Otherwise: first
    // run backfills `backfillDays`; later runs pull since the last imported order
    // date, minus a small buffer to catch updates.
    const isRange = !!range?.from;
    const cutoff = isRange
      ? new Date(range!.from!)
      : row.lastSyncedAt
        ? new Date(row.lastSyncedAt.getTime() - 36 * 3600 * 1000)
        : new Date(Date.now() - (row.backfillDays ?? 30) * 24 * 3600 * 1000);
    const upper = isRange ? (range!.to ? new Date(new Date(range!.to).setHours(23, 59, 59, 999)) : new Date()) : null;

    const counts = { scanned: 0, created: 0, updated: 0, skipped: 0, cancelled: 0, cancelledUpdated: 0, cancelledImported: 0, refunded: 0, errors: 0 };
    // Gate for applying pulled cancellations/refunds. Off keeps the sync at its pre-feature
    // behaviour (cancels skipped, refunds not applied) so it stays dormant on live until enabled.
    const applyResolutions = (await this.prisma.platformSettings.findFirst({ select: { applyChannelResolutions: true } }))?.applyChannelResolutions ?? false;
    let maxDate = row.lastSyncedAt ?? null; // never regresses the high-water mark
    const advance = (d: Date) => { if (!maxDate || d > maxDate) maxDate = d; };
    const sysUser = { sub: actorId ?? 'system', email: 'system', isAdmin: true } as any;
    let note = '';
    let feesRefreshed = 0;
    let mcfSkipped = 0;

    try {
      if (row.channelType === 'onbuy') {
        // OnBuy date filter format: 'YYYY-MM-DD HH:MM:SS'.
        const fmt = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');
        const dateFrom = isRange ? `${range!.from} 00:00:00` : fmt(cutoff);
        const dateTo = isRange && range!.to ? `${range!.to} 23:59:59` : undefined;
        const config = (row.config ?? {}) as Record<string, string>;
        const secrets = await this.decryptedSecrets(row.id);
        const { token, base } = await this.onbuyAccessToken(config, secrets);
        const siteId = (config.siteIds || '').match(/\d+/)?.[0] ?? null;
        const LIMIT = 100;
        const MAX_PAGES = 100; // date-filtered + sorted desc; stop early on a partial page

        for (let pageNo = 0; pageNo < MAX_PAGES; pageNo++) {
          const page = await this.onbuyOrdersPage(base, token, siteId, LIMIT, pageNo * LIMIT, { dateFrom, dateTo });
          if (!page.ok) throw new Error(`OnBuy orders ${page.status}: ${page.message}`);
          if (page.orders.length === 0) break;
          for (const order of page.orders) {
            counts.scanned++;
            const orderDate = new Date(String(order.date ?? '').replace(' ', 'T'));
            if (isNaN(orderDate.getTime()) || orderDate < cutoff || (upper && orderDate > upper)) { counts.skipped++; continue; }
            const mapped = mapOnBuyOrder(order);
            // Skip fully cancelled/refunded orders (not net sales). Partial refunds/dispatches import.
            const st = String(order.status ?? '').toLowerCase();
            if (mapped.payload.resolution === 'cancelled' || (st.includes('refund') && !st.includes('partial'))) { counts.cancelled++; continue; }
            if (await this.importMappedOrder(row, mapped, orderDate, sysUser, actorId, counts)) advance(orderDate);
          }
          if (page.orders.length < LIMIT) break;
        }
      } else if (row.channelType === 'ebay') {
        // eBay Sell Fulfillment API. Orders carry line items, pricing AND the eBay fee, so one
        // call per page suffices. Date-filtered by creation date; offset-paginated.
        const config = (row.config ?? {}) as Record<string, string>;
        const secrets = await this.decryptedSecrets(row.id);
        const token = await this.ebayAccessToken(config, secrets);
        const base = config.env === 'sandbox' ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com';
        const fmt = (d: Date) => d.toISOString().replace(/\.\d+Z$/, '.000Z');
        const filter = upper ? `creationdate:[${fmt(cutoff)}..${fmt(upper)}]` : `creationdate:[${fmt(cutoff)}..]`;
        const LIMIT = 200;
        const MAX_PAGES = 50; // 10k orders/run cap; larger backfills should be date-chunked

        // One eBay account sells across eBay UK/AU/DE/… in different currencies. Route each order
        // to the company's sales channel that matches its marketplace country, so it inherits the
        // correct currency / VAT / fees. Falls back to the integration's default channel.
        const companyChannels = row.targetCompanyId
          ? await this.prisma.salesChannel.findMany({ where: { companyId: row.targetCompanyId, deletedAt: null }, select: { id: true, name: true, nativeCountry: { select: { isoCode: true } } } })
          : [];
        const ebayChannelByIso = new Map<string, string>();
        for (const c of companyChannels) if (/ebay/i.test(c.name) && c.nativeCountry?.isoCode) ebayChannelByIso.set(c.nativeCountry.isoCode, c.id);

        for (let pageNo = 0; pageNo < MAX_PAGES; pageNo++) {
          const page = await this.ebayGetOrdersPage(base, token, { filter, limit: LIMIT, offset: pageNo * LIMIT });
          if (!page.ok) throw new Error(`eBay orders ${page.status}: ${page.message}`);
          if (page.orders.length === 0) break;
          for (const order of page.orders) {
            counts.scanned++;
            const orderDate = new Date(String(order.creationDate ?? ''));
            if (isNaN(orderDate.getTime()) || orderDate < cutoff || (upper && orderDate > upper)) { counts.skipped++; continue; }
            const mapped = mapEbayOrder(order);
            // Fully cancelled orders are not net sales — skip (mirrors OnBuy).
            if (mapped.payload.resolution === 'cancelled') { counts.cancelled++; continue; }
            const iso = mapped.payload.marketplaceCountryCode;
            const channelId = (iso && ebayChannelByIso.get(iso)) || row.targetSalesChannelId;
            if (await this.importMappedOrder(row, mapped, orderDate, sysUser, actorId, counts, channelId)) advance(orderDate);
          }
          if (page.orders.length < LIMIT) break;
        }
      } else {
        // Amazon SP-API. The API does the date filtering: CreatedAfter/Before for a
        // range or first backfill; LastUpdatedAfter for incremental (catches status
        // changes too). Cancelled orders are skipped before the per-order item call.
        const config = (row.config ?? {}) as Record<string, string>;
        const secrets = await this.decryptedSecrets(row.id);
        const { endpoint, marketplaceId, defaultCountry } = this.amazonMarketMeta(row);
        const token = await this.amazonAccessToken(config, secrets);
        const useUpdated = !isRange && !!row.lastSyncedAt;
        // Amazon rejects CreatedBefore within ~2 min of now — clamp a future/too-recent bound.
        const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000);
        const createdBefore = isRange && upper ? (upper > twoMinAgo ? twoMinAgo : upper) : undefined;
        const filters = {
          createdAfter: useUpdated ? undefined : cutoff.toISOString(),
          createdBefore: createdBefore ? createdBefore.toISOString() : undefined,
          lastUpdatedAfter: useUpdated ? cutoff.toISOString() : undefined,
        };
        const MAX_PAGES = 200;
        const MAX_ORDERS = 4000; // safety cap; larger backfills should be chunked by date range
        let nextToken: string | null = null;
        let capped = false;

        for (let pageNo = 0; pageNo < MAX_PAGES; pageNo++) {
          const page = await this.amazonGetOrdersPage(endpoint, token, marketplaceId, pageNo === 0 ? filters : { nextToken });
          if (!page.ok) throw new Error(`Amazon orders ${page.status}: ${page.message}`);
          for (const order of page.orders) {
            counts.scanned++;
            if (counts.scanned > MAX_ORDERS) { capped = true; break; }
            const orderDate = new Date(String(order.PurchaseDate ?? ''));
            if (isNaN(orderDate.getTime())) { counts.skipped++; continue; }
            // Multi-Channel Fulfillment: Amazon only SHIPPED these (from FBA stock); the sale +
            // its revenue belong to the non-Amazon channel it was placed on. Not Amazon sales —
            // skip whatever their status (checked before the cancel branch so MCF cancels skip too).
            if (String(order.SalesChannel ?? '') === 'Non-Amazon') { mcfSkipped++; continue; }
            if (String(order.OrderStatus) === 'Canceled') {
              counts.cancelled++;
              advance(orderDate);
              // Gate off → pre-feature behaviour: a cancellation is simply skipped (not registered).
              if (!applyResolutions) continue;
              // Amazon only cancels pre-ship, so a cancellation is financially neutral — but it is
              // still REGISTERED for reporting (per the cancelled-order requirement), not dropped.
              const existingTx = await this.prisma.salesTransaction.findFirst({ where: { integrationId: row.id, transactionRef: order.AmazonOrderId, deletedAt: null }, select: { id: true } });
              if (existingTx) {
                // Cancelled after we imported it: downgrade + release any reserved stock.
                const r = await this.salesTx.applyChannelResolution(existingTx.id, { resolution: 'cancelled' }, actorId);
                if (r.applied) counts.cancelledUpdated++;
              } else {
                // Never imported: bring it in as a neutral record, then mark it cancelled. Cancelled
                // orders come back with zeroed quantities/prices, so this carries no revenue or cost.
                const cancelledItems = await this.amazonGetOrderItems(endpoint, token, order.AmazonOrderId);
                const cancelledMapped = mapAmazonOrder(order, cancelledItems, defaultCountry);
                if (await this.importMappedOrder(row, cancelledMapped, orderDate, sysUser, actorId, counts)) {
                  const createdTx = await this.prisma.salesTransaction.findFirst({ where: { integrationId: row.id, transactionRef: order.AmazonOrderId, deletedAt: null }, select: { id: true } });
                  // importMappedOrder counted it as a create; reclassify it as a cancellation record.
                  if (createdTx) { await this.salesTx.applyChannelResolution(createdTx.id, { resolution: 'cancelled' }, actorId); counts.cancelledImported++; counts.created--; }
                }
                await sleep(300);
              }
              continue;
            }
            const items = await this.amazonGetOrderItems(endpoint, token, order.AmazonOrderId);
            const mapped = mapAmazonOrder(order, items, defaultCountry);
            this.applyAmazonFees(mapped, await this.fetchAmazonOrderFees(endpoint, token, order.AmazonOrderId));
            if (await this.importMappedOrder(row, mapped, orderDate, sysUser, actorId, counts)) advance(orderDate);
            await sleep(300); // stay under the getOrderItems / finances rate limits
          }
          nextToken = page.nextToken;
          if (capped || !nextToken) break;
        }
        if (capped) note = ` (stopped at ${MAX_ORDERS}-order cap — narrow the date range for the rest)`;

        // Fees post on Amazon's settlement cycle (up to ~2 weeks after the sale), so
        // recent orders import with fee 0. Re-check the trailing window every sync and
        // fill any fees that have since posted.
        feesRefreshed = await this.refreshRecentAmazonFees(row, endpoint, token, 45);

        // Refunds on already-shipped orders never change OrderStatus (it stays 'Shipped'), so
        // they can't be caught above — pull them straight from the Finances API and mark the
        // matched transaction. refundAmount is native currency (as stored); the profit calc
        // converts it. This flags a "return decision needed" item for the operator.
        // Gated: dormant until channel-resolution handling is switched on for the environment.
        const refundsAfter = isRange ? cutoff : new Date(Date.now() - 45 * 24 * 3600 * 1000);
        const refunds = applyResolutions ? await this.fetchAmazonRefunds(endpoint, token, refundsAfter) : new Map();
        for (const [orderId, info] of refunds) {
          if (info.refundedExVat <= 0) continue;
          const tx = await this.prisma.salesTransaction.findFirst({ where: { integrationId: row.id, transactionRef: orderId, deletedAt: null }, select: { id: true } });
          if (!tx) continue; // a refund for an order we never imported (e.g. a pre-ship cancel)
          const r = await this.salesTx.applyChannelResolution(tx.id, { resolution: 'returned', refundAmount: info.refundedExVat, feeRefunded: info.feeReturned }, actorId);
          if (r.applied) counts.refunded++;
        }
      }

      // Re-link any items whose product/alias was added after they were imported.
      const relinked = await this.relinkUnlinkedItems(row.id);

      const rangeNote = isRange ? ` for ${range!.from}…${range!.to ?? 'now'}` : '';
      const feeNote = feesRefreshed ? `, ${feesRefreshed} fees backfilled` : '';
      const relinkNote = relinked ? `, ${relinked} products re-linked` : '';
      const mcfNote = mcfSkipped ? `, ${mcfSkipped} MCF (non-Amazon) skipped` : '';
      const cancelledDone = counts.cancelledImported + counts.cancelledUpdated;
      const defectNote =
        (cancelledDone ? `, ${cancelledDone} cancelled registered` : '') +
        (counts.refunded ? `, ${counts.refunded} refunds applied` : '');
      const message = `${counts.created} created, ${counts.updated} updated, ${counts.cancelled} cancelled, ${counts.errors} errors${defectNote}${feeNote}${relinkNote}${mcfNote}${rangeNote}${note}`;
      // The run completed — status is 'ok' even if some individual orders failed (those surface
      // as the "N errors" count in the message / a danger chip). Only a thrown failure (caught
      // below, e.g. auth/API down) is a real 'error'.
      await this.prisma.channelIntegration.update({ where: { id }, data: { lastSyncedAt: maxDate ?? undefined, lastSyncRunAt: new Date(), lastSyncStatus: 'ok', lastSyncMessage: message } });
      await this.audit(id, actorId, isRange ? 'sync.range' : 'sync', `${trigger}: ${message}`);
      return { ok: true, ...counts, message };
    } catch (e: any) {
      const message = (e?.message ?? String(e)).slice(0, 300);
      await this.prisma.channelIntegration.update({ where: { id }, data: { lastSyncRunAt: new Date(), lastSyncStatus: 'error', lastSyncMessage: message } });
      await this.audit(id, actorId, 'sync', `${trigger}: ERROR ${message}`);
      return { ok: false, ...counts, message };
    }
  }

  /** Daily automatic pull for integrations that opted in. */
  @Cron('0 5 * * *')
  async scheduledSync() {
    const rows = await this.prisma.channelIntegration.findMany({
      where: { deletedAt: null, status: 'active', autoSyncEnabled: true, mappingVerifiedAt: { not: null }, channelType: { in: ['onbuy', 'amazon', 'ebay'] } },
      select: { id: true, name: true },
    });
    for (const r of rows) {
      this.logger.log(`Auto-sync: ${r.name}`);
      await this.syncOrders(r.id, 'schedule').catch((e) => this.logger.error(`Auto-sync failed for ${r.name}: ${e?.message ?? e}`));
    }
  }

  private async audit(integrationId: string, actorId: string | undefined, action: string, detail?: string) {
    await this.prisma.integrationAudit.create({ data: { integrationId, actorId: actorId ?? null, action, detail: detail ?? null } }).catch(() => undefined);
  }
}
