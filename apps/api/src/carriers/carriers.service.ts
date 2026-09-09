import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../crypto/crypto.service';
import {
  baseUrlFor, describeTokenFailure, expiryFrom, isExpired, tokenCacheKey,
  type CachedToken,
} from './fedex-token';
import {
  RATE_PATH, buildRateRequest, derivedWeightKg, describeRateFailure, missingForQuote, needsCustoms,
  rateHeaders, resolveQuoteDestination,
  type RateQuoteInput, type RateEndpoint, type RateParcel,
} from './fedex-rate';
import { parseRateReply } from './fedex-rate-parse';
import {
  SHIP_CANCEL_PATH, SHIP_PATH, buildCancelRequest, buildShipRequest, missingForBooking,
  type ShipParty, type ShipRequestInput,
} from './fedex-ship';
import {
  FEDEX_NAME_FRAGMENT, TRACK_HISTORY_DAYS, TRACK_PATH, buildTrackRequest, chunkTrackingNumbers,
  describeTrackFailure, dueForRefresh, isFedexService,
} from './fedex-track';
import {
  deliveryPromise, parseTrackReply, statusPill, trackStages,
  type TrackResult, type TrackScan,
} from './fedex-track-parse';

/**
 * The carrier's public tracking page for one number.
 *
 * The template lives on the shipping service — `{tracking}` is replaced — so a new courier is a
 * settings row rather than a code change. Returns null rather than a broken link when no template
 * has been set, which is the state every service is in until somebody fills one in.
 */
