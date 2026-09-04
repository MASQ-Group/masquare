# maSquare — Design System (DESIGN.md)

This is the canonical design system for the maSquare multi-company operations platform. Pair this file with `maSquare_UI_Framework.html` (a rendered reference screen) when setting up Claude Design — the markdown is the contract, the HTML is the real example.

---

## Brand identity

maSquare is a back-office operations platform for a multi-company e-commerce retailer — catalogue, inventory, marketplace integrations, tax, and analytics in one place. The interface should feel **modern, precise, and comprehensive without ever feeling cramped**: dense, professional data work delivered with deliberate whitespace and calm structure. It is a tool people work in for hours, so clarity and scannability beat decoration. Trustworthy and quiet, with one confident accent.

**Signature principle — data in mono.** Inter renders everything a *person* reads; JetBrains Mono (tabular figures) renders every value a *machine* assigns — SKUs, EAN/UPC, HS codes, VAT and registration numbers, money, quantities, weights, dimensions, dates, and IDs. This makes identifiers instantly scannable and aligns figures in columns. It is the one memorable, consistent device across the whole product.

---

## Color tokens

### Brand ramps

| Step | Teal — primary | Green — positive | Orange — accent |
| :--- | :--- | :--- | :--- |
| 50  | `#E7F6F4` | `#F2F8E6` | `#FEEEE8` |
| 100 | `#C3EAE6` | `#E0EFC4` | `#FCD3C4` |
| 200 | `#8FD8D1` | `#C8E298` | `#FAB39C` |
| 300 | `#57C3BA` | `#AFD56B` | `#F78D6B` |
| 400 | `#2BB0A6` | `#9DCE52` | `#F47248` |
| **500** | **`#14A79D`** | **`#8DC73F`** | **`#F1592A`** |
| 600 | `#0F857D` | `#71A22F` | `#D43F13` |
| 700 | `#0B645E` | `#557A23` | `#A22F0E` |
| 800 | `#084742` | `#3B5518` | `#70210A` |
| 900 | `#05302C` | `#28390F` | `#471506` |

### Neutral slate

`0 #FFFFFF` · `25 #FBFCFD` · `50 #F6F8FA` · `100 #EDF1F4` · `200 #DDE3E9` · `300 #C3CCD4` · `400 #97A4AF` · `500 #6B7884` · `600 #4D5963` · `700 #374049` · `800 #232A31` · `900 #141A1F` · `950 #0C1014`

### Semantic — kept distinct from brand

| Role | Foreground | Background | Border |
| :--- | :--- | :--- | :--- |
| Success | `#71A22F` | `#F2F8E6` | `#C8E298` |
| Warning | `#B7791F` | `#FBF1DC` | `#EBCF93` |
| Danger | `#C8372E` | `#FCEBE9` | `#F2C0BB` |
| Info | `#0F857D` | `#E7F6F4` | `#8FD8D1` |

### Roles & rules

- **Primary** = Teal 500 (hover 600): primary buttons, active nav, focus rings, links.
- **Positive** = Green: success, in-stock, synced, healthy KPIs.
- **Accent** = Orange 500: one high-emphasis moment per view at most (a key secondary CTA, a "clear all"). **Never** used for errors — danger is the red above, so the two never collide.
- Surfaces: app background Neutral 50; cards white on Neutral 200 borders; primary text Neutral 800–900; secondary text Neutral 500.

### Token block (drop into globals.css)

```css
:root {
  --teal-50:#E7F6F4;--teal-100:#C3EAE6;--teal-200:#8FD8D1;--teal-300:#57C3BA;--teal-400:#2BB0A6;
  --teal-500:#14A79D;--teal-600:#0F857D;--teal-700:#0B645E;--teal-800:#084742;--teal-900:#05302C;
  --green-50:#F2F8E6;--green-100:#E0EFC4;--green-200:#C8E298;--green-300:#AFD56B;--green-400:#9DCE52;
  --green-500:#8DC73F;--green-600:#71A22F;--green-700:#557A23;--green-800:#3B5518;--green-900:#28390F;
  --orange-50:#FEEEE8;--orange-100:#FCD3C4;--orange-200:#FAB39C;--orange-300:#F78D6B;--orange-400:#F47248;
  --orange-500:#F1592A;--orange-600:#D43F13;--orange-700:#A22F0E;--orange-800:#70210A;--orange-900:#471506;
  --n-0:#FFFFFF;--n-25:#FBFCFD;--n-50:#F6F8FA;--n-100:#EDF1F4;--n-200:#DDE3E9;--n-300:#C3CCD4;
  --n-400:#97A4AF;--n-500:#6B7884;--n-600:#4D5963;--n-700:#374049;--n-800:#232A31;--n-900:#141A1F;--n-950:#0C1014;
  --success:#71A22F;--success-bg:#F2F8E6;--success-bd:#C8E298;
  --warning:#B7791F;--warning-bg:#FBF1DC;--warning-bd:#EBCF93;
  --danger:#C8372E;--danger-bg:#FCEBE9;--danger-bd:#F2C0BB;
  --info:#0F857D;--info-bg:#E7F6F4;--info-bd:#8FD8D1;
  --primary:var(--teal-500);--primary-hover:var(--teal-600);--accent:var(--orange-500);
  --font-sans:'Inter',system-ui,sans-serif;--font-mono:'JetBrains Mono',ui-monospace,monospace;
  --r-sm:6px;--r-md:8px;--r-lg:12px;--r-xl:16px;--r-pill:999px;
  --sh-xs:0 1px 2px rgba(16,24,40,.05);
  --sh-sm:0 1px 3px rgba(16,24,40,.08),0 1px 2px rgba(16,24,40,.04);
  --sh-md:0 4px 14px rgba(16,24,40,.08);
  --sh-lg:0 16px 40px rgba(16,24,40,.16);
}
```

