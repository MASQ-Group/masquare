# Mobile web view optimization — implementation guide

Deliverable for Claude Code. Scope: make every platform page usable at ≤767px as a responsive **mobile web view** (not a native app). Two reference designs are included (`reference/` HTML mockups): Sales transactions and Marketplace integrations. Apply the same principles to all other pages.

## Breakpoints

- `>=1024px` — desktop layout (approved compact top bar: 48px header row + optional 44px toolbar row).
- `768–1023px` — desktop bar; toolbar row wraps to multiple lines (`flex-wrap: wrap`), nothing hidden.
- `<=767px` — mobile layout described below.

## Design tokens (unchanged from desktop)

- Font: Inter. Body 13px, page title 15px/700 on mobile, breadcrumb 10px caps `#94a3b8`.
- Colors: primary teal `#14b8a6` (hover `#0d9488`), text `#0f172a` / `#475569` / `#64748b`, borders `#e2e8f0`, muted bg `#f1f5f9`/`#f8fafc`, attention amber `#f59e0b`/`#b45309`, error red `#dc2626`, teal chip bg `#ccfbf1` text `#0f766e`.
- Controls: 8px radius, 1px `#e2e8f0` border, 8px gap. Mobile control height 32–34px; minimum hit target 44×44px (pad with margin where the visual is smaller).

## Principle 1 — Sticky page bar that collapses, never disappears

The #1 defect to fix: the current bar hides on scroll-down leaving a blank gap.

Structure (top to bottom inside the page):
1. **Global module bar** (☰ + module search + help): NOT sticky, scrolls away normally.
2. **Page bar** — `position: sticky; top: 0`, white bg, 1px bottom border, subtle shadow. Two states:
   - **Expanded** (at top or scrolling up): 46px title row + toolbar row(s).
   - **Collapsed** (scrolling down, scrollY > 60): title row stays; toolbar rows animate to height 0; a **34px summary strip** appears instead.

Title row (46px, always visible):
- Breadcrumb (module, 10px caps) › page title (15px/700, ellipsis) + ⓘ tooltip holding the page description (descriptions are never rendered as a text block on mobile).
- Right side: at most — one icon secondary (e.g. Alerts bell with status dot), one `⋯` overflow, one primary button with a **shortened label** ("+ Register", "+ Add"). Primary never wraps, `flex: none`.
- All secondary actions beyond one move into `⋯`.

Summary strip (collapsed state, 34px):
- Left: page-relevant status line, e.g. `1,248 transactions · All time · 2 filters` or `20 connections · 18 healthy · 2 attention`.
- Right: a pill button ("Search & filters ▾") that re-expands the bar.
- Collapse/expand: scroll-down collapses, any scroll-up or the pill expands. Animate `max-height` + `opacity`, ~200ms ease.

## Principle 2 — Toolbar: one row + chips + bottom sheet

Never stack N full-width selects (the current mobile view stacks 5).
- **Row 1:** page search field (flex:1) + one **Filters** button with an active-count badge.
- **Row 2 (optional):** horizontally scrollable chip row — active filters as removable teal chips (`× ` to clear), inactive/quick filters as dashed-border ghost chips. `overflow-x: auto`, no scrollbar.
- Everything else (date range, grouping, currency toggle, columns, secondary toggles) lives in a **bottom sheet** opened by Filters: drag handle, title + "Done", 40px setting rows (label left, value + ▾ right), teal "Apply" button. "Columns" becomes "Visible fields" and controls which card fields render.
- Segmented controls with 2–3 short options (e.g. All / Needs attention) may stay inline next to search.

## Principle 3 — Tables become cards

