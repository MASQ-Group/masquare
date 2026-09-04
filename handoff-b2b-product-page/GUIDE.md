# B2B webstore — product detail page — implementation guide

Deliverable for Claude Code. Scope: **one screen** — the product detail page of the invite-only B2B webstore (per `HANDOVER-b2b-product-page.md`). Reference mockup: `reference/b2b-product-page.html` (rich state, chosen direction: "Identity plate"). Design system contract: `docs/DESIGN.md`; tokens are already Tailwind classes via the shared preset — use token names below, not hex.

## Chosen direction — "Identity plate"

Classic two-column PDP. Where the gallery would be, sparse products (88% of catalogue) show a **generated typographic plate** built only from data that always exists (brand, model/title fragment, SKU). Rich products swap the plate for real photos 1:1 — the page shape never changes, so sparse never reads as broken.

## Page structure (desktop ≥1024px)

Content column: `max-w-[1160px] mx-auto`, padding 36/32, on `bg-n-50`. Sits under a thin persistent store header (56px, white, `border-b border-n-200`: logo, customer company name, avatar) — header is a shell placeholder, not part of this scope.

1. **Breadcrumb** — 12.5px `text-n-500`, `/` separators in `n-300`.
2. **Main grid** — `grid-cols-[440px_1fr] gap-12 items-start`.
   - **Left — media.** Square (aspect 1:1), `rounded-lg border border-n-200`. Rich: primary image + thumbnail row (5-up grid, `gap-2.5`, active thumb `border-2 border-teal-500`, others `border-n-200`; click swaps main). Sparse: identity plate (below). Caption line 12px `text-n-400` centered.
   - **Right — summary**, `gap-5`:
     - Brand eyebrow: 12px/600, uppercase, `tracking-[.09em] text-teal-600`.
     - Title: 28px/1.3, 600, `tracking-[-.02em]`.
     - Identifier line: 13px `text-n-500` — `SKU` + value in **mono 500 `text-n-800`**, pipe, `EAN` + mono value, copy-SKU icon button (26px, `border-n-200 rounded-sm`).
     - **Price card**: white, `border-n-200 rounded-lg p-5/6 shadow-sm`. "YOUR PRICE" eyebrow in `text-teal-600`; price 28px/600 **JetBrains Mono**; "excl. VAT · per unit" 12.5px `text-n-500`; availability right-aligned (state dot + label, see states); row of qty stepper (40px, mono value) + primary CTA "Add to order" (teal-500 fill, hover teal-600, 40px, radius md); footnote 12px `text-n-400`: "Price agreed for {customer} · updated dd/mm/yyyy" (date mono).
     - **Short description**: 14px/1.65 `text-n-600`, bottom border `n-100`, ends with anchor "Full description ↓" scrolling to the tab section. Render only if `shortDescription` exists; omit row entirely otherwise.
     - **Quick facts ledger**: label/value rows (`grid-cols-[180px_1fr]`, py-2.5, `border-b n-100`, 13.5px; machine values mono 13px). Only fields on record — never render empty rows.
3. **Tab section** — one `TabBar`-shaped strip (`gap-7`, 14px labels, active = 600 `text-n-800` + 2px teal-500 underline, inactive 500 `text-n-500`), `border-b n-200`. Tabs: **Product description · Specifications · Product files**. Render a tab only if its content exists (sparse page may have zero tabs → whole section omitted; see sparse rules).
   - **Description tab**: `grid-cols-[1fr_320px] gap-12` — descriptionHtml (14px/1.7 `text-n-700`, paragraphs gap-3) + "Key features" card (white, border, rounded-lg; 11px uppercase eyebrow; one line per feature, teal ✓ prefix — features are single lines by house rule).
   - **Specifications tab**: two-column grid (`grid-cols-2 gap-x-12`), rows `grid-cols-[200px_1fr] py-[11px] border-b n-100`; labels `text-n-500`; **machine values mono** (weights, dimensions, voltage, torque, mfr SKU), human values Inter.
   - **Files tab**: 3-up grid of file cards (white, border, rounded-md, hover `border-teal-200`): 36px `bg-teal-50 text-teal-800` ext badge, name 13.5px/500 ellipsized, meta line mono 11.5px `text-n-400` (type · size), download icon (lucide `download`).

