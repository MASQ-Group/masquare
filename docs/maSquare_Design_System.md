# maSquare Platform — Design System

**Status:** Approved direction · **Scope:** Foundation-level. Referenced by every module. The values below are the single source of truth; they become the `tailwind.config` theme and the root CSS variables in the codebase.

---

## 1. Principle: data in mono

The platform's defining typographic rule: **Inter renders everything a person reads; JetBrains Mono (tabular figures) renders every value a machine assigns.** Identifiers and figures must be instantly scannable and must align in columns.

Use **JetBrains Mono, `font-variant-numeric: tabular-nums`** for: SKUs and aliases, EAN/UPC, HS codes, VAT and registration numbers, monetary amounts, quantities, weights and dimensions, dates, and system IDs. Use **Inter** for all labels, titles, descriptions, and prose.

---

## 2. Colour tokens

### Brand ramps

| Step | Teal (primary) | Green (positive) | Orange (accent) |
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

### Semantic (kept distinct from brand)

| Role | Foreground | Background | Border |
| :--- | :--- | :--- | :--- |
| Success | `#71A22F` | `#F2F8E6` | `#C8E298` |
| Warning | `#B7791F` | `#FBF1DC` | `#EBCF93` |
| Danger | `#C8372E` | `#FCEBE9` | `#F2C0BB` |
| Info | `#0F857D` | `#E7F6F4` | `#8FD8D1` |

### Role mapping & usage rules

- **Primary** = Teal 500 (hover 600). Default action colour: primary buttons, active nav, focus rings, links.
- **Positive** = Green. Success states, in-stock, synced, healthy KPIs.
- **Accent** = Orange 500. Reserved for sparing high-emphasis moments (a key secondary CTA such as *Publish listing*, destructive-but-not-error highlights like *Clear all*). **Orange is never used for error/danger** — that role belongs to the red above, so the two never collide.
- App background = Neutral 50; surfaces/cards = white on Neutral 200 borders; primary text = Neutral 800–900; secondary text = Neutral 500.

---

## 3. Typography

**Families:** `Inter` (sans, weights 400/500/600/700) · `JetBrains Mono` (mono, 400/500/600).

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

---

## 4. Spacing, radii, shadows

- **Spacing** — 4px base: `4, 8, 12, 16, 20, 24, 32, 40, 48, 64`. Card padding 20–24; section gaps 24–32; page padding 28/32 (desktop), 16–18 (mobile). Whitespace is deliberate — the platform reads as comprehensive but never cramped.
- **Radii** — `sm 6 · md 8 · lg 12 · xl 16 · pill 999`. Default control radius is `md (8)`.
- **Shadows** —
  `xs 0 1px 2px rgba(16,24,40,.05)` ·
  `sm 0 1px 3px rgba(16,24,40,.08), 0 1px 2px rgba(16,24,40,.04)` ·
  `md 0 4px 14px rgba(16,24,40,.08)` ·
  `lg 0 16px 40px rgba(16,24,40,.16)` (popovers, modals).

---

## 5. Layout & responsiveness

- **App shell** — left sidebar `248px` (company switcher pinned top, module nav, user pinned bottom); top bar `60px` (global search as the centre of gravity); content fills **the full remaining width** with no fixed max-width.
- **Breakpoints** —
  - `≤ 1100px`: sidebar collapses to a `68px` icon rail; two-column panels stack.
  - `≤ 760px`: sidebar becomes an off-canvas drawer behind a hamburger + scrim; search scope label hides; content padding reduces; tables scroll horizontally.
- Every page is fully responsive down to mobile.

---

## 6. Core components

- **Buttons** — Primary (teal fill), Ghost (white, Neutral 200 border), Accent (orange fill, sparing). Height 40, radius md, 13.5/600, icon 17px.
- **Tags / chips** — Pill, 11.5–12.5/600. Filter chips use Teal 50/100; status tags use the semantic palette; FBA = info, FBM = neutral.
- **Inputs** — Height 38–40, Neutral 200 border, focus = Teal 400 border + Teal 50 ring (3px). The **smart reference input** (typeahead + create-on-confirm) and **bulk import** behave per Module 1 §6.
- **Tables** — Neutral 25 header, uppercase 11px labels, hover = Teal 50, 12/16px cell padding, mono for all figures. Filterable columns carry a caret affordance (the Excel-like per-column filter). Built on TanStack Table with virtualization for large catalogues.
- **Modal shell** — per Module 1 §6.3 (centered, expand, drag-resize, tabbed, dirty-guard); shadow `lg`.
- **Global search** — top-bar palette (cmdk): left module-scope selector, platform-wide grouped smart suggestions, each result carrying its mono identifier; `⌘K` / `Ctrl-K` to focus.

---

## 7. Implementation stack

shadcn/ui (Radix + Tailwind) · TanStack Table + Virtual · cmdk · react-hook-form + Zod · dnd-kit · TanStack Query · Lucide icons · Recharts (future analytics). Tokens above live in `tailwind.config` and `:root` CSS variables.

## 8. Quality floor

Visible keyboard focus on every interactive element; `prefers-reduced-motion` respected; text/UI contrast meets WCAG AA against the chosen surfaces; all flows reachable by keyboard.
