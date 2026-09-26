import { describe, expect, it } from 'vitest';
import { chooseCategory } from './category-choice';

const utensils = { id: '20635', name: 'Kitchen Utensils', path: 'Home & Garden > Kitchen > Utensils' };
const gadgets = { id: '177', name: 'Kitchen Gadgets', path: 'Home & Garden > Kitchen > Gadgets' };

describe('choosing a category without asking', () => {
  /** Where the marketplace and our own history agree, there is nothing left to decide. */
  it('applies the one both the marketplace and our history point to', () => {
    const c = chooseCategory([gadgets, utensils], { id: '20635', name: 'Kitchen Utensils', uses: 12 });
    expect(c).toMatchObject({ id: '20635', basis: 'agreed', confident: true });
    expect(c.because).toContain('12 of our products');
    // The runner-up stays reachable for anyone who disagrees.
    expect(c.alternatives.map((a) => a.id)).toEqual(['177']);
  });

  /**
   * The one case worth a person. Either the product is not like its siblings or its title is
   * misleading the marketplace; both are settled in seconds by somebody who knows it, and settled
   * wrongly by any rule that picks a winner.
   */
  it('holds back when the marketplace and our history disagree, and shows both', () => {
    const c = chooseCategory([gadgets], { id: '20635', name: 'Kitchen Utensils', uses: 12 });
    expect(c).toMatchObject({ id: null, basis: 'disagreement', confident: false });
    expect(c.because).toContain('takes somebody who knows it');
    expect(c.alternatives.map((a) => a.id)).toEqual(['20635', '177']);
  });

  /**
   * A category is a placement decision, not a fact about the product, and the marketplace is the
   * authority on its own taxonomy — so its suggestion alone is enough for a product of a kind we
   * have never sold.
   */
  it('takes the marketplace’s word for a kind of product we have not sold before', () => {
    const c = chooseCategory([gadgets, utensils], null);
    expect(c).toMatchObject({ id: '177', basis: 'marketplace', confident: true });
    expect(c.because).toContain('not put a product of this kind there before');
  });

  /** One sibling is not a pattern, so it does not outweigh the marketplace. */
  it('does not let a single earlier product outweigh the marketplace', () => {
    const c = chooseCategory([gadgets], { id: '20635', name: 'Kitchen Utensils', uses: 1 });
    expect(c).toMatchObject({ id: '177', basis: 'marketplace', confident: true });
    expect(c.because).toContain('too few');
  });

  it('falls back to what we chose before when the marketplace says nothing', () => {
    const c = chooseCategory([], { id: '20635', name: 'Kitchen Utensils', uses: 4 });
    expect(c).toMatchObject({ id: '20635', basis: 'history', confident: true });
  });

  it('chooses nothing rather than guessing, and says why', () => {
    expect(chooseCategory([], null)).toMatchObject({ id: null, basis: 'nothing', confident: false });
    const thin = chooseCategory([], { id: '20635', name: 'Kitchen Utensils', uses: 1 });
    expect(thin).toMatchObject({ id: null, confident: false });
    expect(thin.because).toContain('too little to choose on');
  });

  it('ignores a suggestion with nothing in it', () => {
    expect(chooseCategory([{ id: '', name: '' }], null).basis).toBe('nothing');
  });
});
