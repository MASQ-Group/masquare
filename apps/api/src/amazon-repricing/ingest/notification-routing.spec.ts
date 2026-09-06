import { describe, expect, it } from 'vitest';
import { SnapshotService } from './snapshot.service';

/**
 * Routing a notification by its type, so a heartbeat is never reported as breakage.
 *
 * From the production logs on 6 Sep 2026, arriving steadily:
 *
 *   ERROR [SqsPollerService] Discarding unparseable SQS message …:
 *         ANY_OFFER_CHANGED missing MarketplaceId
 *
 * Nothing was broken. ORDER_CHANGE is subscribed deliberately — it fires on ordinary daily sales
 * and is the only proof the Amazon → SQS path is alive when pricing notifications are quiet. But
 * the router only knew PricingHealth and FeePromotion and sent everything else to the
 * ANY_OFFER_CHANGED parser, which naturally found no OfferChangeTrigger and blamed a message that
 * was never an offer change.
 *
 * The cost was not the wasted parse. It was the error log: the diagnostics panel read the discard
 * counter and announced "Messages ARE arriving but every one failed to parse and was discarded",
 * so the control we added to prove the path WORKS was reporting that it was broken. An error that
 * cries wolf is one nobody reads when something real breaks.
 *
 * Only an ABSENT type still falls through to ANY_OFFER_CHANGED — Amazon does send AOC-shaped
 * bodies without one. A named type we do not handle is now reported by name.
 */

// The router is pure with respect to its dependencies for every non-AOC branch: it reads the
// envelope and returns. Constructing with nulls exercises exactly those branches.
const router = new SnapshotService(null as never, null as never, null as never);

const body = (o: unknown) => JSON.stringify(o);

describe('routing an SP-API notification', () => {
  it('treats ORDER_CHANGE as a heartbeat, not a failure', async () => {
    const r = await router.ingestRaw(body({
      NotificationType: 'ORDER_CHANGE',
      EventTime: '2026-09-06T12:09:39Z',
      Payload: { OrderChangeNotification: { AmazonOrderId: '303-1234567-1234567' } },
    }));
    expect(r.status).toBe('IGNORED');
    expect(r.status === 'IGNORED' && r.reason).toMatch(/heartbeat/i);
  });

  it('accepts Amazon’s other spelling of it', async () => {
    const r = await router.ingestRaw(body({ NotificationType: 'OrderChange', Payload: {} }));
    expect(r.status).toBe('IGNORED');
  });

  it('names an unhandled type instead of blaming ANY_OFFER_CHANGED', async () => {
    const r = await router.ingestRaw(body({ NotificationType: 'LISTINGS_ITEM_STATUS_CHANGE', Payload: {} }));
    expect(r.status).toBe('IGNORED');
    expect(r.status === 'IGNORED' && r.reason).toContain('LISTINGS_ITEM_STATUS_CHANGE');
  });

  it('still parses an AOC body that carries no type at all', async () => {
    // Amazon does send these. The fallback has to survive, so the fix cannot be "route strictly".
    const r = await router.ingestRaw(body({ Payload: { AnyOfferChangedNotification: {} } }));
    expect(r.status).toBe('PARSE_ERROR');
    expect(r.status === 'PARSE_ERROR' && r.detail).toMatch(/missing MarketplaceId/);
  });

  it('still reports a genuinely malformed ANY_OFFER_CHANGED', async () => {
    // The error message must keep working for the case it was written for.
    const r = await router.ingestRaw(body({
      NotificationType: 'ANY_OFFER_CHANGED',
      Payload: { AnyOfferChangedNotification: { SellerId: 'A1', OfferChangeTrigger: { ASIN: 'B000' } } },
    }));
    expect(r.status).toBe('PARSE_ERROR');
    expect(r.status === 'PARSE_ERROR' && r.detail).toMatch(/missing MarketplaceId/);
  });

  describe('delivered through SNS rather than straight to SQS', () => {
    it('unwraps the notification from the SNS Message string', async () => {
      // SP-API can publish to an SNS topic that fans out to the queue. The body is then SNS's own
      // envelope with the real notification as a JSON STRING inside `Message` — no NotificationType
      // and no Payload at the top level, so it fell through to the ANY_OFFER_CHANGED parser and
      // failed with `missing MarketplaceId`, naming a type the message never claimed to be.
      const inner = JSON.stringify({ NotificationType: 'ORDER_CHANGE', Payload: { OrderChangeNotification: {} } });
      const r = await router.ingestRaw(body({ Type: 'Notification', TopicArn: 'arn:aws:sns:…', Message: inner }));
      expect(r.status).toBe('IGNORED');
      expect(r.status === 'IGNORED' && r.reason).toMatch(/heartbeat/i);
    });

    it('leaves a direct SP-API body untouched', async () => {
      // Unwrapping must be a no-op when it does not apply, or it breaks the working path.
      const r = await router.ingestRaw(body({ NotificationType: 'ORDER_CHANGE', Payload: {} }));
      expect(r.status).toBe('IGNORED');
    });

    it('ignores an SNS subscription handshake', async () => {
      const r = await router.ingestRaw(body({ Type: 'SubscriptionConfirmation', Token: 'abc', TopicArn: 'arn:…' }));
      expect(r.status).toBe('IGNORED');
      expect(r.status === 'IGNORED' && r.reason).toMatch(/SubscriptionConfirmation/);
    });

    it('says so when the SNS Message is not JSON', async () => {
      const r = await router.ingestRaw(body({ Type: 'Notification', Message: 'plain text' }));
      expect(r.status).toBe('PARSE_ERROR');
      expect(r.status === 'PARSE_ERROR' && r.detail).toMatch(/SNS Message is not JSON/);
    });
  });

  it('names the shape it could not read, so the next one identifies itself', async () => {
    // The previous fix was deployed on a wrong diagnosis and the error came straight back with
    // nothing new to go on. A parse failure now carries the type and the top-level keys — the
    // shape, never the contents, so no order or customer data reaches the log.
    const r = await router.ingestRaw(body({ Payload: {}, EventTime: '2026-09-06T12:00:00Z' }));
    expect(r.status).toBe('PARSE_ERROR');
    expect(r.status === 'PARSE_ERROR' && r.detail).toMatch(/type=\(absent\)/);
    expect(r.status === 'PARSE_ERROR' && r.detail).toMatch(/keys=\[Payload,EventTime\]/);
  });

  it('reports invalid JSON as such', async () => {
    const r = await router.ingestRaw('not json at all');
    expect(r.status).toBe('PARSE_ERROR');
    expect(r.status === 'PARSE_ERROR' && r.detail).toMatch(/invalid JSON/);
  });

  it('never routes a heartbeat into the parse-error path', async () => {
    // The property that matters: whatever else changes, ORDER_CHANGE must not raise an error,
    // because the discard counter drives the "pipeline is broken" diagnosis.
    for (const type of ['ORDER_CHANGE', 'OrderChange']) {
      const r = await router.ingestRaw(body({ NotificationType: type, Payload: {} }));
      expect(r.status).not.toBe('PARSE_ERROR');
    }
  });
});