No horizontal table scrolling on mobile, ever. Convert each row to a card (white, 1px border, 10px radius, 10–12px padding, 8px gap between cards, 10px page gutter):
- **Line 1 — identity:** status dot + primary identifier (mono where it's an ID) + date/timestamp right-aligned.
- **Line 2 — context badges:** channel/category badges + secondary id (SKU) in a mono chip; single line, ellipsize the least important item (give it `min-width:0; overflow:hidden; text-overflow:ellipsis`, keep critical labels `flex:none`).
- **Line 3 — numbers/actions:** key metrics left, outcome metrics right (colored: teal positive, red negative pill), chevron `›` for detail.
- Pick the 5–7 most decision-relevant columns for the card; the rest appear on the detail view (tap) and via "Visible fields".
- Bulk selection: no per-row checkboxes by default; long-press or an explicit "Select" mode from `⋯` reveals them.
- Grouped tables (e.g. integrations by marketplace): group header becomes a card header row (logo, name, count badge, health dots, one `⋯` for group actions); child rows become 2-line rows inside the card with one visible action button (e.g. Sync) + `⋯`.

## Principle 4 — Dense widgets compact down

- **KPI/stat cards:** one row of N mini-stats (`grid-template-columns: repeat(N, 1fr)`, number 18px/700 + 10.5px label), not stacked full-width cards. Keep semantic colors. 4 per row max; if more, make the row horizontally scrollable.
- **Settings/config panels** (e.g. auto-sync scheduler): collapse to a one-line status strip ("Auto-sync off · daily 05:00 UTC · 0/20 on") + "Configure ›" opening a bottom sheet with the full controls.
- **Counts and meta** ("100 of 535 SKUs"): into the collapsed summary strip or a small line above the list, never their own toolbar row.

## Principle 5 — Never clip text

Any nowrap flex line must designate exactly one shrinkable member (`min-width:0; overflow:hidden; text-overflow:ellipsis`); all status-critical labels ("Never synced", error states) get `flex: none` so they are always fully visible. Shorten labels rather than clip them ("✓ Verified" not "✓ Connection OK · Mapping verified").

## Per-page reference specs

### Sales transactions (reference/mobile-sales-transactions.html)
- Title row: SALES › Sales transactions ⓘ | bell icon (amber dot) · ⋯ (Returns, Recalculate all, Unlock requests, Export) · "+ Register".
- Toolbar: search "Search ID or SKU…" + Filters [2]; chip row: active "All time", "EUR"; ghost "Grouping", "Custom range", "Columns".
- Collapsed strip: `1,248 transactions · All time · 2 filters`.
- Card: line 1 status dot + transaction ID (mono) + date; line 2 channel badge + FBM badge + SKU chip (SKU shrinks); line 3 net sales + fee% (amber) | profit € (teal) + profit% pill (teal bg positive / red bg negative) + ›.
- Bottom sheet rows: Date range, Grouping, Status·Channel·Fulfilment [2], Currency (EUR/Original segmented), Visible fields (6 of 13).

### Marketplace integrations (reference/mobile-marketplace-integrations.html)
- Title row: SETUP › Marketplace integrations ⓘ | sync-all icon · ⋯ (auto-sync settings, Pull older orders, Secrets) · "+ Add".
- Toolbar: search + segmented All / Needs attention [2].
- Collapsed strip: `20 connections · 18 healthy · 2 attention`.
- KPI row: Connections 20 (teal outline = active filter) · Healthy 18 (teal) · Attention 2 (amber) · Errors 0 (red).
- Auto-sync strip: one line + "Configure ›" sheet.
- Group card: header logo + name + count + health dots + ⋯; account rows: flag, name + "active" pill, meta line "✓ Verified · 11 d ago · [chip]" (chip is the only shrinkable item), Sync button (disabled style `#e2e8f0`/`#94a3b8` when mapping unverified), ⋯.

## Implementation notes

- Pure responsive CSS + a small scroll listener for the collapse state; no separate mobile routes. Prefer CSS `@media (max-width: 767px)` + a shared `useStickyCollapse` hook (threshold 60px, direction-aware, 4px scroll-up tolerance).
- Card list and table should render from the same data source/columns config so "Visible fields" maps to card fields.
- Bottom sheet: fixed to viewport bottom, `border-radius 16px 16px 0 0`, scrim `rgba(15,23,42,.4)`, closes on scrim tap / Done / Apply.
- Test at 360, 390 and 414px widths; verify no horizontal overflow (`document.documentElement.scrollWidth === clientWidth`) and no clipped status labels.

## Rollout order (suggested)

1. Shared pieces: sticky collapse hook, bottom sheet, chip row, summary strip, card list shell.
2. Sales transactions (reference build), then Marketplace integrations.
3. Remaining list pages (Channel listings, All products, Shipments) — same card recipe.
4. Analytics pages — filters into the sheet, charts full-width, KPI mini-rows.
