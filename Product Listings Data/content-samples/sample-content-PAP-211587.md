# Content sample for review — product 1 of 1,174

**SKU:** `PAP-211587`  ·  **Manufacturer SKU:** 211587  ·  **EAN:** 5201347176341  ·  **Brand:** Air Wick
**Source title:** `Air Wick 211587 Essential Oil Candle Amber Rose 105G`
**Category:** Cleaning, Hygiene & Janitorial › Waste, Bags & Air Care › Air Fresheners & Home Fragrance
**Product type:** Home Fragrance

---

## 1. Product Title

```
Air Wick Essential Oils Scented Candle, Warm Amber Rose, 105 g
```
*62 characters.*

> **Note:** the source title says "Amber Rose". The manufacturer's name for this variant is **Warm Amber Rose**, confirmed across UK retail listings for the same 105 g product. Using the official name helps search. Say the word and I'll keep the source wording instead.

## 2. eBay Title

```
Air Wick Essential Oils Scented Candle Warm Amber Rose 105g Home Fragrance
```
*73 characters — inside eBay's 80-character limit. No punctuation, keywords front-loaded.*

## 3. Short Description

**Rendered:**

Scented candle from Air Wick's Essential Oils range, 105 g.

- Warm Amber Rose fragrance
- Part of the Air Wick Essential Oils range
- 105 g net weight

**HTML:**

```html
<p>Scented candle from Air Wick's Essential Oils range, 105 g.</p>
<ul>
  <li>Warm Amber Rose fragrance</li>
  <li>Part of the Air Wick Essential Oils range</li>
  <li>105 g net weight</li>
</ul>
```
*Opening sentence 58 characters (limit 80). Bullets 25 / 41 / 16 characters (limit 75).*

## 4. Long Description

**HTML:**

```html
<h2>Overview</h2>
<p>A 105 g scented candle from Air Wick's Essential Oils range, in the Warm Amber Rose
fragrance. Supplied as a single candle in retail packaging.</p>

<h2>Fragrance</h2>
<p>Warm Amber Rose is an amber and rose blend. It is one of the fragrances in Air Wick's
Essential Oils candle range.</p>

<h2>What's in the box</h2>
<ul>
  <li>1 x Air Wick Essential Oils Scented Candle, Warm Amber Rose, 105 g</li>
</ul>
```

## 5. Key Features

| # | Feature | Chars |
| :-- | :--- | --: |
| 1 | Warm Amber Rose fragrance | 25 |
| 2 | Air Wick Essential Oils range | 29 |
| 3 | 105 g net weight | 16 |
| 4 | Single scented candle | 21 |
| 5 | *(not written — see note)* | — |

> **Note:** the guide asks for 5. Four are defensible from the source data. A fifth would have to be
> invented — burn time, wick count, wax type, container material. See "The problem to solve" below.

## 6. Product Specifications

**Rendered:**

| Product | |
| :--- | :--- |
| Brand | Air Wick |
| Range | Essential Oils |
| Product type | Scented candle |

| Fragrance | |
| :--- | :--- |
| Fragrance | Warm Amber Rose |

| Physical | |
| :--- | :--- |
| Net weight | 105 g |

| Identifiers | |
| :--- | :--- |
| Manufacturer code | 211587 |
| EAN | 5201347176341 |

**HTML:**

```html
<table>
  <tbody>
    <tr><th colspan="2">Product</th></tr>
    <tr><td>Brand</td><td>Air Wick</td></tr>
    <tr><td>Range</td><td>Essential Oils</td></tr>
    <tr><td>Product type</td><td>Scented candle</td></tr>
    <tr><th colspan="2">Fragrance</th></tr>
    <tr><td>Fragrance</td><td>Warm Amber Rose</td></tr>
    <tr><th colspan="2">Physical</th></tr>
    <tr><td>Net weight</td><td>105 g</td></tr>
    <tr><th colspan="2">Identifiers</th></tr>
    <tr><td>Manufacturer code</td><td>211587</td></tr>
    <tr><td>EAN</td><td>5201347176341</td></tr>
  </tbody>
</table>
```

---

## The problem to solve before the other 1,173

The two briefs in the folder ask for opposite things, and this product shows exactly where they collide.

`product_listings_content_guide.txt` asks for **"all the technical specifications you believe are
important for a potential customer to view"**, organised into sections, plus a mandatory **"What's in
the box"**, plus **5** key features.

`HANDOVER-catalogue-copywriting.md` says: **"You have a title, a brand and a code. You do not have the
wattage, the capacity, the torque, the dimensions, the materials, the warranty, the certifications, or
what is in the box. Do not write any of them."**

Both cannot be satisfied from the CSV alone. The CSV gives six columns, and `product_type` is populated
on only 78 of 1,174 rows. For this candle, everything above is derived from six words in the title plus
the brand — which is why the spec table has seven rows and the fifth key feature is blank.

For a candle, a thin spec table is survivable. For a `Bosch SMS4ENI06E Freestanding Dishwasher 60cm`, a
trade buyer needs place settings, energy class, noise level, programmes and water consumption — and a
spec table without them is not worth publishing. Roughly a third of the catalogue is a bare title with
no brand at all.

### Three ways forward

**A. Honest-only.** Write from the source data alone, exactly as above. Spec tables carry 5–10 rows;
many long descriptions and fifth features come back empty. Fast — the whole catalogue in one pass, no
per-product research. Nothing on the site is wrong, but the specification tables will look sparse next
to a competitor's.

**B. Research-enriched.** Look up each product against manufacturer and retailer sources, and build
real spec tables from what is found, with a source recorded per product. Genuinely useful listings.
Slow and not free: 1,174 products, several lookups each, and coverage will be partial — obscure and
unbranded lines (the Cyprus BBQ sets, the paper cups, the 284 unbranded SKUs) will return nothing.

**C. Hybrid — my recommendation.** Research the products where specifications drive the purchase and
the data is findable: branded appliances, electronics, IT, personal care — roughly 600–700 SKUs. Write
honest-only content for the rest, where the title genuinely is the product: disposables, paper,
cleaning chemicals, spare parts, unbranded lines. Every field is either sourced or empty, never guessed.

I'd also suggest, for whichever route you pick, that the returned data carries a `data_source` field per
product (`source_title`, `manufacturer_site`, `retailer_listing`) so anything unverified can be found
and re-checked later rather than being indistinguishable from confirmed fact.

### What I found on this product but did not use

One UK retailer lists dimensions of 7.4 × 7.4 × 8 cm and a weight of 0.267 kg for this candle. That is
almost certainly the outer carton, not the candle, and it is a single unverified retail source — so it
is not in the table above. This is what "research-enriched" runs into constantly: data exists, but
needs a judgement about whether it is trustworthy enough to publish as your representation to a trade
buyer.
