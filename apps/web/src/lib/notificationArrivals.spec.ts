import { describe, expect, it } from 'vitest';
import { MOST_AT_ONCE, countRose, newArrivals } from './notificationArrivals';
import type { NotificationRow } from './api';

const note = (id: string, createdAt: string, readAt: string | null = null): NotificationRow => ({
  id, kind: 'customer_shipment_filed', title: `Shipment ${id}`, body: null, link: `/shipments/${id}`,
  relatedType: 'customerShipment', relatedId: id, readAt, createdAt,
});

describe('countRose', () => {
  it('says nothing about the first count a tab ever sees', () => {
    // Otherwise opening the platform on nine unread announces all nine, which is an inbox, not news.
    expect(countRose(null, 9)).toBe(false);
    expect(countRose(null, 0)).toBe(false);
  });

  it('is true only when the count actually goes up', () => {
    expect(countRose(2, 3)).toBe(true);
    expect(countRose(0, 1)).toBe(true);
    expect(countRose(3, 3)).toBe(false);
    expect(countRose(3, 1)).toBe(false); // read somewhere else
    expect(countRose(1, 0)).toBe(false);
  });
});

describe('newArrivals', () => {
  const seen = new Set<string>();

  it('announces what this tab has not announced', () => {
    expect(newArrivals(seen, [note('a', '2026-09-18T10:00:00Z')]).map((n) => n.id)).toEqual(['a']);
  });

  it('never announces the same one twice', () => {
    expect(newArrivals(new Set(['a']), [note('a', '2026-09-18T10:00:00Z')])).toEqual([]);
  });

  it('ignores anything already read', () => {
    expect(newArrivals(seen, [note('a', '2026-09-18T10:00:00Z', '2026-09-18T10:01:00Z')])).toEqual([]);
  });

  it('puts the newest first — that is the one somebody is waiting for', () => {
    const items = [note('old', '2026-09-18T08:00:00Z'), note('new', '2026-09-18T12:00:00Z')];
    expect(newArrivals(seen, items).map((n) => n.id)).toEqual(['new', 'old']);
  });

  it('stops at a few, because past that the badge is the better tool', () => {
    const many = Array.from({ length: 9 }, (_, i) => note(`n${i}`, `2026-09-18T1${i}:00:00Z`));
    expect(newArrivals(seen, many)).toHaveLength(MOST_AT_ONCE);
  });

  it('does not mutate what it was given', () => {
    const items = [note('old', '2026-09-18T08:00:00Z'), note('new', '2026-09-18T12:00:00Z')];
    newArrivals(seen, items);
    expect(items.map((n) => n.id)).toEqual(['old', 'new']);
  });

  it('copes with an empty list', () => {
    expect(newArrivals(seen, [])).toEqual([]);
  });
});
