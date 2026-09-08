import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../crypto/crypto.service';
import {
  baseUrlFor, describeTokenFailure, expiryFrom, isExpired, tokenCacheKey,
  type CachedToken,
} from './fedex-token';
import {
  RATE_PATH, buildRateRequest, describeRateFailure, missingForQuote, needsCustoms, rateHeaders,
  type RateQuoteInput, type RateEndpoint, type RateParcel,
} from './fedex-rate';
import { parseRateReply } from './fedex-rate-parse';
import {
  SHIP_CANCEL_PATH, SHIP_PATH, buildCancelRequest, buildShipRequest, missingForBooking,
  type ShipParty, type ShipRequestInput,
} from './fedex-ship';

/** The credential fields a FedEx account holds. Nothing else is accepted or stored. */
export const FEDEX_SECRET_FIELDS = ['apiKey', 'secretKey'] as const;
type SecretField = (typeof FEDEX_SECRET_FIELDS)[number];

export interface CarrierAccountInput {
  companyId: string;
  carrier?: string;
  name: string;
  accountNumber: string;
  environment?: 'sandbox' | 'production';
  originLine1?: string | null;
  originLine2?: string | null;
  originCity?: string | null;
  originRegion?: string | null;
  originPostalCode?: string | null;
  originCountryIso?: string | null;
  originPhone?: string | null;
  isActive?: boolean;
  /** Omitted or blank leaves the stored value untouched — the form never receives them back. */
  secrets?: Partial<Record<SecretField, string>>;
}

/**
 * Carrier accounts and the FedEx connection.
 *
 * Everything here is about one thing at the moment: proving we can authenticate. Rating, labels and
 * tracking come next, and all of them run through `token()`, which is why its throttle discipline
 * matters more than anything else in the file.
 */
@Injectable()
export class CarriersService {
  private readonly logger = new Logger(CarriersService.name);

  /**
   * In-process token cache.
   *
   * A Map rather than a database column on purpose. A token lives an hour, a deploy is more frequent
   * than that, and a token surviving a restart in the database is a credential sitting at rest for
   * no benefit. Losing the cache on restart costs exactly one token call per account.
   */
  private readonly tokens = new Map<string, CachedToken>();

  /**
   * Accounts already fetching a token, so concurrent callers wait rather than each minting one.
   *
   * Without this, five shipments created at once produce five simultaneous token requests against an
   * endpoint that allows about one a second — and the ban that follows is per IP, so it lands on
   * every company on the server, not just the one that caused it.
   */
  private readonly inFlight = new Map<string, Promise<string>>();

  constructor(private readonly prisma: PrismaService, private readonly crypto: CryptoService) {}

  // ------------------------------------------------------------------ accounts

  /** Never returns secrets — only which fields are stored, and their last four characters. */
  async list(companyIds?: string[]) {
    const rows = await this.prisma.carrierAccount.findMany({
      where: { deletedAt: null, ...(companyIds ? { companyId: { in: companyIds } } : {}) },
      include: {
        company: { select: { id: true, officialName: true } },
        secrets: { select: { fieldKey: true, last4: true, updatedAt: true } },
      },
      orderBy: [{ carrier: 'asc' }, { name: 'asc' }],
    });
    return rows.map((r) => this.serialize(r));
  }

  async get(id: string, companyIds?: string[]) {
    const row = await this.prisma.carrierAccount.findFirst({
      where: { id, deletedAt: null, ...(companyIds ? { companyId: { in: companyIds } } : {}) },
      include: {
        company: { select: { id: true, officialName: true } },
        secrets: { select: { fieldKey: true, last4: true, updatedAt: true } },
      },
    });
    if (!row) throw new NotFoundException('Carrier account not found');
    return this.serialize(row);
  }

  private serialize(r: any) {
    return {
      id: r.id,
      companyId: r.companyId,
      companyName: r.company?.officialName ?? null,
      carrier: r.carrier,
      name: r.name,
      accountNumber: r.accountNumber,
      environment: r.environment as 'sandbox' | 'production',
      origin: {
        line1: r.originLine1, line2: r.originLine2, city: r.originCity,
        region: r.originRegion, postalCode: r.originPostalCode,
        countryIso: r.originCountryIso, phone: r.originPhone,
      },
      isActive: r.isActive,
      lastTestedAt: r.lastTestedAt,
      lastTestOk: r.lastTestOk,
      lastTestNote: r.lastTestNote,
      /** Which credentials are stored and their last four — never the values. */
      secrets: (r.secrets ?? []).map((s: any) => ({ fieldKey: s.fieldKey, last4: s.last4, updatedAt: s.updatedAt })),
    };
  }

