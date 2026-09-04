# Handover to Claude Design — B2B webstore, public product page

## What to design

**One screen: the product detail page of an invite-only B2B webstore.** Nothing else. No listing
page, no cart, no checkout, no account area. Those come later; designing them now would set
expectations we would then have to unpick.

Deliver the page in **three states** (see *The states that matter*, below) and a **mobile layout**.

---

## 1. The two audiences problem — read this first

maSquare today is a **back-office operations platform**: dense, information-rich, built for staff who
live in it for hours. `docs/DESIGN.md` is its design system and it is excellent for that job.

This page is different. It faces a **customer** — a verified trade buyer, signed in, deciding whether
to order. They are not doing data work. They visit briefly, want to know what the product is, what it
costs them, and whether they can have it.

So: **inherit the design system, not the interface density.** Same tokens, same type pairing, same
restraint. Different rhythm — more air, larger type, fewer things competing. If a decision is genuinely
between "consistent with the admin platform" and "right for a buyer", choose the buyer, and say in
your notes where you did and why.

What must stay identical, because it is the brand:

- **The colour tokens.** Teal `#14A79D` is the one accent. Do not introduce a second brand colour.
- **The type pairing and its rule.** Inter for anything a *person* wrote; **JetBrains Mono for every
  value a machine assigned** — SKU, EAN, dimensions, weights, quantities, money. This is the single
  most recognisable device in the system and it must survive onto this page.
- **Radii, shadows and border treatment** from the token set.

---

## 2. The hard constraint: the catalogue is nearly empty

This is the most important thing in this document, and it should shape the whole design.

Measured across all **1,173 live products** in production today:

| Content | Products that have it | Share |
| :--- | ---: | ---: |
| Title, SKU | 1,173 | **100%** |
| Brand | 889 | 76% |
| EAN | 810 | 69% |
| Product weight | 758 | 65% |
| Country of origin | 402 | 34% |
| Package dimensions | 161 | 14% |
| **At least one image** | **137** | **12%** |
| Structured attributes (avg 1.9) | 90 | 8% |
| **Description** | **37** | **3%** |
| **Key features** | **37** | **3%** |
| Warranty text | 30 | 3% |
| MSRP | 2 | 0.2% |

A page built around a hero gallery, rich description and feature bullets would be **empty for roughly
nine products in ten**. The catalogue will improve, but slowly, and the store has to be credible from
day one.

**So design the sparse case as the primary case.** A page showing a title, a SKU, a brand and a price
must look deliberate and trustworthy — not like a page that failed to load. The rich version is the
happy path you design *second*, not first.

Please avoid the two usual escapes: a grey placeholder box where the image should be reads as broken,
and hiding sections entirely makes every page a different shape. Find something better — that is the
most valuable thing you can give us here.

---

## 3. What the page can show

All of this exists in the database today and needs no new work.

**Identity** — title, main SKU, brand, EAN/UPC, manufacturer SKU, country of origin, product type,
category.

**Media** — `ProductMedia`: up to 8 images, ordered by `sortOrder`, first is the primary. jpg/png/webp.
Note the 12% coverage above.

**Copy** — `descriptionHtml` (rich text, author-controlled), `keyFeatures` (string array, one line
each — they are written as single lines by house rule, so do not design for paragraphs).

**Specifications** — `ProductAttribute` name/value pairs (free-form, averaging 1.9 where present),
plus fixed fields: product weight, package weight, package L×W×H, voltage, frequency, plug type,
battery required/type, warranty text, hazmat class.

**Commercial — the B2B part.** *Deliberately not decided yet.* Each customer gets their own price:
a fixed price per product, or a percentage off by product / brand / vendor / product type. Assume the
page receives **one resolved price** plus optional context (e.g. a "your price" versus a list price,
or a saving). Design a price block that works when there is only one number, and can carry a second
without redesign. Do not invent tier tables or quantity breaks — we have not decided those exist.

**Availability.** Treat as a *state*, not a number. Do not show unit counts: exact stock is
commercially sensitive and the underlying figure is currently being rebuilt. Design for something like
in stock / limited / made to order / unavailable, and tell us what states you need.

---

## 4. The states that matter

Please deliver all three, at the same fidelity. The first is not an edge case — it is the majority.

