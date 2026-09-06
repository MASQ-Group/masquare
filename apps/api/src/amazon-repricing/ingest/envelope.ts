import type { RawNotificationEnvelope } from './any-offer-changed.types';

/**
 * One shape for a notification envelope, whatever case Amazon sent it in.
 *
 * SP-API delivers the ENVELOPE in camelCase:
 *
 *   { notificationVersion, notificationType, payloadVersion, eventTime,
 *     notificationMetadata, payload }
 *
 * while everything downstream was written against PascalCase — `NotificationType`, `Payload`. The
 * two never met. `NotificationType` was undefined on every message, so every message fell through
 * to the ANY_OFFER_CHANGED parser, where `Payload` was undefined too and it died with
 * `missing MarketplaceId`.
 *
 * That was not a heartbeat being noisy. It was EVERY notification being discarded, ANY_OFFER_CHANGED
 * among them — the repricer had no market data arriving at all, and the only symptom was an error
 * naming a field.
 *
 * Found by logging the top-level keys of a message that would not parse. Three deploys went out on
 * hypotheses before that; the log settled it in one.
 *
 * Both casings are accepted rather than swapping one for the other: Amazon has used PascalCase in
 * the past, the recorded fixtures use it, and a parser that only understands today's spelling is
 * the same bug facing the other way.
 */
export function normaliseEnvelope(raw: unknown): RawNotificationEnvelope {
  if (!raw || typeof raw !== 'object') return {} as RawNotificationEnvelope;
  const src = raw as Record<string, unknown>;

  // Case-insensitive lookup: the only thing that varies is the first letter, but matching the whole
  // key without regard to case costs nothing and cannot be caught out by a future `NotificationtYpe`.
  const pick = (...names: string[]): unknown => {
    for (const name of names) {
      const hit = Object.keys(src).find((k) => k.toLowerCase() === name.toLowerCase());
      if (hit !== undefined && src[hit] !== undefined) return src[hit];
    }
    return undefined;
  };

  // Only keys that actually arrived are set. Writing `NotificationType: undefined` would still
  // create the property, and the parse-failure log prints the envelope's keys — so placeholders
  // would pollute the one diagnostic that identified this bug in the first place.
  const out: Record<string, unknown> = { ...src };
  for (const name of ['NotificationType', 'EventTime', 'PayloadVersion', 'Payload', 'NotificationMetadata']) {
    const value = pick(name);
    if (value !== undefined) out[name] = value;
  }
  return out as RawNotificationEnvelope;
}
