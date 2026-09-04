# Handover — catalogue copywriting

Attach `catalogue-for-copywriting.csv` (1,174 products) to the chat alongside this brief.

The output comes back to Claude Code, which writes it into the platform. So the return format below is
a contract, not a suggestion — anything that deviates has to be reconciled by hand across 1,174 rows.

---

## What you are writing

For each product: a **title**, a **short description**, a **long description**, and **key features**.

These appear on an invite-only B2B webstore whose customers are trade buyers — resellers and
installers ordering for their own businesses, not consumers. They know the category. They are
deciding whether this is the right item and whether to order it, usually in under a minute.

---

## The input

| Column | Notes |
| :--- | :--- |
| `sku` | **Ours. The correlation key — return it unchanged on every row.** Present on all 1,174. |
| `manufacturer_sku` | The manufacturer's code. 774 of 1,174. |
| `ean` | Barcode. 646 of 1,174. |
| `brand` | 890 of 1,174. |
| `product_type` | **Only 78 of 1,174** — usually absent. |
| `title` | Current title, averaging 52 characters. Present on all. |

`sku` is our internal code and **must never appear in any text you write** — not in a title, not in a
description. It carries a vendor prefix and is not shown to customers. It is in the file solely so
rows can be matched back.

---

## The hard rule: invent nothing

You have a title, a brand and a code. You do **not** have the wattage, the capacity, the torque, the
dimensions, the materials, the warranty, the certifications, or what is in the box.

**Do not write any of them.** Not as a hedge, not as a plausible default, not because a product of
this type usually has them.

A stated specification on a B2B store is a representation to a trade buyer. A customer ordering a
1,800 W appliance that turns out to be 1,200 W is a return, a complaint and a claim — and the store
carries the statement, not the supplier.

Concretely, for `"Bosch BCH6ATH25 Vacuum Cleaner"`:

- ❌ *"Powerful 18 V lithium-ion battery delivers up to 60 minutes of runtime"* — invented
- ❌ *"Includes crevice tool and upholstery nozzle"* — invented
- ❌ *"HEPA filtration captures 99.9% of particles"* — invented
- ✅ *"Cordless vacuum cleaner from Bosch's BCH6 series."* — true, from the title alone
- ✅ *"Bosch BCH6ATH25 cordless vacuum cleaner."* — true

**Where a field cannot be written honestly, return it empty.** An empty field renders nothing on the
page and the layout closes up — that is designed for. A fabricated field looks fine and is worse.

Roughly a third of these products give you a bare title and nothing else. Empty long descriptions and
empty features for many of them is the correct outcome, and the honest one.

---

## Field rules

### `title`
Aim for a consistent, scannable shape: **Brand · Model · What it is · Key distinguishing detail
already present in the source title.**

- Keep every fact from the current title; reorder and tidy, do not add
- Fix casing (`"Hamster Cage 1218,Grey"` → `"Alfa Pets Hamster Cage 1218, Grey"`)
- Do not include our `sku`
- Target 40–80 characters
- If the current title is already good, return it unchanged

### `short_description`
One or two sentences. What this is, for a buyer deciding in seconds. Sits directly beneath the price.

- Plain sentences, no marketing superlatives ("premium", "ultimate", "perfect for")
- Aim 80–200 characters
- Plain text or simple HTML (`<p>`, `<strong>`, `<em>`) — no attributes, no styles, no classes
- **Empty if the title tells you nothing more than the title already says**

### `description_html`
Fuller prose, shown on the Product description tab.

- HTML, restricted to `<p> <strong> <em> <ul> <ol> <li> <br>` — no attributes, styles, classes,
  images or scripts
- Two or three short paragraphs at most
- **Empty far more often than not.** Only write one where the source genuinely supports it
- Never restate the specification table

### `key_features`
An array of short lines, shown as ticks beside the description.

- **Maximum 35 characters each** — this is measured against the card they sit in; longer wraps and
  breaks the column
- 3–5 where justified, fewer is fine, **empty array where nothing can be said honestly**
- Each must be defensible from the source title. "Cordless" is fine if the title says cordless
- No specifications you have not been given

---

## Return format

**JSON**, one object per product, as a downloadable file. JSON rather than CSV because the copy
contains HTML, commas and newlines that CSV quoting mangles in practice, and because features are a
list.

```json
[
  {
    "sku": "AP-1218",
    "title": "Alfa Pets Hamster Cage 1218, Grey",
    "short_description": "Grey wire hamster cage from Alfa Pets.",
    "description_html": "",
    "key_features": []
  },
  {
    "sku": "PAP-211587",
    "title": "Air Wick Essential Oil Candle, Amber Rose, 105 g",
    "short_description": "<p>Scented candle in Air Wick's Essential Oil range, amber rose fragrance, 105 g.</p>",
    "description_html": "<p>Part of the Air Wick Essential Oil range…</p>",
    "key_features": ["Amber rose fragrance", "105 g"]
  }
]
```

Requirements:

- **Every one of the 1,174 rows**, `sku` returned exactly as given
- All four content fields present on every object, `""` or `[]` where nothing can be written
- No field other than these five
- UTF-8, valid JSON, no trailing commas, no commentary around it

If the whole set is too large for one file, split it into batches of ~200 in the same shape and
number them — but keep every `sku` in exactly one batch.

---

## What happens next

Claude Code validates the file before writing anything: every `sku` must exist, no unknown SKUs, no
disallowed HTML, no feature over 35 characters, and our `sku` must not appear inside any written
text. It reports what would change and how many rows are affected before a single product is updated,
and the run is reversible.

So the useful failure mode is a field left empty. The costly one is a confident sentence nobody can
stand behind.
