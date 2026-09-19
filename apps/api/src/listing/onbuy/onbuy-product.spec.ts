import { describe, expect, it } from 'vitest';
import {
  buildOnbuyProductBody, missingForOnbuyProduct, parseOnbuyCategories, readOnbuyProductSubmit, readOnbuyQueue,
  suggestOnbuyCategory, type OnbuyProductInput,
} from './onbuy-product';
import type { OnbuyListingInput } from './onbuy-listing';

const product: OnbuyProductInput = {
  categoryId: '3428', name: 'Beurer MG 21 Handheld Massager, Infrared Heat', description: '<p>A handheld massager.</p>',
  summaryPoints: ['One', 'Two', 'Three', 'Four', 'Five', 'Six'], brandName: 'Beurer', productCode: '4211125646076', mpn: 'MG21',
  images: ['https://cdn/a.jpg', 'https://cdn/b.jpg'], uid: 'LE-83306',
  features: [], technical: [], productData: [], safety: null, safetyDocuments: [], aiModel: null,
};
const listing: OnbuyListingInput = {
  opc: null, sku: 'LE-83306', condition: 'NEW', price: 24.99, stock: 5, deliveryTemplateId: '245', handlingTimeDays: 1, boostPct: 0,
};

describe('OnBuy categories', () => {
  it('keeps only categories a product can be created in', () => {
    const c = parseOnbuyCategories({ results: [
      { category_id: 2144, name: 'Baby & Toddler', category_tree: '', can_list_in: false },
      { category_id: 3428, name: "Men's Sweatshirts", category_tree: 'Clothing > Men', can_list_in: 1 },
    ] });
    expect(c).toEqual([{ id: '3428', name: "Men's Sweatshirts", tree: 'Clothing > Men', canListIn: true }]);
  });
});

describe('what a new product still needs', () => {
  it('needs nothing when every piece is there', () => {
    expect(missingForOnbuyProduct(product, listing, { contentGaps: [] })).toEqual([]);
  });

  it('refuses without the OnBuy content — never the internal name', () => {
    const gaps = missingForOnbuyProduct({ ...product, name: null, description: null }, listing, { contentGaps: [] });
    expect(gaps).toEqual(['the OnBuy title — write it on the OnBuy content tab', 'the OnBuy description — write it on the OnBuy content tab']);
  });

  it('passes on what the OnBuy content still lacks, such as a required feature', () => {
    expect(missingForOnbuyProduct(product, listing, { contentGaps: ['OnBuy field "Size" — answer it on the OnBuy content tab'] }))
      .toEqual(['OnBuy field "Size" — answer it on the OnBuy content tab']);
  });

  it('needs the listing terms too, since the listing goes with the product', () => {
    const gaps = missingForOnbuyProduct(product, { ...listing, price: null, deliveryTemplateId: null }, { contentGaps: [] });
    expect(gaps).toEqual(['a price', 'an OnBuy delivery template']);
  });
});

describe('the product request', () => {
  it('carries OnBuy’s field names, the featured image first, and our listing inside', () => {
    const body = buildOnbuyProductBody(product, listing);
    expect(body).toMatchObject({
      uid: 'LE-83306', category_id: 3428, published: 1,
      product_name: 'Beurer MG 21 Handheld Massager, Infrared Heat', brand_name: 'Beurer',
      product_codes: ['4211125646076'], mpn: 'MG21',
      default_image: 'https://cdn/a.jpg', additional_images: ['https://cdn/b.jpg'],
      listings: { new: { sku: 'LE-83306', price: 24.99, stock: 5, delivery_template_id: 245, handling_time: 1, boost_marketing_commission: 0 } },
    });
    expect((body.summary_points as string[]).length).toBe(5);
    // Nothing researched, nothing written by AI: none of the optional parts are sent.
    for (const key of ['features', 'technical_detail', 'product_data', 'safety_content', 'safety_documents', 'ai_content_marked']) {
      expect(body).not.toHaveProperty(key);
    }
  });

  it('sends the researched fields, the spec table, safety data and the AI flag when there are some', () => {
    const body = buildOnbuyProductBody({
      ...product,
      features: [{ option_id: 11 }],
      technical: [{ detail_id: 4, value: '52', unit: 'cm' }],
      productData: [{ label: 'Colour', value: 'Black' }],
      safety: { warnings: 'Not for children.' },
      safetyDocuments: [{ label: 'Manual', url: 'https://cdn/manual.pdf', language: 'en' }],
      aiModel: 'Claude Opus 5',
    }, listing);
    expect(body).toMatchObject({
      features: [{ option_id: 11 }],
      technical_detail: [{ detail_id: 4, value: '52', unit: 'cm' }],
      product_data: [{ label: 'Colour', value: 'Black' }],
      safety_content: { warnings: 'Not for children.' },
      safety_documents: [{ label: 'Manual', url: 'https://cdn/manual.pdf', language: 'en' }],
      ai_content_marked: true,
      ai_content_model_used: 'Claude Opus 5',
    });
  });
});

describe('reading OnBuy’s replies', () => {
  it('reads the queue id from a submit', () => {
    expect(readOnbuyProductSubmit({ results: [{ success: true, queue_id: '6895d9', uid: 'LE-83306' }] })).toEqual({ ok: true, queueId: '6895d9', message: null });
  });

  it('reports a submit refusal in OnBuy’s words', () => {
    expect(readOnbuyProductSubmit({ results: [{ success: false, message: 'Invalid category' }] })).toEqual({ ok: false, queueId: null, message: 'Invalid category' });
  });

  it('reads pending, success and failed queue entries', () => {
    expect(readOnbuyQueue({ results: { queue_id: 'q1', status: 'pending' } }, 'q1').status).toBe('pending');
    expect(readOnbuyQueue({ results: { queue_id: 'q1', status: 'success', opc: 'PRMH5GH', product_url: 'https://onbuy.com/gb/p/x' } }, 'q1'))
      .toEqual({ status: 'success', opc: 'PRMH5GH', productUrl: 'https://onbuy.com/gb/p/x', message: null });
    expect(readOnbuyQueue({ results: [{ queue_id: 'q1', status: 'failed', error_message: 'Error downloading image' }] }, 'q1'))
      .toMatchObject({ status: 'failed', message: 'Error downloading image' });
  });
});

describe('the category suggestion', () => {
  const d = (s: string) => new Date(s);
  it('is the category most used by products in the same internal category', () => {
    expect(suggestOnbuyCategory([
      { categoryRef: '100', categoryName: 'A', updatedAt: d('2026-09-01') },
      { categoryRef: '200', categoryName: 'B', updatedAt: d('2026-09-10') },
      { categoryRef: '100', categoryName: 'A', updatedAt: d('2026-09-02') },
    ])).toEqual({ id: '100', tree: 'A', uses: 2 });
  });

  it('is nothing when no product has one yet', () => {
    expect(suggestOnbuyCategory([{ categoryRef: null, categoryName: null, updatedAt: d('2026-09-01') }])).toBeNull();
  });
});