---

## Typography

**Families:** Inter (400/500/600/700) · JetBrains Mono (400/500/600, tabular-nums).

| Role | Size / Line | Weight | Tracking |
| :--- | :--- | :--- | :--- |
| Page title | 24 / 32 | 600 | −0.02em |
| Section (H1) | 22 / 30 | 600 | −0.01em |
| Subsection (H2) | 18 / 26 | 600 | −0.01em |
| Card title (H3) | 15 / 22 | 600 | normal |
| Body | 14 / 21 | 400 | normal |
| Body strong / label | 13 / 20 | 500 | normal |
| Caption / meta | 12 / 18 | 500 | normal |
| Eyebrow | 11 / 16 | 600 | 0.09em, uppercase |
| Data (mono) | contextual | 400–500 | −0.01em, tabular-nums |

**Mono is mandatory** for: SKUs & aliases, EAN/UPC, HS codes, VAT/registration numbers, monetary amounts, quantities, weights, dimensions, dates, system IDs. Everything else is Inter.

---

## Spacing, radii, shadows

- **Spacing** — 4px base: `4 8 12 16 20 24 32 40 48 64`. Card padding 20–24; section gaps 24–32; page padding 28/32 desktop, 16–18 mobile. Whitespace is deliberate.
- **Radii** — `sm 6 · md 8 · lg 12 · xl 16 · pill 999`. Default control radius `md`.
- **Shadows** — `xs / sm / md / lg` per the token block; `lg` is for popovers and modals.

---

## Layout & responsiveness

- **App shell** — left sidebar `248px` (company switcher pinned top, module nav, user pinned bottom); top bar `60px` with the global search as its centre of gravity; content fills the **full remaining width**, no fixed max-width.
- **Global search** — top-bar command palette: left module-scope selector, platform-wide grouped smart suggestions, each result carrying its mono identifier; `⌘K` / `Ctrl-K` to focus.
- **Breakpoints** — `≤1100px` sidebar collapses to a `68px` icon rail and two-column panels stack; `≤760px` sidebar becomes an off-canvas drawer + scrim, search scope label hides, tables scroll horizontally.
- Every page is fully responsive to mobile.

---

## Components

- **Buttons** — Primary (teal fill), Ghost (white, Neutral 200 border), Accent (orange fill, sparing). Height 40, radius `md`, 13.5/600, 17px icon.
- **Inputs** — Height 38–40, Neutral 200 border; focus = Teal 400 border + 3px Teal 50 ring. Reference fields use a smart typeahead that suggests existing values and offers create-on-confirm.
- **Tags / chips** — Pill, 11.5–12.5/600. Filter chips use Teal 50/100; status uses the semantic palette; FBA = info, FBM = neutral.
- **Tables** — Neutral 25 header, uppercase 11px labels, hover = Teal 50, 12/16px cell padding, mono figures (money right-aligned). Filterable columns carry a caret affordance.
- **Modal shell** — centered; header with full-page-expand + close; bottom-right drag-to-resize (H+V); tabbed body; footer primary CTA + Cancel; an unsaved-changes guard on cancel/close; shadow `lg`.
- **Navigation** — dark slate sidebar; active item gets a teal left-edge accent and tinted background.

---

## Voice & UX writing

Words are design material. Write from the user's side of the screen, in the platform's calm, plain voice.

- **Active voice, sentence case, no filler.** "Add product," not "Submit." "Stock on hand," not "inventory_units."
- **Name things by what people control,** never by how the system is built. "Marketplace connections," not "API integration config." "Tax settings," not "VAT module config."
- **An action keeps its name through the whole flow.** The button that says "Publish listing" produces a toast that says "Published."
- **Specific over clever.** "Tighten review cycles" loses to "Sync prices every 2 hours."
- **Errors give direction, never apologise and never go vague.** "Sync failed — Amazon rejected the SKU format. Use letters, numbers, and dashes only, then retry." not "Something went wrong."
- **Empty states invite action.** "No products yet. Add your first product, or import a .csv." not "No data."
- **Confirmations state the consequence.** Create-on-confirm: "Create new vendor 'THETACO Traders Ltd'? It will be available to all companies." Discard guard: "You have unsaved changes." with actions "Keep editing" / "Discard changes."
- **One element, one job.** A label labels; an example demonstrates; nothing does double duty.

---

## Usage guidelines — do / don't

- **Do** lead actions with teal; spend orange on at most one emphasis per view; keep danger red for errors only.
- **Do** set every identifier and figure in mono with tabular numerals.
- **Do** give pages room — generous whitespace, full-width layouts, no app-page max-width.
- **Don't** use Material/Ant default looks, heavy drop shadows, or more than the `lg` shadow.
- **Don't** crowd tables; let rows breathe and right-align money.
- **Don't** introduce new accent colours — extend within the three brand ramps and the neutral slate.

---

## Formats

- **Dates** render as **dd/mm/yyyy** by default (configurable in Global Settings; alternatives mm/dd/yyyy, yyyy-mm-dd). Always in mono, tabular.
- **Units** are **metric** by default — dimensions in cm, weights in kg (configurable to imperial in Global Settings).
- **Figures** (money, quantities, codes, dates) are always JetBrains Mono with tabular numerals; money is right-aligned in tables.

---

## Accessibility floor

Visible keyboard focus on every interactive element; `prefers-reduced-motion` respected; text and UI contrast meet WCAG AA on the chosen surfaces; every flow reachable by keyboard.
