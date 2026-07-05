import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../crypto/crypto.service';
import { configFieldKeys, getConnector, getMarketplace, listConnectors, secretFieldKeys, type ConnectorDef } from './connectors';
import { CreateIntegrationDto, UpdateIntegrationDto } from './dto/integration.dto';

@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(private readonly prisma: PrismaService, private readonly crypto: CryptoService) {}

  connectors() {
    return listConnectors();
  }

  private requireConnector(type: string): ConnectorDef {
    const c = getConnector(type);
    if (!c) throw new BadRequestException(`Unknown channel type: ${type}`);
    return c;
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
      data: { name: dto.name, status: dto.status, marketplace: dto.marketplace, ...(nextConfig ? { config: nextConfig } : {}), updatedById: actorId },
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

  /** Read-only: fetch a few recent OnBuy orders to validate the connection and
   *  reveal the data shape before we build the importer. Nothing is stored. */
  async previewOrders(id: string, actorId?: string, limit = 5) {
    const row = await this.prisma.channelIntegration.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException('Integration not found');
    if (row.channelType !== 'onbuy') throw new BadRequestException('Order preview currently supports OnBuy only.');
    const config = (row.config ?? {}) as Record<string, string>;
    const secrets = await this.decryptedSecrets(row.id);
    const { token, mode, base } = await this.onbuyAccessToken(config, secrets);

    const siteId = (config.siteIds || '').match(/\d+/)?.[0];
    const params = new URLSearchParams({ limit: String(limit), offset: '0' });
    if (siteId) params.set('site_id', siteId);
    const res = await fetch(`${base}/orders?${params.toString()}`, { headers: { Authorization: token }, signal: AbortSignal.timeout(12000) });
    const json: any = await res.json().catch(() => null);
    await this.audit(id, actorId, 'preview', `mode=${mode} status=${res.status}`);
    if (!res.ok) {
      return { ok: false, mode, status: res.status, message: (json?.error?.message || json?.message || '').toString().slice(0, 200) };
    }
    const orders = json?.results ?? (Array.isArray(json) ? json : []);
    return { ok: true, mode, siteId: siteId ?? null, total: json?.total ?? null, count: orders.length, orders };
  }

  private async audit(integrationId: string, actorId: string | undefined, action: string, detail?: string) {
    await this.prisma.integrationAudit.create({ data: { integrationId, actorId: actorId ?? null, action, detail: detail ?? null } }).catch(() => undefined);
  }
}
