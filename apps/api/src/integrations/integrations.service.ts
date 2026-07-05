import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../crypto/crypto.service';
import { configFieldKeys, getConnector, listConnectors, secretFieldKeys, type ConnectorDef } from './connectors';
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
    return {
      id: row.id,
      name: row.name,
      channelType: row.channelType,
      connectorLabel: connector?.label ?? row.channelType,
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
      data: { name: dto.name, channelType: dto.channelType, config, createdById: actorId, updatedById: actorId },
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
      data: { name: dto.name, status: dto.status, ...(nextConfig ? { config: nextConfig } : {}), updatedById: actorId },
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
    if (row.channelType !== 'onbuy') return { ok: false, message: 'Testing not supported for this channel yet.' };
    const config = (row.config ?? {}) as Record<string, string>;
    const secrets = await this.decryptedSecrets(row.id);
    const consumerKey = secrets[mode === 'live' ? 'liveConsumerKey' : 'testConsumerKey'];
    const secretKey = secrets[mode === 'live' ? 'liveSecretKey' : 'testSecretKey'];
    if (!consumerKey || !secretKey) return { ok: false, message: `Missing ${mode} Consumer/Secret key.` };
    const base = (config.url || 'https://api.onbuy.com/v2').replace(/\/+$/, '');
    try {
      // OnBuy v2 auth: POST /auth/request-token/ with Authorization: <consumerKey>
      // and form field secret_key=<secretKey>; a token in the response = success.
      const res = await fetch(`${base}/auth/request-token/`, {
        method: 'POST',
        headers: { Authorization: consumerKey, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ secret_key: secretKey }).toString(),
        signal: AbortSignal.timeout(8000),
      });
      const text = await res.text();
      let hasToken = false;
      try { hasToken = !!JSON.parse(text)?.access_token; } catch { /* non-JSON */ }
      if (res.ok && hasToken) return { ok: true, message: 'Authenticated successfully.' };
      return { ok: false, message: `OnBuy responded ${res.status}. Check keys/URL.` };
    } catch (e: any) {
      return { ok: false, message: e?.name === 'TimeoutError' ? 'Request timed out.' : 'Could not reach the OnBuy API.' };
    }
  }

  private async audit(integrationId: string, actorId: string | undefined, action: string, detail?: string) {
    await this.prisma.integrationAudit.create({ data: { integrationId, actorId: actorId ?? null, action, detail: detail ?? null } }).catch(() => undefined);
  }
}