## The identity plate (sparse media)

`rounded-lg border n-200`, background `linear-gradient(160deg, teal-50, n-50 55%, n-100)`. Contents, all absolutely placed:
- top-left: brand, 11px/600 uppercase `text-teal-200`
- center: model fragment (parsed from title, else product type), **mono 44–46px/600 `text-teal-800`**, opacity .85
- bottom-left: SKU, mono 12.5px `text-teal-300`
- bottom-right: category lucide icon, ~220px, stroke teal-800, opacity .10, bleeding off-corner

Deterministic per product (same product → same plate). Thumbnails use miniature plates when only some images exist? No — if ≥1 real image exists, show only real images; plate appears only at zero images.

## States

- **Sparse (primary)**: plate, title, identifiers, price card, quick-facts ledger with whatever exists. No tabs section if no description/specs/files — instead a dashed "request" card: "Need the full specification or images? We'll attach them within one working day." + ghost button "Request spec sheet".
- **Rich**: everything above populated (reference mockup shows this).
- **Restricted** (signed in, not entitled): keep header, breadcrumb, plate (brand/model only — **no SKU on plate**), title, brand. Hide price card, identifiers beyond title, specs, files. In place of the price card: info-toned card (`bg-info-bg border-info-bd`): "This product isn't in your range yet. Your account doesn't include {brand} products. Request access and we'll confirm within one working day." + primary "Request access" + ghost "Message your account manager". Never an error tone.
- **Availability states**: `in_stock` (green-500 dot, "In stock · ships 2–3 working days"), `limited` (warning dot, "Limited stock"), `made_to_order` (info dot, "Made to order · lead time X weeks"), `unavailable` (n-400 dot, "Currently unavailable", CTA disabled). Never show unit counts.
- **Reference price** (optional second number): strikethrough mono `text-n-400` beside price + teal-50 pill naming the deal ("−20% brand deal"). Works with one number alone — no redesign.

## Type scale (customer-facing, px)

Title 28 · section/tab headers 18 · body 14 · labels/rows 13.5 · meta 12.5 · captions/eyebrows 11–12 · price 28–30 mono. Minimum body 13.5px. Mono = JetBrains Mono, tabular-nums, for every machine-assigned value (SKU, EAN, mfr SKU, money, weights, dimensions, voltages, dates, file sizes).

## Mobile (≤767px)

Single column, 16–18px gutters, in order: breadcrumb (truncate middle), media (plate/gallery full-width, thumbs horizontal scroll), brand + title + identifiers, price card (CTA full-width; card may stick to viewport bottom as a condensed bar on scroll), short description, quick facts, tabs (labels scroll horizontally if needed; same one-at-a-time panels). Hit targets ≥44px. Same ≤767px breakpoint as the platform's mobile work.

## Implementation notes

- Stack per handover: React 18 + TS + Vite + Tailwind (shared preset) + React Query; new app beside `apps/web`. Reuse `TabBar` shape from `packages/ui`; icons lucide-react.
- Conditional rendering rule: **a field with no value renders nothing** — no dashes, no empty rows, no placeholder boxes. The layout is designed to close up.
- Copy-SKU: clipboard write + toast "SKU copied".
- Tab anchor: "Full description ↓" scrolls to tabs and activates the description tab.
- The reference mockup's plates/images are stand-ins; wire `ProductMedia` ordered by `sortOrder`.
- Data the page wants that the handover flagged as open: a `shortDescription` (plain text, ~2 sentences) distinct from `descriptionHtml`; product files/documents entity (datasheet, DoC, SDS) — the Files tab assumes it.

## Acceptance checklist

- Sparse product renders complete and deliberate: no empty boxes, no hidden-section layout jumps.
- All machine values in JetBrains Mono with tabular numerals.
- Only teal as accent; semantic colors only for availability/status.
- Restricted page leaks neither price nor specification and offers a way forward.
- No horizontal overflow at 360/390/414px; keyboard focus visible on all controls.
