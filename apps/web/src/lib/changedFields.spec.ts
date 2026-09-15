import { describe, expect, it } from 'vitest';
import { changedFields } from './changedFields';

const OPENED = {
  title: 'Casio Collection Watch',
  descriptionHtml: null as string | null,
  keyFeatures: [] as string[],
  purchaseCost: { amount: 12.5, currency: 'EUR' },
  aliases: [{ skuValue: 'LAG-A158WEA-9EF' }],
};

describe('changedFields', () => {
  /** The incident: a card opened before research wrote the description must not send it back empty. */
  it('leaves out a field nobody edited, so the card cannot put an old value back', () => {
    const now = { ...OPENED, title: 'Casio Vintage Watch' };
    expect(changedFields(OPENED, now)).toEqual({ title: 'Casio Vintage Watch' });
  });

  it('sends nothing when nothing was edited', () => {
    expect(changedFields(OPENED, { ...OPENED })).toEqual({});
  });

  it('treats a list or object rebuilt with the same contents as unchanged', () => {
    const now = { ...OPENED, keyFeatures: [], purchaseCost: { amount: 12.5, currency: 'EUR' }, aliases: [{ skuValue: 'LAG-A158WEA-9EF' }] };
    expect(changedFields(OPENED, now)).toEqual({});
  });

  it('sends a field that was deliberately cleared', () => {
    const opened = { ...OPENED, descriptionHtml: '<p>Written</p>' as string | null };
    expect(changedFields(opened, { ...opened, descriptionHtml: null })).toEqual({ descriptionHtml: null });
  });

  it('sends a whole list when one entry in it changed', () => {
    const now = { ...OPENED, keyFeatures: ['Water resistant'] };
    expect(changedFields(OPENED, now)).toEqual({ keyFeatures: ['Water resistant'] });
  });
});