1. **Sparse** — title, SKU, brand, price, availability. No image, no description, no features, no
   specs. *This is what most of the catalogue looks like.*
2. **Rich** — 4–6 images, description, 5 key features, 8–10 specification rows. The aspiration.
3. **Restricted** — the customer is signed in but **not entitled to this product**. Access is
   per-customer by product/brand, so this will happen via shared links. It must not leak the price or
   the specification, must not look like an error, and should offer a way forward (request access /
   contact us). Tell us what you think it should say.

Plus **mobile** (≤767px) for the sparse and rich states. The platform's mobile work uses a ≤767px
breakpoint; matching it keeps one mental model.

---

## 5. Signed-in, invite-only — what that changes

Every visitor is authenticated and verified. There is no anonymous browsing, no SEO surface, no
"create an account" path.

Consequences worth designing for:

- The page can be **direct and commercial**. No trust-building marketing furniture, no reviews, no
  social proof, no newsletter capture. These buyers already know who we are.
- **Prices are personal.** A visible cue that this price belongs to *this* customer is valuable —
  it is the core promise of the store.
- Assume a **thin persistent header** (logo, account, eventually search/cart) and design the page to
  sit under it. Do not design the header itself; propose its height and note it.

---

## 6. Technical facts that make development cheap

Following these means the design can be built largely by assembling what exists, rather than
re-implementing it.

- **Stack:** React 18 + TypeScript + Vite, **Tailwind**, React Query. Same monorepo, likely a new
  app beside `apps/web`.
- **Tokens are already Tailwind classes.** `bg-n-50`, `text-n-500`, `border-n-200`, `text-teal-700`,
  `rounded-md`, `shadow-sm` all resolve to the CSS variables in `docs/DESIGN.md` via a shared preset.
  **Please express the design in these token names** rather than raw hex — it removes a whole
  translation step and guarantees we stay on-brand.
- **Existing shared components** in `packages/ui` we would reuse: `ModalShell`, `Select` (type-to-filter),
  `TabBar`, `Pagination`, `FileDrop`, `DatePicker`. If a tab strip or a modal suits the design, use
  their shape rather than a new pattern.
- **Two house rules that already apply platform-wide:** every dropdown is type-to-filter with smart
  suggestions, and every popover is portalled and clamped to the viewport so it can never be clipped.
- **Icons:** `lucide-react`, already a dependency.
- Font sizes across the platform are set in px (`text-[13px]`, `text-[15px]`). A customer-facing page
  will want a larger scale — please propose one explicitly rather than leaving it implied.

---

## 7. What we are NOT asking for

Out of scope, and designing them would create expectations we would have to walk back:

- Catalogue/listing/search pages, filters, cart, checkout, order history, account settings
- Any admin or back-office screen
- Logged-out, marketing or registration pages
- The ordering flow (a future Sales Order in the platform — not this piece)
- Anything implying quantity-break pricing or public pricing

---

## 8. What to hand back

- The three states plus mobile, at the fidelity above
- Colour and spacing expressed in **existing token names** where possible
- A short note on **which decisions were driven by the sparse-content constraint** — that is the part
  we most need to understand before building
- Anything you needed and could not find here: list it rather than inventing it. In particular,
  **tell us what data you wish existed**, because we can add it to the product card, and a
  well-argued "this page needs X" is a genuinely useful output.

---

## 9. Open questions we have deliberately not answered

Answer them in the design if you have a view; flag them if you do not.

1. How should the sparse page carry itself with no image? (The central question.)
2. Should the customer's price sit against a reference price, and if so which — MSRP is populated on
   2 products, so it cannot be that one.
3. What availability states does a trade buyer actually need?
4. Where should SKU and EAN sit — a buyer orders by SKU, so it may deserve more prominence than a
   consumer store would give it.
5. What does the restricted state say so it reads as "not for you" rather than "broken"?

---

## Appendix — files worth reading

- `docs/DESIGN.md` — the canonical design system: tokens, type, component patterns. **The contract.**
- `docs/maSquare_UI_Framework.html` — a rendered reference screen showing the system in use.
- `apps/web/src/components/products/` — the internal product card, i.e. the same data rendered for
  staff. Useful as a data inventory; **not** a model for this page's density.
- `packages/config/tailwind-preset.cjs` — how the tokens become Tailwind class names.