function buildTrackingUrl(template: string | null | undefined, trackingNumber: string | null): string | null {
  const t = (template ?? '').trim();
  const n = (trackingNumber ?? '').trim();
  if (!t || !n || !t.includes('{tracking}')) return null;
  return t.replace('{tracking}', encodeURIComponent(n));
}

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

  /**
   * What FedEx would charge to ship a particular ORDER.
   *
   * The version of rating that is actually useful: everything is resolved here — the account, the
   * destination, the weight — rather than assembled by a screen that would have to fetch four
   * things to do it. A caller supplies a transaction id and, optionally, a weight it knows better.
   *
   * Returns a refusal that NAMES what is missing rather than an empty list. "No rates" and "we hold
   * no delivery address for this order" look identical on a screen and mean completely different
   * things — one is a lane FedEx does not serve, the other is a gap somebody can go and fill.
   */
  async quoteForTransaction(
    transactionId: string,
    opts: {
      weightKg?: number | null;
      accountId?: string | null;
      /**
       * A destination typed for this quote alone.
       *
       * Most orders carry no delivery address: they only began accumulating when that work shipped,
       * eBay and OnBuy supply them from the next sync forward, and Amazon's are typed by hand. A
       * quote needs a postcode and a country and nothing else, so refusing one for want of a full
       * address would make this unusable across the whole back catalogue for no benefit.
       *
       * Deliberately NOT written to the order. A postcode alone is not a delivery address, and
       * storing it as though it were would leave a half-address that reads as answered — which
       * booking would then act on.
       */
      postalCode?: string | null;
      countryIso?: string | null;
    } = {},
    companyIds?: string[],
  ) {
    const tx = await this.prisma.salesTransaction.findFirst({
      where: { id: transactionId, deletedAt: null, ...(companyIds ? { companyId: { in: companyIds } } : {}) },
      select: {
        id: true, companyId: true, currency: true,
        deliveryAddress: true,
        destinationCountry: { select: { isoCode: true } },
        items: {
          where: { deletedAt: null },
          select: {
            quantity: true, netSalesAmount: true,
            product: { select: { packageWeightKg: true, productWeightKg: true, title: true } },
          },
        },
      },
    });
    if (!tx) throw new NotFoundException('Sales transaction not found');

    /**
     * A production account, and only an active one.
     *
     * Sandbox is deliberately excluded: it answers with canned data, so a sandbox quote against a
     * real order would put a fictitious price in front of somebody deciding what to charge.
     */
    const accounts = await this.prisma.carrierAccount.findMany({
      where: {
        deletedAt: null, isActive: true, environment: 'production',
        ...(tx.companyId ? { companyId: tx.companyId } : {}),
        ...(opts.accountId ? { id: opts.accountId } : {}),
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    if (accounts.length === 0) {
      return {
        ok: false as const,
        reason: tx.companyId
          ? 'No connected production carrier account for this order\'s company. Add one in Setup → Carrier accounts and test the connection.'
          : 'This order has no company, so there is no carrier account to quote against.',
        quote: null, weightKg: null, accounts: [],
      };
    }
    const account = accounts[0];

    const addr = tx.deliveryAddress;
    // Typed first, then the order's address, then the order's destination country. See
    // resolveQuoteDestination for why that order, and for the tests that keep it.
    const { postalCode, countryIso } = resolveQuoteDestination({
      typedPostalCode: opts.postalCode,
      typedCountryIso: opts.countryIso,
      addressPostalCode: addr?.postalCode,
      addressCountryIso: addr?.countryIso,
      addressPurged: !!addr?.purgedAt,
      orderCountryIso: tx.destinationCountry?.isoCode,
    });

    if (!postalCode || !countryIso) {
      return {
        ok: false as const,
        // Named precisely, because the two gaps have different fixes.
        reason: !countryIso
          ? 'This order has no destination country, so there is nothing to quote against.'
          : 'A postcode is needed to quote. This order has no delivery address — enter a postcode here for a one-off quote, or add the full address on the order.',
        quote: null,
        weightKg: null,
        accounts,
        /** So the screen can say which half is missing rather than implying both are. */
        destination: { postalCode: null, countryIso },
      };
    }

    /**
     * The weight, from the goods themselves where nobody has said otherwise.
     *
     * Package weight in preference to product weight — a quote is for a parcel, not for its
     * contents. Returned alongside the quote so the screen can show what was assumed rather than
     * quietly rating a guess.
     */
    const derived = derivedWeightKg(tx.items.map((it) => ({
      quantity: Number(it.quantity ?? 1),
      packageWeightKg: it.product?.packageWeightKg == null ? null : Number(it.product.packageWeightKg),
      productWeightKg: it.product?.productWeightKg == null ? null : Number(it.product.productWeightKg),
    })));
    const entered = opts.weightKg != null && opts.weightKg > 0;
    const weightKg = entered ? opts.weightKg! : derived.weightKg;
    if (!(weightKg > 0)) {
      return {
        ok: false as const,
        reason: 'None of the products on this order carry a weight, so there is nothing to rate. Enter one to get a quote.',
        quote: null, weightKg: null, accounts,
      };
    }

    /** What the goods are worth, for the customs line on an export. */
    const customsValue = tx.items.reduce((t, it) => t + Number(it.netSalesAmount ?? 0), 0);

    const r = await this.rateQuote(
      account.id,
      {
        recipient: {
          postalCode, countryIso,
          // Business or residential where the address says; carriers rate the two differently.
          residential: addr?.isBusiness == null ? null : !addr.isBusiness,
        },
        parcels: [{ weightKg }],
        customsValue: customsValue > 0 ? { amount: Math.round(customsValue * 100) / 100, currency: tx.currency ?? 'EUR' } : null,
        goodsDescription: tx.items[0]?.product?.title ?? null,
      },
      companyIds,
    );

    return {
      ok: r.ok,
      reason: r.ok ? null : r.message,
      quote: r.quote,
      /** What was rated, so the reader can see the assumption rather than infer it. */
      weightKg,
      weightSource: entered ? ('entered' as const) : ('products' as const),
      /**
       * Lines the catalogue could not weigh, when the weight came from the products.
       *
       * A skipped line makes the total an UNDER-estimate, which is the wrong direction for a cost —
       * and a quote for a parcel lighter than the real one is not visibly wrong, it is simply a
       * cheaper number. Reported so the screen can say the quote is for less than the whole order
       * rather than presenting it as complete.
       */
      linesWithoutWeight: entered ? 0 : derived.linesWithoutWeight,
      destination: { postalCode, countryIso },
      accounts,
      accountId: account.id,
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

  // ------------------------------------------------------------------ tracking

  /**
   * Ask FedEx where some parcels are, and hand back the reply untouched.
   *
   * Unmapped on purpose, for the same reason rating was: FedEx ships sample REQUESTS and no sample
   * responses, and every time this integration guessed at a response shape it was wrong. Unlike
   * booking, though, learning this one costs nothing — tracking is a free read with no side effect,
   * so a single real call against a number we already hold settles it.
   *
   * Numbers are batched to thirty per call by the caller; this sends one batch.
   */
  async trackRaw(accountId: string, numbers: string[], companyIds?: string[]) {
    const account = await this.prisma.carrierAccount.findFirst({
      where: { id: accountId, deletedAt: null, ...(companyIds ? { companyId: { in: companyIds } } : {}) },
      select: { id: true, environment: true, isActive: true },
    });
    if (!account) throw new NotFoundException('Carrier account not found');
    if (!account.isActive) throw new BadRequestException('Test the connection on this account before tracking with it.');

    const body = buildTrackRequest(numbers);
    if (!body.trackingInfo.length) throw new BadRequestException('No tracking numbers to look up.');

    const send = async (token: string) =>
      fetch(`${baseUrlFor(account.environment)}${TRACK_PATH}`, {
        method: 'POST', headers: rateHeaders(token), body: JSON.stringify(body),
      });

    let res = await send(await this.token(accountId));
    if (res.status === 401) res = await send(await this.token(accountId, { force: true }));

    const text = await res.text();
    let parsed: any = null;
    try { parsed = JSON.parse(text); } catch { /* raw below */ }

    if (!res.ok) this.logger.warn(`FedEx tracking failed (${res.status}) on account ${accountId}`);
    return {
      ok: res.ok,
      status: res.status,
      message: res.ok ? null : describeTrackFailure(res.status, parsed),
      request: body,
      response: parsed ?? text.slice(0, 40_000),
    };
  }

  /**
   * Bring stored tracking up to date, for one shipment or for everything that is due.
   *
   * The whole tracking design in one method, so the rules are in one place rather than spread
   * between a cron job and a button:
   *
   *  - **Only FedEx shipments.** The tracking column also holds Cyprus Post numbers, and sending
   *    those to FedEx would produce a few thousand confident "not found"s.
   *  - **The company's own account.** A shipment is tracked with the account belonging to the
   *    company that shipped it, never with whichever one happened to be first.
   *  - **Production accounts only.** Sandbox does not know our parcels; it would answer, and its
   *    answer would be fiction.
   *  - **Numbers are de-duplicated before the call.** Orders that travelled as one parcel share a
   *    number; each shipment row still gets its own answer, but FedEx is asked once.
   *
   * Returns counts rather than rows: this is called by a scheduled sweep as often as by a person,
   * and what a sweep needs to say afterwards is how much it did.
   */
  async refreshTracking(
    opts: {
      /** Refresh these specific shipments. Omitted means everything due. */
      shipmentIds?: string[] | null;
      companyIds?: string[] | null;
      /** Ignore the cadence. What the button on a screen does; never what the sweep does. */
      force?: boolean;
      /** Most shipments to consider in one run. Thirty per FedEx call, so 300 is ten calls. */
      limit?: number;
    } = {},
  ) {
    const now = new Date();
    const limit = Math.min(3_000, Math.max(1, opts.limit ?? 300));

    const candidates = await this.prisma.shipment.findMany({
      where: {
        deletedAt: null,
        trackingNumber: { not: null },
        ...(opts.shipmentIds?.length ? { id: { in: opts.shipmentIds } } : {}),
        // A cheap narrowing on the same fragment isFedexService matches, so that thousands of
        // Cyprus Post rows are not read into memory to be discarded. The predicate below still
        // decides.
        shippingService: {
          is: {
            OR: [
              { name: { contains: FEDEX_NAME_FRAGMENT, mode: 'insensitive' } },
              { alias: { contains: FEDEX_NAME_FRAGMENT, mode: 'insensitive' } },
            ],
          },
        },
        transaction: { deletedAt: null, ...(opts.companyIds ? { companyId: { in: opts.companyIds } } : {}) },
      },
      // Newest first: the parcels somebody is actually waiting on, and the only ones FedEx still
      // holds history for.
      orderBy: { shipmentDate: 'desc' },
      take: limit,
      select: {
        id: true, trackingNumber: true, shipmentDate: true,
        shippingService: { select: { name: true, alias: true } },
        transaction: { select: { companyId: true } },
        tracking: { select: { trackingNumber: true, deliveredAt: true, checkedAt: true, failureCount: true, found: true, detailsJson: true } },
      },
    });

    const due = candidates.filter((s) => {
      if (!isFedexService(s.shippingService?.name, s.shippingService?.alias)) return false;
      /**
       * A corrected tracking number starts again from nothing.
       *
       * Without this, a typo fixed on the shipment would keep the old number's five failures and
       * its "delivered" — a foreign parcel's history, relabelled as this one's and never re-asked.
       */
      const stale = s.tracking && s.tracking.trackingNumber !== s.trackingNumber;
      return dueForRefresh(
        {
          shipmentDate: s.shipmentDate,
          deliveredAt: stale ? null : (s.tracking?.deliveredAt ?? null),
          checkedAt: stale ? null : (s.tracking?.checkedAt ?? null),
          failureCount: stale ? 0 : (s.tracking?.failureCount ?? 0),
          /**
           * Answered before we started keeping the carrier's full reply.
           *
           * `found === true` matters: a number FedEx has never recognised also has no details, and
           * treating that as a backfill would ask about it every two hours instead of every six,
           * burning through its five chances in a morning.
           */
          needsBackfill: !stale && s.tracking?.found === true && s.tracking?.detailsJson == null,
        },
        now,
        { force: !!opts.force },
      );
    });

    const result = {
      considered: candidates.length,
      due: due.length,
      updated: 0,
      delivered: 0,
      notFound: 0,
      /** Shipments whose company has no usable FedEx account — a setting, not a failure. */
      unaccounted: 0,
      /**
       * Asked for, but past what FedEx keeps.
       *
       * Counted separately so a Refresh that does nothing can say WHY. "Nothing new" and "FedEx
       * deleted this history in June" are different answers, and only one of them is worth
       * pressing the button again for.
       */
      outOfRetention: 0,
      /** Calls FedEx refused outright. Separate from notFound, which is per number. */
      failedCalls: 0,
      messages: [] as string[],
    };
    if (opts.shipmentIds?.length) {
      // Only meaningful for a named request: on a sweep, everything old is out of retention and
      // saying so of two thousand shipments every two hours is noise, not information.
      result.outOfRetention = candidates.filter(
        (s) =>
          isFedexService(s.shippingService?.name, s.shippingService?.alias) &&
          !due.includes(s) &&
          (now.getTime() - s.shipmentDate.getTime()) / 86_400_000 > TRACK_HISTORY_DAYS,
      ).length;
    }
    if (!due.length) return result;

    const accounts = await this.prisma.carrierAccount.findMany({
      where: { carrier: 'fedex', environment: 'production', isActive: true, deletedAt: null },
      select: { id: true, companyId: true },
    });
    const accountByCompany = new Map(accounts.map((a) => [a.companyId, a.id]));

    const byCompany = new Map<string, typeof due>();
    for (const s of due) {
      const companyId = s.transaction?.companyId;
      if (!companyId || !accountByCompany.has(companyId)) {
        result.unaccounted += 1;
        continue;
      }
      const list = byCompany.get(companyId) ?? [];
      list.push(s);
      byCompany.set(companyId, list);
    }
    if (byCompany.size === 0 && result.unaccounted) {
      result.messages.push(
        'No active production FedEx account for these shipments’ company. Add one in Setup → Carrier accounts and test it.',
      );
      return result;
    }

    for (const [companyId, shipments] of byCompany) {
      const accountId = accountByCompany.get(companyId)!;
      for (const batch of chunkTrackingNumbers(shipments.map((s) => s.trackingNumber))) {
        let reply: Awaited<ReturnType<CarriersService['trackRaw']>>;
        try {
          reply = await this.trackRaw(accountId, batch);
        } catch (e: any) {
          // One batch failing must not abandon the rest — a sweep that stops at the first refusal
          // leaves everything after it silently un-updated.
          result.failedCalls += 1;
          result.messages.push(e?.message ?? 'FedEx could not be reached.');
          continue;
        }
        if (!reply.ok) {
          /**
           * A refused CALL is not the numbers' fault, so no failure is counted against them.
           *
           * Counting it would retire perfectly good tracking numbers over a FedEx outage — five
           * bad afternoons and a live parcel stops being asked about for good.
           */
          result.failedCalls += 1;
          if (reply.message) result.messages.push(reply.message);
          continue;
        }

        const byNumber = new Map(parseTrackReply(reply.response).map((r) => [r.trackingNumber, r]));
        for (const shipment of shipments) {
          const found = byNumber.get((shipment.trackingNumber ?? '').trim());
          if (!found) continue;
          await this.writeTracking(shipment.id, shipment.trackingNumber!, found, now);
          result.updated += 1;
          if (found.deliveredAt) result.delivered += 1;
          if (!found.found) result.notFound += 1;
        }
      }
    }
    return result;
  }

  /** One shipment's stored tracking, scans and all. Null when nobody has asked FedEx yet. */
  async trackingForShipment(shipmentId: string, companyIds?: string[]) {
    const shipment = await this.prisma.shipment.findFirst({
      where: {
        id: shipmentId, deletedAt: null,
        transaction: { deletedAt: null, ...(companyIds ? { companyId: { in: companyIds } } : {}) },
      },
      select: {
        id: true, trackingNumber: true,
        shippingService: { select: { name: true, alias: true, trackingUrlTemplate: true } },
        tracking: true,
      },
    });
    if (!shipment) throw new NotFoundException('Shipment not found');
    return this.trackingView(shipment);
  }

  /**
   * Every shipment on one order, with what the carrier says about each.
   *
   * Keyed on the transaction because that is the question asked from an order screen — "where is
   * this customer's parcel" — and an order can have gone out in several. Returns a row per
   * shipment, including the ones on carriers we cannot ask, so the screen shows the whole
   * consignment rather than the tracked half of it.
   */
  async trackingForTransaction(transactionId: string, companyIds?: string[]) {
    const tx = await this.prisma.salesTransaction.findFirst({
      where: { id: transactionId, deletedAt: null, ...(companyIds ? { companyId: { in: companyIds } } : {}) },
      select: { id: true },
    });
    if (!tx) throw new NotFoundException('Sales transaction not found');

    const shipments = await this.prisma.shipment.findMany({
      where: { transactionId, deletedAt: null },
      orderBy: [{ shipmentDate: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true, trackingNumber: true, type: true, shipmentDate: true,
        shippingService: { select: { name: true, alias: true, trackingUrlTemplate: true } },
        tracking: true,
      },
    });
    return {
      transactionId,
      shipments: shipments.map((s) => ({
        ...this.trackingView(s),
        type: s.type,
        shipmentDate: s.shipmentDate,
        serviceName: s.shippingService?.name ?? null,
      })),
    };
  }

  /**
   * One shipment's tracking as a screen wants it.
   *
   * The stages are derived here rather than in the browser so that every surface showing this —
   * the shipments log, the order summary, the order form — reads the same journey from the same
   * rule, and that rule has tests.
   */
  private trackingView(shipment: {
    id: string;
    trackingNumber: string | null;
    shippingService?: { name: string | null; alias: string | null; trackingUrlTemplate?: string | null } | null;
    tracking: any;
  }) {
    const t = shipment.tracking ?? null;
    const scans = (Array.isArray(t?.scans) ? t.scans : []) as TrackScan[];
    const stages = t && t.found !== false
      ? trackStages(scans, t.deliveredAt ? new Date(t.deliveredAt).toISOString() : null)
      : [];
    return {
      shipmentId: shipment.id,
      trackingNumber: shipment.trackingNumber,
      /** Who is carrying it, as our people named the service. Shown beside the number. */
      carrier: shipment.shippingService?.name ?? null,
      /**
       * The carrier's own public tracking page for this number.
       *
       * Built from the shipping service's template rather than hardcoded, because that column
       * already exists for exactly this and every courier has a different URL. Null when no
       * template is set, and the screen then shows the number as plain text rather than a link
       * that goes nowhere.
       */
      trackingUrl: buildTrackingUrl(shipment.shippingService?.trackingUrlTemplate, shipment.trackingNumber),
      /** Whether this is a carrier we can ask at all — the screen offers no button when it is not. */
      trackable: isFedexService(shipment.shippingService?.name, shipment.shippingService?.alias),
      tracking: t,
      /** Collected → in transit → out for delivery → delivered. Empty when nobody has asked yet. */
      stages,
      /**
       * The one-line answer in our words, and the tone to say it in.
       *
       * Derived here rather than in the browser so that a screen never parses carrier strings —
       * and so the wording is the same one on every surface.
       */
      pill:
        t && t.found !== false
          ? statusPill({
              statusCode: t.statusCode,
              statusDescription: t.statusDescription,
              deliveredAt: t.deliveredAt ? new Date(t.deliveredAt).toISOString() : null,
              exceptionDescription: t.deliveredAt ? null : t.exceptionDescription,
              stages,
            })
          : null,
      /**
       * When FedEx said it would arrive, whether that was an estimate or a commitment, and whether
       * it was met. Derived here so the distinction is decided once, by a tested rule, rather than
       * three screens each having a go at it.
       */
      promise:
        t && t.found !== false
          ? deliveryPromise(
              t.detailsJson ?? null,
              t.estimatedDeliveryAt ? new Date(t.estimatedDeliveryAt).toISOString() : null,
              t.deliveredAt ? new Date(t.deliveredAt).toISOString() : null,
            )
          : null,
    };
  }

  /**
   * Write what FedEx said, without losing what it said last time.
   *
   * A number that answered yesterday and is refused today keeps its status and its history: the
   * likeliest reason for a miss on a number that used to work is FedEx's ninety-day retention
   * expiring, and blanking a delivered parcel to "unknown" because its history aged out would be a
   * plain loss of information.
   */
  private async writeTracking(shipmentId: string, trackingNumber: string, r: TrackResult, now: Date) {
    const when = (iso: string | null) => (iso ? new Date(iso) : null);

    const common = { checkedAt: now, found: r.found, trackingNumber };
    const data = r.found
      ? {
          ...common,
          statusCode: r.statusCode,
          statusDescription: r.statusDescription,
          deliveredAt: when(r.deliveredAt),
          estimatedDeliveryAt: when(r.estimatedDeliveryAt),
          shippedAt: when(r.shippedAt),
          lastScanAt: when(r.lastScanAt),
          lastScanDescription: r.lastScanDescription,
          lastScanLocation: r.lastScanLocation,
          exceptionCode: r.exceptionCode,
          exceptionDescription: r.exceptionDescription,
          serviceName: r.serviceName,
          weightKg: r.weightKg,
          shipperReference: r.shipperReference,
          scans: r.scans as unknown as Prisma.InputJsonValue,
          // Everything else FedEx sent, redacted upstream. See the column comment for why it is
          // kept whole rather than distilled into more columns.
          detailsJson: (r.details ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          failureCount: 0,
          lastError: null,
        }
      : { ...common, lastError: r.errorMessage ?? r.errorCode, failureCount: { increment: 1 } };

    await this.prisma.shipmentTracking.upsert({
      where: { shipmentId },
      create: {
        shipmentId,
        ...data,
        // `increment` is an update operation and means nothing on a create: the first refusal is
        // simply the first one.
        failureCount: r.found ? 0 : 1,
      },
      update: data,
    });
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