  async create(input: CarrierAccountInput, actorId?: string, companyIds?: string[]) {
    this.assertCompanyVisible(input.companyId, companyIds);
    const data = this.accountData(input);
    if (!data.name || !data.accountNumber) throw new BadRequestException('A name and an account number are required');

    const created = await this.prisma.carrierAccount.create({
      data: {
        ...data,
        companyId: input.companyId,
        carrier: input.carrier ?? 'fedex',
        // Always off on creation, whatever the caller asked for. An account nobody has seen answer
        // must not be shippable, and the test is what turns it on.
        isActive: false,
        createdById: actorId ?? null,
        updatedById: actorId ?? null,
      },
    });
    await this.writeSecrets(created.id, input.secrets ?? {});
    return this.get(created.id, companyIds);
  }

  async update(id: string, input: Partial<CarrierAccountInput>, actorId?: string, companyIds?: string[]) {
    const existing = await this.prisma.carrierAccount.findFirst({
      where: { id, deletedAt: null, ...(companyIds ? { companyId: { in: companyIds } } : {}) },
    });
    if (!existing) throw new NotFoundException('Carrier account not found');
    if (input.companyId) this.assertCompanyVisible(input.companyId, companyIds);

    const wroteSecrets = await this.writeSecrets(id, input.secrets ?? {});
    const changedEnvironment = input.environment != null && input.environment !== existing.environment;

    await this.prisma.carrierAccount.update({
      where: { id },
      data: {
        ...this.accountData(input as CarrierAccountInput),
        ...(input.companyId ? { companyId: input.companyId } : {}),
        ...(input.isActive != null ? { isActive: input.isActive } : {}),
        /**
         * A changed key or a changed environment withdraws the last test result.
         *
         * The stored "connected" refers to the credentials that were tested. Leaving it in place
         * after either changes would show a green tick for a configuration nobody has ever tried —
         * the same mistake as a review surviving an edited cost.
         */
        ...(wroteSecrets || changedEnvironment
          ? { lastTestedAt: null, lastTestOk: null, lastTestNote: null, isActive: false }
          : {}),
        updatedById: actorId ?? null,
      },
    });

    // The cached token belongs to the old credentials. Both cases invalidate it.
    if (wroteSecrets || changedEnvironment) {
      this.tokens.delete(tokenCacheKey(id, existing.environment));
      this.tokens.delete(tokenCacheKey(id, input.environment ?? existing.environment));
    }
    return this.get(id, companyIds);
  }

