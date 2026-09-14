import { describe, expect, it } from 'vitest';
import { isStaleWrite } from './stale-write';

const SAVED = new Date('2026-09-14T18:34:51.123Z');

describe('isStaleWrite', () => {
  it('lets a save through when the product is exactly as the card saw it', () => {
    expect(isStaleWrite(SAVED, '2026-09-14T18:34:51.123Z')).toBe(false);
  });

  /** The incident: research wrote the description after the card opened, and the card saved over it. */
  it('refuses a save onto a product that changed after the card opened', () => {
    expect(isStaleWrite(SAVED, '2026-09-14T17:13:57.898Z')).toBe(true);
  });

  it('notices a change of a single millisecond', () => {
    expect(isStaleWrite(SAVED, '2026-09-14T18:34:51.122Z')).toBe(true);
  });

  /** The same instant in another timezone is not a change; refusing it would block every save. */
  it('treats the same moment written in another timezone as unchanged', () => {
    expect(isStaleWrite(SAVED, '2026-09-14T21:34:51.123+03:00')).toBe(false);
  });

  /** Bulk edits and imports send no timestamp and must keep working exactly as before. */
  it('does not check a caller that did not say when it last saw the product', () => {
    expect(isStaleWrite(SAVED, undefined)).toBe(false);
    expect(isStaleWrite(SAVED, null)).toBe(false);
    expect(isStaleWrite(SAVED, '')).toBe(false);
  });

  it('does not block on an unreadable timestamp', () => {
    expect(isStaleWrite(SAVED, 'not a date')).toBe(false);
  });

  it('is safe when there is no stored timestamp to compare with', () => {
    expect(isStaleWrite(null, '2026-09-14T18:34:51.123Z')).toBe(false);
  });
});
