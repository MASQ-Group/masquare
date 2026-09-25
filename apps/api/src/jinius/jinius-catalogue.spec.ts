import { describe, expect, it } from 'vitest';
import {
  offerReferenceTypes, readImportPermission, readJiniusAttributes, readJiniusHierarchies, readJiniusOfferAttachments,
  readJiniusProductMatches, readLookupAnswer, requiredAttributes, type JiniusLookupAttempt,
} from './jinius-catalogue';

describe('the category tree', () => {
  it('reads the categories, keeping which are ends of a branch', () => {
    const { categories, total } = readJiniusHierarchies({
      total_count: 2,
      hierarchies: [
        { code: 'ELECTRONICS', label: 'Electronics', level: 1, leaf: false },
        { code: 'ELECTRONICS_KETTLES', label: 'Kettles', level: 2, leaf: true },
      ],
    });
    expect(total).toBe(2);
    expect(categories[1]).toEqual({ code: 'ELECTRONICS_KETTLES', label: 'Kettles', level: 2, leaf: true });
  });

  it('is safe on an answer that carries nothing', () => {
    expect(readJiniusHierarchies(null).categories).toEqual([]);
  });
});

describe('what a category demands', () => {
  const answer = {
    attributes: [
      { code: 'BRAND', label: 'Brand', requirement_level: 'REQUIRED', type: 'TEXT' },
      { code: 'COLOUR', label: 'Colour', requirement_level: 'OPTIONAL', type: 'LIST', values_list: 'COLOURS', hierarchy_code: 'KETTLES' },
      { code: 'LEGACY', label: 'Legacy', requirement_level: 'DISABLED', type: 'TEXT' },
    ],
  };

  /** A disabled attribute is one the operator has switched off: offering it would waste a person's time. */
  it('keeps what can be answered, and separates what must be', () => {
    const attrs = readJiniusAttributes(answer);
    expect(attrs.map((a) => a.code)).toEqual(['BRAND', 'COLOUR']);
    expect(requiredAttributes(attrs).map((a) => a.code)).toEqual(['BRAND']);
    expect(attrs[1]).toMatchObject({ valuesList: 'COLOURS', hierarchy: 'KETTLES', variant: false });
  });
});

describe('looking our products up in their catalogue', () => {
  const asked = ['4211125646076', '7611160123459'];
  const answer = {
    products: [{
      product_id: 'PRD-88', product_id_type: 'SHOP_SKU', product_sku: 'JIN-88', product_title: 'Card wallet',
      category_code: 'WALLETS', category_label: 'Wallets',
      product_references: [{ reference_type: 'EAN', reference: '4211125646076' }],
    }],
  };

  /**
   * The half that matters is what Mirakl does NOT answer: a barcode missing from the reply is a
   * product the marketplace does not carry, which is the one we would have to create.
   */
  it('says which barcodes they carry and which they do not', () => {
    const matches = readJiniusProductMatches(answer, asked);
    expect(matches[0]).toMatchObject({ found: true, productId: 'PRD-88', productIdType: 'SHOP_SKU', categoryCode: 'WALLETS' });
    expect(matches[1]).toMatchObject({ reference: '7611160123459', found: false, productId: null });
  });

  it('is safe when they answer with nothing at all', () => {
    expect(readJiniusProductMatches(null, asked).every((m) => !m.found)).toBe(true);
  });
});

describe('whether we may add products to their catalogue', () => {
  it('reads a refusal as the answer it is, not as an error', () => {
    expect(readImportPermission(200)).toMatchObject({ allowed: true });
    expect(readImportPermission(403).detail).toContain('only list against products Jinius already carries');
    expect(readImportPermission(404).allowed).toBe(false);
    expect(readImportPermission(500).detail).toContain('500');
  });
});


describe('what our own live offers are attached to', () => {
  /**
   * The decisive read: an offer that is live on Jinius names something Jinius recognises, so whatever
   * reference it carries is the one a new offer would have to be created against.
   */
  it('reads the reference each offer carries, however the operator spells the pair', () => {
    const rows = readJiniusOfferAttachments({
      offers: [
        {
          shop_sku: 'IT49693', product_sku: 'JIN-4410', product_title: 'Sage Barista Express',
          product_references: [{ reference_type: 'ean', reference: '9312432030144' }],
        },
        // Some operators answer with the other spelling, and some carry nothing at all.
        { shop_sku: 'IT57697', product_sku: 'JIN-9001', product_references: [{ type: 'SHOP_SKU', value: 'IT57697' }] },
        { shop_sku: 'RE-S8540', product_sku: 'JIN-7', product_references: [] },
      ],
    });
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ shopSku: 'IT49693', productSku: 'JIN-4410', references: [{ type: 'EAN', value: '9312432030144' }] });
    expect(rows[1].references[0]).toEqual({ type: 'SHOP_SKU', value: 'IT57697' });
    expect(rows[2].references).toEqual([]);
    expect(offerReferenceTypes(rows)).toEqual(['EAN', 'SHOP_SKU']);
  });

  /** No reference anywhere is itself the answer: their catalogue is not keyed on barcodes. */
  it('says nothing rather than guessing when the offers carry no reference', () => {
    expect(offerReferenceTypes(readJiniusOfferAttachments({ offers: [{ shop_sku: 'A1' }] }))).toEqual([]);
    expect(readJiniusOfferAttachments(null)).toEqual([]);
  });
});


describe('what the lookups add up to', () => {
  const attempt = (o: Partial<JiniusLookupAttempt>): JiniusLookupAttempt => ({
    how: 'x', kind: 'single', encoding: 'encoded', type: 'EAN', asked: 1, status: 200, products: 0, excerpt: '', ...o,
  });

  /**
   * The case this was written for. Every reference asked about is off a live offer, so an empty
   * answer is about how we asked - and reporting it as "they do not carry it" is reporting our own
   * bug as their catalogue.
   */
  it('names the encoding as the fault when a list works only as documented', () => {
    const a = readLookupAnswer([
      attempt({ kind: 'single', encoding: 'encoded', products: 1 }),
      attempt({ kind: 'list', encoding: 'encoded', asked: 3, products: 0 }),
      attempt({ kind: 'list', encoding: 'documented', asked: 3, products: 3 }),
    ]);
    expect(a).toMatchObject({ works: true, sendUnencoded: true, askOneAtATime: false, type: 'EAN' });
    expect(a.message).toContain('unencoded');
  });

  it('says to ask one at a time when no list works but a single does', () => {
    const a = readLookupAnswer([
      attempt({ kind: 'single', products: 1 }),
      attempt({ kind: 'list', encoding: 'encoded', asked: 3, products: 0 }),
      attempt({ kind: 'list', encoding: 'documented', asked: 3, products: 0 }),
    ]);
    expect(a).toMatchObject({ works: true, askOneAtATime: true, sendUnencoded: false });
    expect(a.message).toContain('one barcode per request');
  });

  it('leaves well alone when the list already works as we send it', () => {
    const a = readLookupAnswer([attempt({ kind: 'list', encoding: 'encoded', asked: 3, products: 3 })]);
    expect(a).toMatchObject({ works: true, askOneAtATime: false, sendUnencoded: false });
  });

  /** Nothing anywhere is an answer too: match-and-list is not the road, product import is. */
  it('reads a wholly empty result as their search being closed to us', () => {
    const a = readLookupAnswer([attempt({ products: 0 }), attempt({ kind: 'list', products: 0 })]);
    expect(a.works).toBe(false);
    expect(a.message).toContain('product import');
    expect(readLookupAnswer([]).message).toContain('nothing live to look up with');
  });
});