  async remove(id: string, actorId?: string, companyIds?: string[]) {
    const existing = await this.prisma.carrierAccount.findFirst({
      where: { id, deletedAt: null, ...(companyIds ? { companyId: { in: companyIds } } : {}) },
      select: { id: true, environment: true },
    });
    if (!existing) throw new NotFoundException('Carrier account not found');
    await this.prisma.carrierAccount.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false, updatedById: actorId ?? null },
    });
    this.tokens.delete(tokenCacheKey(id, existing.environment));
    return { ok: true as const };
  }

  private assertCompanyVisible(companyId: string, companyIds?: string[]) {
    if (companyIds && !companyIds.includes(companyId)) {
      throw new BadRequestException('That company is not available in the current scope.');
    }
  }

  /** The non-secret columns, with blanks normalised to null so an empty box is not a value. */
  private accountData(input: Partial<CarrierAccountInput>) {
    const t = (v: string | null | undefined) => {
      const s = (v ?? '').trim();
      return s === '' ? null : s;
    };
    return {
      ...(input.name !== undefined ? { name: (input.name ?? '').trim() } : {}),
      ...(input.accountNumber !== undefined ? { accountNumber: (input.accountNumber ?? '').trim() } : {}),
      ...(input.environment !== undefined ? { environment: input.environment === 'production' ? 'production' : 'sandbox' } : {}),
      ...(input.originLine1 !== undefined ? { originLine1: t(input.originLine1) } : {}),
      ...(input.originLine2 !== undefined ? { originLine2: t(input.originLine2) } : {}),
      ...(input.originCity !== undefined ? { originCity: t(input.originCity) } : {}),
      ...(input.originRegion !== undefined ? { originRegion: t(input.originRegion) } : {}),
      ...(input.originPostalCode !== undefined ? { originPostalCode: t(input.originPostalCode) } : {}),
      ...(input.originCountryIso !== undefined ? { originCountryIso: t(input.originCountryIso)?.toUpperCase() ?? null } : {}),
      ...(input.originPhone !== undefined ? { originPhone: t(input.originPhone) } : {}),
    } as any;
  }

  // ------------------------------------------------------------------ secrets

  /** Returns whether anything was actually written — a blank field means "leave it alone". */
  private async writeSecrets(accountId: string, secrets: Partial<Record<SecretField, string>>): Promise<boolean> {
    let wrote = false;
    for (const field of FEDEX_SECRET_FIELDS) {
      const raw = (secrets[field] ?? '').trim();
      // Omitted or blank leaves the stored secret untouched. The form never receives the value back,
      // so an empty box means "unchanged", not "erase".
      if (raw === '') continue;
      const enc = this.crypto.encrypt(raw);
      await this.prisma.carrierAccountSecret.upsert({
        where: { accountId_fieldKey: { accountId, fieldKey: field } },
        create: { accountId, fieldKey: field, ...enc, last4: CryptoService.last4(raw) },
        update: { ...enc, last4: CryptoService.last4(raw) },
      });
      wrote = true;
    }
    return wrote;
  }

  private async decryptedSecrets(accountId: string): Promise<Partial<Record<SecretField, string>>> {
    const rows = await this.prisma.carrierAccountSecret.findMany({ where: { accountId } });
    const out: Partial<Record<SecretField, string>> = {};
    for (const r of rows) {
      out[r.fieldKey as SecretField] = this.crypto.decrypt({
        ciphertext: r.ciphertext, iv: r.iv, authTag: r.authTag, keyVersion: r.keyVersion,
      });
    }
    return out;
  }

  // ------------------------------------------------------------------ FedEx auth

  /**
   * A bearer token for this account, from cache wherever possible.
   *
   * The one function every future FedEx call goes through. See fedex-token.ts for why the caching
   * is not optional: the token endpoint is throttled per IP, and a breach blocks every company on
   * the server for ten minutes.
   *
   * `force` exists for the 401 path — a token can be revoked before it expires, and only a 401 will
   * say so. It is not for "just in case".
   */
  async token(accountId: string, opts: { force?: boolean } = {}): Promise<string> {
    const account = await this.prisma.carrierAccount.findFirst({
      where: { id: accountId, deletedAt: null },
      select: { id: true, environment: true },
    });
    if (!account) throw new NotFoundException('Carrier account not found');

    const key = tokenCacheKey(account.id, account.environment);
    if (opts.force) this.tokens.delete(key);
    else {
      const cached = this.tokens.get(key);
      if (!isExpired(cached, new Date())) return cached!.accessToken;
    }

    // Somebody else is already asking. Wait for their answer rather than making a second request:
    // concurrent callers are exactly how a per-IP throttle gets tripped.
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const promise = this.mintToken(account.id, account.environment, key).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, promise);
    return promise;
  }

  private async mintToken(accountId: string, environment: string, key: string): Promise<string> {
    const secrets = await this.decryptedSecrets(accountId);
    if (!secrets.apiKey || !secrets.secretKey) {
      throw new BadRequestException('This account has no API key and secret stored yet.');
    }

    const res = await fetch(`${baseUrlFor(environment)}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: secrets.apiKey,
        client_secret: secrets.secretKey,
      }).toString(),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      // Deliberately NOT retried. Every other call in this platform retries a 429; this one must
      // not, because here a retry is what lengthens the ban rather than what recovers from it.
      throw new BadRequestException(describeTokenFailure(res.status, body));
    }

    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) throw new BadRequestException('FedEx returned no token.');

    this.tokens.set(key, { accessToken: json.access_token, expiresAt: expiryFrom(json.expires_in, new Date()) });
    return json.access_token;
  }

  /**
   * Prove the stored credentials work, and record the answer.
   *
   * Authenticating is the whole test for now: it is the only FedEx endpoint whose path is published
   * outside a logged-in portal session, and a token proves the key, the secret and the environment
   * all agree. It does not prove the account number is right — nothing will, until a rate request
   * can be made against it.
   */
  async test(id: string, actorId?: string, companyIds?: string[]) {
    const account = await this.prisma.carrierAccount.findFirst({
      where: { id, deletedAt: null, ...(companyIds ? { companyId: { in: companyIds } } : {}) },
      select: { id: true, environment: true },
    });
    if (!account) throw new NotFoundException('Carrier account not found');

    let ok = false;
    let note: string;
    try {
      await this.token(id, { force: true });
      ok = true;
      note = `Authenticated against FedEx ${account.environment}. The account number is not verified by this test — a rate request is what will confirm it.`;
    } catch (e: any) {
      note = e?.message ?? 'Could not reach FedEx';
      this.logger.warn(`FedEx connection test failed for account ${id}: ${note}`);
    }

    await this.prisma.carrierAccount.update({
      where: { id },
      data: {
        lastTestedAt: new Date(), lastTestOk: ok, lastTestNote: note.slice(0, 500),
        // A pass enables the account; a failure switches it off. An account that stopped answering
        // should stop being offered, rather than fail at the moment somebody needs a label.
        isActive: ok,
        updatedById: actorId ?? null,
      },
    });
    return { ok, message: note };
  }

  // ------------------------------------------------------------------ rating

  /**
   * Where this account's shipments leave from.
   *
   * The account's own origin if one was entered, otherwise the owning company's address. Kept in
   * one place because a rate quoted from the wrong origin is not obviously wrong on screen — it is
   * simply a number, and a plausible one.
   */
  private async originFor(accountId: string): Promise<{ endpoint: RateEndpoint; source: 'account' | 'company' } | null> {
    const a = await this.prisma.carrierAccount.findFirst({
      where: { id: accountId, deletedAt: null },
      select: {
        originPostalCode: true, originCountryIso: true,
        company: { select: { addressPostalCode: true, addressCountry: true } },
      },
    });
    if (!a) return null;
    if (a.originPostalCode && a.originCountryIso) {
      return { endpoint: { postalCode: a.originPostalCode, countryIso: a.originCountryIso }, source: 'account' };
    }
    return {
      endpoint: { postalCode: a.company?.addressPostalCode ?? null, countryIso: a.company?.addressCountry ?? null },
      source: 'company',
    };
  }

  /** ISO-2 codes inside the EU VAT zone, from our own countries table rather than a second list. */
  private async euCountryCodes(): Promise<Set<string>> {
    const rows = await this.prisma.country.findMany({
      where: { euVatZone: true, deletedAt: null },
      select: { isoCode: true },
    });
    return new Set(rows.map((r) => (r.isoCode ?? '').toUpperCase()).filter(Boolean));
  }

  /**
   * Ask FedEx what a shipment would cost.
   *
   * The response is returned RAW and unmapped, deliberately. FedEx's JSON collection ships sample
   * requests but no sample responses — the sandbox generates those when a request is run — so
   * nobody here has yet seen the shape of a reply. Writing a mapper against a guessed shape is the
   * one mistake this integration has been avoiding from the start, and it would have to be rewritten
   * the day a real response arrived. The mapping goes in once there is something real to map.
   */
  async rateQuote(
    accountId: string,
    input: { recipient: RateEndpoint; parcels: RateParcel[]; customsValue?: { amount: number; currency: string } | null; goodsDescription?: string | null; serviceType?: string | null },
    companyIds?: string[],
  ) {
    const account = await this.prisma.carrierAccount.findFirst({
      where: { id: accountId, deletedAt: null, ...(companyIds ? { companyId: { in: companyIds } } : {}) },
      select: { id: true, environment: true, accountNumber: true, isActive: true },
    });
    if (!account) throw new NotFoundException('Carrier account not found');
    if (!account.isActive) {
      throw new BadRequestException('Test the connection on this account before quoting with it.');
    }

    const origin = await this.originFor(accountId);
    const quote: RateQuoteInput = {
      accountNumber: account.accountNumber,
      shipper: origin?.endpoint ?? { postalCode: null, countryIso: null },
      recipient: input.recipient,
      parcels: input.parcels,
      customsValue: input.customsValue ?? null,
      goodsDescription: input.goodsDescription ?? null,
      serviceType: input.serviceType ?? null,
      // Every figure in this platform is reconciled in euro, so the quote is asked for in euro
      // rather than converted afterwards at a rate FedEx did not use.
      preferredCurrency: 'EUR',
    };

    const gaps = missingForQuote(quote);
    if (gaps.length) {
      // Refused before spending a call, and it names what is missing — including the case where the
      // origin is missing because neither the account nor its company carries an address.
      throw new BadRequestException(`Cannot quote yet — still needed: ${gaps.join(', ')}.`);
    }

    const eu = await this.euCountryCodes();
    const customs = needsCustoms(quote.shipper.countryIso, quote.recipient.countryIso, eu);
    const body = buildRateRequest(quote, { customs });

    const send = async (token: string) =>
      fetch(`${baseUrlFor(account.environment)}${RATE_PATH}`, {
        method: 'POST',
        headers: rateHeaders(token),
        body: JSON.stringify(body),
      });

    let res = await send(await this.token(accountId));
    if (res.status === 401) {
      /**
       * The one case a forced refresh is for.
       *
       * A token can be revoked before it expires, and only a 401 says so. Retried exactly once: a
       * second 401 means something other than staleness, and looping would spend token requests
       * against an endpoint that bans us for ten minutes.
       */
      res = await send(await this.token(accountId, { force: true }));
    }

    const text = await res.text();
    let parsed: unknown = null;
    try { parsed = JSON.parse(text); } catch { /* left as raw text below */ }

    if (!res.ok) {
      this.logger.warn(`FedEx rate quote failed (${res.status}) on account ${accountId}`);
    }
    return {
      ok: res.ok,
      status: res.status,
      /**
       * What the failure means, rather than what FedEx called it.
       *
       * A rejected rate request comes back as "We could not authenticate your credentials", which
       * is not true and sends people to re-type a key that demonstrably works — a token was minted
       * with it moments earlier. Null when the call succeeded.
       */
      message: res.ok
        ? null
        : describeRateFailure(res.status, parsed, { environment: account.environment, originCountry: quote.shipper.countryIso }),
      /**
       * The quote, read into our own shape: negotiated price, surcharges, transit commitment.
       *
       * Null on failure — an empty options list would read as "FedEx has nothing on this lane",
       * which is a different and much more misleading answer than "the request was refused".
       */
      quote: res.ok ? parseRateReply(parsed) : null,
      /** What we sent, so a rejection can be read against it rather than guessed at. */
      request: body,
      response: parsed ?? text.slice(0, 20_000),
      origin: origin?.source ?? null,
      /**
       * The origin actually used, spelled out.
       *
       * Without it a refusal is unreadable: sandbox rejects a lane it does not know in exactly the
       * words it uses for a bad credential, and the reader has no way to see which origin was sent.
       * That sent somebody hunting for lost API keys when the ship-from had simply reverted.
       */
      originCountry: quote.shipper.countryIso ?? null,
      originPostalCode: quote.shipper.postalCode ?? null,
      customs,
    };
  }

  // ------------------------------------------------------------------ booking

  /**
   * Book a shipment and write down everything about it.
   *
   * The order of operations matters more here than anywhere else in this integration. FedEx has no
   * shipment-history API (§2.2): once a label exists, anything we failed to record is unrecoverable.
   * So the whole reply is stored before this function returns, and it is stored even when the reply
   * cannot be fully understood.
   *
   * The response shape is NOT yet mapped. FedEx's Ship collection carries 1,335 sample requests and
   * no sample responses, exactly as the rate collection did. Rather than invent field names, this
   * keeps the reply whole and reports what it could and could not find. The first real booking
   * settles it, and nothing is lost in the meantime.
   */
  async book(
    accountId: string,
    input: {
      transactionId: string;
      serviceType: string;
      shipDate: string;
      parcels: Array<{ weightKg: number; lengthCm?: number | null; widthCm?: number | null; heightCm?: number | null }>;
      dutiesPaidBy: 'sender' | 'recipient';
      goodsDescription?: string | null;
      quoted?: { amount: number; currency: string } | null;
      labelImageType?: 'PDF' | 'PNG' | 'ZPLII';
    },
    actorId?: string,
    companyIds?: string[],
  ) {
    const account = await this.prisma.carrierAccount.findFirst({
      where: { id: accountId, deletedAt: null, ...(companyIds ? { companyId: { in: companyIds } } : {}) },
      select: { id: true, environment: true, accountNumber: true, isActive: true, company: { select: { officialName: true, phoneLandline: true } } },
    });
    if (!account) throw new NotFoundException('Carrier account not found');
    if (!account.isActive) throw new BadRequestException('Test the connection on this account before booking with it.');

    const tx = await this.prisma.salesTransaction.findFirst({
      where: { id: input.transactionId, deletedAt: null, ...(companyIds ? { companyId: { in: companyIds } } : {}) },
      select: { id: true, transactionRef: true, deliveryAddress: true },
    });
    if (!tx) throw new NotFoundException('Sales transaction not found');

    const addr = tx.deliveryAddress;
    if (!addr || addr.purgedAt) {
      throw new BadRequestException(
        addr?.purgedAt
          ? 'This order\'s delivery address was erased under the retention policy. Re-enter it before booking.'
          : 'This order has no delivery address yet.',
      );
    }

    const originAddr = await this.shipperParty(accountId, account.company?.officialName ?? null, account.company?.phoneLandline ?? null);
    const recipient: ShipParty = {
      contact: { personName: addr.fullName, companyName: addr.companyName, phoneNumber: addr.phone },
      address: {
        streetLines: [addr.addressLine1, addr.addressLine2].filter((x): x is string => !!x),
        city: addr.city,
        stateOrProvinceCode: addr.stateOrRegion,
        postalCode: addr.postalCode,
        countryCode: addr.countryIso,
        residential: addr.isBusiness == null ? null : !addr.isBusiness,
      },
      ...(addr.eori ? { tins: [{ tinType: 'BUSINESS_NATIONAL', number: addr.eori }] } : {}),
    };

    const shipInput: ShipRequestInput = {
      accountNumber: account.accountNumber,
      shipper: originAddr,
      recipient,
      serviceType: input.serviceType,
      shipDate: input.shipDate,
      parcels: input.parcels,
      // The order reference, which is what comes back on the invoice and joins the charge to it.
      customerReference: tx.transactionRef ?? tx.id,
      dutiesPaidBy: input.dutiesPaidBy,
      goodsDescription: input.goodsDescription ?? null,
      labelImageType: input.labelImageType,
    };

    const gaps = missingForBooking(shipInput);
    if (gaps.length) throw new BadRequestException(`Cannot book yet — still needed: ${gaps.join(', ')}.`);

    const eu = await this.euCountryCodes();
    const customs = needsCustoms(shipInput.shipper.address.countryCode, shipInput.recipient.address.countryCode, eu);
    const body = buildShipRequest(shipInput, { customs });

    const send = async (token: string) =>
      fetch(`${baseUrlFor(account.environment)}${SHIP_PATH}`, {
        method: 'POST',
        headers: rateHeaders(token),
        body: JSON.stringify(body),
      });

    let res = await send(await this.token(accountId));
    if (res.status === 401) res = await send(await this.token(accountId, { force: true }));

    const text = await res.text();
    let parsed: any = null;
    try { parsed = JSON.parse(text); } catch { /* kept as text below */ }

    if (!res.ok) {
      // Nothing was booked, so nothing is recorded. A failed booking is not a shipment.
      this.logger.warn(`FedEx booking failed (${res.status}) on account ${accountId}`);
      return { ok: false as const, status: res.status, message: describeRateFailure(res.status, parsed), request: body, response: parsed ?? text.slice(0, 20_000), booking: null };
    }

    /**
     * A label now exists and is billable. Everything below is best-effort EXCEPT the row itself,
     * which is written whatever we manage to understand — an unparsed booking we can read later
     * beats no record of a shipment that has already left.
     */
    const shipment = parsed?.output?.transactionShipments?.[0] ?? null;
    const masterTrackingNumber = shipment?.masterTrackingNumber ?? null;

    const booking = await this.prisma.carrierBooking.create({
      data: {
        carrierAccountId: accountId,
        transactionId: tx.id,
        // Copied, not referenced — see the column comment.
        environment: account.environment,
        serviceType: input.serviceType,
        serviceName: shipment?.serviceName ?? null,
        masterTrackingNumber,
        quotedAmount: input.quoted?.amount ?? null,
        quotedCurrency: input.quoted?.currency ?? null,
        dutiesPaidBy: input.dutiesPaidBy,
        customerReference: shipInput.customerReference,
        responseJson: parsed ?? { unparsed: text.slice(0, 100_000) },
        createdById: actorId ?? null,
      },
      select: { id: true, masterTrackingNumber: true, environment: true, customerReference: true },
    });

    this.logger.log(`FedEx booking ${booking.id} created on ${account.environment} for ${shipInput.customerReference}`);
    return {
      ok: true as const,
      status: res.status,
      booking,
      /** Said plainly when the reply did not yield what we expected — the raw is stored regardless. */
      message: masterTrackingNumber
        ? null
        : 'Booked, but no tracking number could be read from the reply. The whole response is stored against the booking — the response shape needs mapping before this is used in earnest.',
      request: body,
      response: parsed ?? text.slice(0, 20_000),
    };
  }

  /**
   * Book a shipment on SANDBOX only, persist nothing, and hand back the whole reply.
   *
   * This exists for one reason: FedEx ships 1,335 sample Ship requests and no sample responses, so
   * the shape of a booking reply cannot be known without making one. Learning it on production would
   * mean a real label, a real tracking number and a real charge, which is not a reasonable price for
   * a piece of documentation.
   *
   * Two deliberate differences from `book()`:
   *  - It refuses production outright. Not a warning, not a confirmation dialog — the diagnostic
   *    physically cannot create a billable shipment.
   *  - It writes no CarrierBooking row. A sandbox booking is not a shipment, and a fictitious one
   *    sitting among real records is worse than no record at all.
   *
   * Note the origin: FedEx's sandbox only knows the lanes in its own sample data. A Cyprus origin is
   * refused there even with the correct test account, so this defaults to the US origin their
   * samples use throughout. That is fine — a virtualised sandbox answers with canned data whatever
   * it is sent, so the lane was never going to say anything about our real prices.
   */
  async testBook(
    accountId: string,
    input: {
      recipient: { personName: string; streetLines: string[]; city: string; stateOrProvinceCode?: string | null; postalCode: string; countryIso: string; phone?: string | null };
      shipper?: { personName: string; streetLines: string[]; city: string; stateOrProvinceCode?: string | null; postalCode: string; countryIso: string; phone?: string | null } | null;
      serviceType: string;
      shipDate: string;
      parcels: Array<{ weightKg: number; lengthCm?: number | null; widthCm?: number | null; heightCm?: number | null }>;
      dutiesPaidBy: 'sender' | 'recipient';
      labelImageType?: 'PDF' | 'PNG' | 'ZPLII';
    },
    companyIds?: string[],
  ) {
    const account = await this.prisma.carrierAccount.findFirst({
      where: { id: accountId, deletedAt: null, ...(companyIds ? { companyId: { in: companyIds } } : {}) },
      select: { id: true, environment: true, accountNumber: true, isActive: true },
    });
    if (!account) throw new NotFoundException('Carrier account not found');
    if (account.environment !== 'sandbox') {
      throw new BadRequestException(
        'Test bookings are sandbox-only. On production this would create a real label, a real tracking number and a real charge — use the ordinary booking flow for that, deliberately.',
      );
    }
    if (!account.isActive) throw new BadRequestException('Test the connection on this account first.');

    const party = (p: NonNullable<typeof input.shipper>): ShipParty => ({
      contact: { personName: p.personName, phoneNumber: p.phone ?? null },
      address: {
        streetLines: p.streetLines.filter(Boolean),
        city: p.city,
        stateOrProvinceCode: p.stateOrProvinceCode ?? null,
        postalCode: p.postalCode,
        countryCode: p.countryIso,
      },
    });

    const shipInput: ShipRequestInput = {
      accountNumber: account.accountNumber,
      // FedEx's own sample origin. Overridable, but this is the one their sandbox knows.
      shipper: party(input.shipper ?? {
        personName: 'maSquare test', streetLines: ['3610 Hacks Cross Road'], city: 'MEMPHIS',
        stateOrProvinceCode: 'TN', postalCode: '38125', countryIso: 'US', phone: '9012636716',
      }),
      recipient: party(input.recipient),
      serviceType: input.serviceType,
      shipDate: input.shipDate,
      parcels: input.parcels,
      // Marked as a test in the reference itself, so a stray sandbox charge would be identifiable.
      customerReference: 'SANDBOX-TEST',
      dutiesPaidBy: input.dutiesPaidBy,
      labelImageType: input.labelImageType,
    };

    const gaps = missingForBooking(shipInput);
    if (gaps.length) throw new BadRequestException(`Cannot book yet — still needed: ${gaps.join(', ')}.`);

    const eu = await this.euCountryCodes();
    const customs = needsCustoms(shipInput.shipper.address.countryCode, shipInput.recipient.address.countryCode, eu);
    const body = buildShipRequest(shipInput, { customs });

    const send = async (token: string) =>
      fetch(`${baseUrlFor(account.environment)}${SHIP_PATH}`, {
        method: 'POST', headers: rateHeaders(token), body: JSON.stringify(body),
      });
    let res = await send(await this.token(accountId));
    if (res.status === 401) res = await send(await this.token(accountId, { force: true }));

    const text = await res.text();
    let parsed: any = null;
    try { parsed = JSON.parse(text); } catch { /* raw below */ }

    return {
      ok: res.ok,
      status: res.status,
      message: res.ok ? null : describeRateFailure(res.status, parsed, { environment: 'sandbox', originCountry: shipInput.shipper.address.countryCode }),
      request: body,
      response: parsed ?? text.slice(0, 40_000),
      customs,
    };
  }

  /** Cancel a booked shipment. The row stays: a cancelled label may still attract a charge. */
  async cancel(bookingId: string, actorId?: string, companyIds?: string[]) {
    const booking = await this.prisma.carrierBooking.findFirst({
      where: {
        id: bookingId, deletedAt: null,
        ...(companyIds ? { account: { companyId: { in: companyIds } } } : {}),
      },
      select: { id: true, status: true, masterTrackingNumber: true, carrierAccountId: true, account: { select: { accountNumber: true, environment: true } } },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.status === 'cancelled') return { ok: true as const, alreadyCancelled: true };
    if (!booking.masterTrackingNumber) {
      throw new BadRequestException('This booking has no tracking number recorded, so FedEx cannot be asked to cancel it.');
    }

    const body = buildCancelRequest(booking.account.accountNumber, booking.masterTrackingNumber);
    const send = async (token: string) =>
      fetch(`${baseUrlFor(booking.account.environment)}${SHIP_CANCEL_PATH}`, {
        method: 'PUT',
        headers: rateHeaders(token),
        body: JSON.stringify(body),
      });

    let res = await send(await this.token(booking.carrierAccountId));
    if (res.status === 401) res = await send(await this.token(booking.carrierAccountId, { force: true }));
    const text = await res.text();
    let parsed: any = null;
    try { parsed = JSON.parse(text); } catch { /* raw below */ }

    if (!res.ok) {
      return { ok: false as const, status: res.status, message: describeRateFailure(res.status, parsed), response: parsed ?? text.slice(0, 8_000) };
    }

    await this.prisma.carrierBooking.update({
      where: { id: bookingId },
      // Marked, not deleted. A cancelled label can still appear on the invoice, and a row that
      // vanished would make that charge impossible to explain.
      data: { status: 'cancelled', cancelledAt: new Date() },
    });
    return { ok: true as const, alreadyCancelled: false };
  }

  /** Us, as FedEx needs us described: the account's origin, or the company's own address. */
  private async shipperParty(accountId: string, companyName: string | null, phone: string | null): Promise<ShipParty> {
    const a = await this.prisma.carrierAccount.findFirst({
      where: { id: accountId },
      select: {
        originLine1: true, originLine2: true, originCity: true, originRegion: true,
        originPostalCode: true, originCountryIso: true, originPhone: true,
        company: { select: { officialName: true, addressLine1: true, addressLine2: true, addressCity: true, addressRegion: true, addressPostalCode: true, addressCountry: true, phoneLandline: true } },
      },
    });
    const useAccount = !!(a?.originPostalCode && a?.originCountryIso);
    const c = a?.company;
    return {
      contact: {
        personName: companyName ?? c?.officialName ?? null,
        companyName: companyName ?? c?.officialName ?? null,
        phoneNumber: (useAccount ? a?.originPhone : c?.phoneLandline) ?? phone ?? null,
      },
      address: {
        streetLines: (useAccount ? [a?.originLine1, a?.originLine2] : [c?.addressLine1, c?.addressLine2]).filter((x): x is string => !!x),
        city: (useAccount ? a?.originCity : c?.addressCity) ?? null,
        stateOrProvinceCode: (useAccount ? a?.originRegion : c?.addressRegion) ?? null,
        postalCode: (useAccount ? a?.originPostalCode : c?.addressPostalCode) ?? null,
        countryCode: (useAccount ? a?.originCountryIso : c?.addressCountry) ?? null,
      },
    };
  }
}
