# ERP — shipment tracking tab — implementation guide

Deliverable for Claude Code. Scope: **one view** — the shipment tracking tab shown inside a sales-order/shipment detail page. Reference mockup: `reference/shipment-tracking.html` (open directly in a browser; `support.js` must sit beside it). Design system contract: `docs/DESIGN.md`; tokens are Tailwind classes via the shared preset — use token names, not hex.

## Layout

Single content column `max-w-[860px] mx-auto`, padding 24/20, on `bg-n-50`. Three stacked white cards (`bg-white border border-n-200 rounded-xl`), `gap-4`:

1. **Header card** — status + tracking + actions, with progress stepper attached.
2. **Shipment details card** — key/value ledger.
3. **History card** — day-grouped scan timeline.

## 1 · Header card

Top row (`p-4/5`, flex, wraps on narrow):
- **Status pill**: 30px pill, `bg-teal-50 text-teal-800`, 13px/600, leading 8px dot `bg-teal-500`. Label = carrier status mapped to house wording (see states).
- **Tracking block**: eyebrow `TRACKING · {carrier}` (10.5px/600 uppercase, `tracking-[.09em] text-n-400`); tracking number **mono 14.5px/500** + 24px copy icon-button (`border-n-200 rounded-md`, hover teal; clipboard write + toast "Tracking number copied"). Tracking number links to the carrier's public tracking page (open new tab) — make the number itself an `<a>` if URL template exists for the carrier, else plain text.
- Spacer, then right-aligned:
- **Expected delivery**: same eyebrow style; value 14.5px/600 `text-teal-800`, date format per user locale (mockup: `Thu 10/09/2026`). If carrier gives a window, show `Thu 10/09, 09:00–13:00`. If none: value "Pending" in `text-n-400`.
- **Refresh button**: 34px ghost (`border-n-200`, hover teal), refresh icon + "Refresh". Triggers carrier re-poll; while pending swap label to "Refreshing…" and disable. Show "Updated {relative time}" as a tooltip or small caption if last-poll time is available.

**Stepper** (attached strip, `border-t n-100 bg-n-25/[#FBFCFD]`, padding 20/24):
- 5 equal columns (`grid-cols-5`): Label created → Collected → In transit → Out for delivery → Delivered.
- Node: 24px circle. Done = teal-500 fill + white check. Current = white fill, 2px teal-500 ring. Todo = `bg-n-50`, 2px **dashed** `n-300` ring.
- Connectors: 2px bars between nodes; teal-500 when the left node is done, `n-200` otherwise.
- Label 12.5px under node — current: 600 `text-teal-800`; done: 500 `text-n-800`; todo: 400 `text-n-400`. Date under label (mono 11px `text-n-400`) only for reached steps — never render empty date slots.
- Exception steps (return-to-sender, customs hold, delivery exception) do not add columns: the current node turns warning-toned (warning ring/fill) and the status pill switches tone; step labels stay canonical.
- Mobile: stepper stays 5-up but labels may wrap to 2 lines; if <360px, hide todo-step labels except the next one.

## 2 · Shipment details card

- Card `p-4/5`; eyebrow header `SHIPMENT DETAILS` (11px/600 uppercase `text-n-400`).
- Two-column grid (`grid-cols-2 gap-x-10`, collapses to one column ≤767px); rows `grid-cols-[120px_1fr] py-2 border-b n-100`, 13.5px.
- Labels `text-n-500`; values 500 `text-n-800`; **machine values mono** (waybill ref, weight, dimensions, dates). Secondary notes inline in `text-n-400` 400 (e.g. `18.9 kg (weighed by FedEx)`).
- Fields (render only what exists — no dashes, no empty rows): Service, Waybill ref, Weight, Dimensions, Packaging, Handling/signature options, Pieces (if >1), Origin → Destination (city, country).

## 3 · History card

- Eyebrow header `HISTORY` + inline caption 11.5px `text-n-300`: "Times are local to each scan".
- Events grouped by day. Day header row: label 12px/600 ("Today", "Yesterday", else weekday) + date mono 11px `text-n-400` + hairline `n-100` filling the rest.
- Event row grid `[52px 20px 1fr] gap-x-2.5`:
  - Time, mono 12px `text-n-500`, right-aligned.
  - Rail: 9px dot + 2px vertical connector (`n-100`) stretching to next event; connector omitted on last event of a day.
  - Latest event overall: dot teal-500 with pale teal ring, title 600. All others: dot `n-300` ring `n-100`, title 400.
  - Title 13.5px `text-n-800`; location line 12px `text-n-400` beneath.
- Order: newest first. Long histories (>12 events): collapse older days behind "Show full history (N earlier events)" ghost link.
- Empty history (label created only): single row "Waiting for first carrier scan" in `text-n-400`.

## States

- **Status pill mapping**: label created → neutral (`bg-n-100 text-n-600`, dot n-400) "Label created"; collected/in transit → teal "On the way"; out for delivery → teal "Out for delivery"; delivered → green (`bg-green-50 text-green-700`, dot green-500) "Delivered"; exception/hold → warning tone with carrier reason as pill label; cancelled → neutral "Cancelled".
- **Delivered**: expected-delivery block becomes "Delivered" + actual timestamp (mono); stepper all teal; refresh hidden.
- **Carrier poll failure**: keep last known data; small warning caption under header row "Couldn't reach {carrier} — showing last update from {time}"; refresh stays enabled. Never blank the page on poll failure.
- **Multiple parcels in one shipment**: parcel switcher tabs above the header card (`Parcel 1 of 3` …), one tracking view per parcel. Out of mockup scope; layout must not assume single parcel structurally.

## Type scale (px)

Values/titles 13.5–14.5 · labels 13.5 · eyebrows 10.5–11 uppercase · meta/captions 11–12 · step labels 12.5. **Mono = JetBrains Mono, tabular-nums**, for every machine value: tracking number, waybill ref, weights, dimensions, times, dates.

## Mobile (≤767px)

Single column, 16px gutters. Header top row wraps: pill + tracking on line 1, expected delivery + refresh on line 2 (delivery left, refresh right). Details grid one column. History unchanged (already narrow-safe). Hit targets ≥44px — enlarge copy/refresh tap areas via padding, not icon size. Same ≤767px breakpoint as the platform's other mobile work.

## Implementation notes

- Same stack as the product page: React 18 + TS + Vite + Tailwind shared preset; icons lucide-react (`copy`, `check`, `refresh-cw`).
- Data comes from the carrier-tracking service already normalized (status enum, events[], expected delivery); map enum → pill/stepper, don't parse carrier strings in the UI.
- Copy interaction: clipboard write, icon swaps to check for 1.5s, toast.
- All timestamps display in scan-local time as delivered by the API; do not convert.
- Conditional rendering rule (house-wide): a field with no value renders nothing.
