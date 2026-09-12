# Runbook — the things you run yourself

Some maintenance jobs are deliberately not on any page: they rewrite figures the revenue and
margin reports are built from, or they spend SP-API budget. They are run by hand, by a person who
has decided to.

This says **where** to run each one, **in what order**, and **what a correct answer looks like** —
so a surprising number is recognisable as surprising.

---

## 1. The three places things run

| Place | What belongs there | Why |
|---|---|---|
| **Browser console**, on the production app, signed in | Every API call below | They need your session. Nothing else has one. |
| **Git Bash**, in `C:\dev\masquare` | `git`, and the read-only `prod-scan.sh` reports | |
| **Railway** | Nothing by hand | It deploys `main` automatically on merge. |

**Not PowerShell for the API calls.** In PowerShell 5.1 `curl` is an alias for `Invoke-WebRequest`,
which takes different arguments and fails confusingly. Use the browser console — it also avoids
handling a token at all.

### Opening the console

Production app → `F12` → **Console** → paste → Enter.

### The call shape

Every call below follows this shape. Only the path and the body change:

```javascript
await (await fetch('/api/PATH', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('masquare.token') },
  body: '{}',
})).json()
```

### One thing that quietly changes the answer

Company scope is `activeId ? [activeId] : allowedIds`. The calls here send **no** `x-company-id`
header, so they cover **every company you are allowed to see** — which is what a one-off estate-wide
correction wants.

To scope a run to the company you have selected instead, add to `headers`:

```javascript
'x-company-id': localStorage.getItem('masquare.activeCompanyId')
```

If a count comes back far smaller than expected, this is the first thing to check.

> `recalculate` is the exception: it has no company scoping at all and always sweeps everything.

---

## 2. Dry run first, always

Every job that rewrites figures takes `body: '{}'` as a **dry run**: it writes nothing and returns
what it *would* do. Only `{"confirm":true}` writes.

Read the dry run before confirming. The numbers are also worth keeping — they are the before side of
any check you make afterwards.

`relink` and `recalculate` have no dry run; both are idempotent and safe to repeat.

---

## 3. The VAT chain — order matters

These three depend on each other. **Run them in this order.** Out of order, step 2 leaves orders at
the wrong rate, because the rate follows the flag.

```
  1. repair-vat-flag        who collected the tax
          ↓
  2. recalculate            the rate follows that answer
          ↓
  3. repair-channel-collected-tax    the amount follows it too
```

### Step 1 — who collected

```javascript
await (await fetch('/api/integrations/repair-vat-flag', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('masquare.token') }, body: '{"confirm":true}' })).json()
```

Returns a **job id**, not a result — the Amazon half calls the marketplace once per order.

Poll it:

```javascript
await (await fetch('/api/jobs/PASTE_JOB_ID', { headers: { Authorization: 'Bearer ' + localStorage.getItem('masquare.token') } })).json()
```

**What to expect**

- `flaggedFromStoredData` and `clearedFromStoredData` land almost immediately — eBay and OnBuy are
  decided from figures already stored, before the first Amazon call.
- The Amazon pass then runs at roughly 3 orders a second (a deliberate throttle; without it the run
  takes 429s and leans on retries).
- `failed` should be **0**. It is now honest — it used to tick failures as successes.
- `notCollected` is not a failure. It means Amazon said it did not collect on that order.

### Step 2 — the rate

```javascript
await (await fetch('/api/sales-transactions/recalculate', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('masquare.token') }, body: '{}' })).json()
```

**Wait for step 1's job to finish first.**

⚠ This sweeps **every** transaction and re-derives FX, shipping service, product links and VAT class
alongside the rate. It is the broadest job here — out of hours is the cautious choice.

**What to expect:** orders the marketplace collected on move to **0%**; EU destinations take the
destination's own rate (Ireland 23%, Malta 18%); Northern Ireland stays at **20%**, because it is a
GB country code inside the EU VAT area and the VAT really is ours.

### Step 3 — the amount

Dry run:

```javascript
await (await fetch('/api/sales-transactions/repair-channel-collected-tax', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('masquare.token') }, body: '{}' })).json()
```

**Admin only.** Read `orders`, `taxRemoved`, `byChannel`, `byMonth`. Then confirm with
`body: '{"confirm":true}'`.

**What to expect**

- Profit in **€ does not move**. Tax has never been in it, except Japanese consumption tax, which
  this never touches.
- Revenue **ex-VAT does not move** — that is the default Analytics figure.
- Revenue **inc-VAT falls**, and the **"VAT collected"** figure on Analytics → Countries falls with
  it. That is the correction.
- **Margin % shifts in both directions** — better on profitable orders, worse on loss-making ones.
  The denominator loses the tax, so a loss becomes a larger share of a smaller base. Profit in
  currency did not change.
- `linesMoved` / `taxMoved` counts tax that was **relocated rather than dropped** — a figure sitting
  in `vatAmount` on an order to a country that has no VAT (the US, or a GST country) is misfiled
  rather than disputed, so it moves into `salesTaxAmount` instead. It is a subset of `taxRemoved`,
  not a total beside it: revenue moves by the same amount either way.
- `refusedNoSalesTax` counts orders where VAT sits on the line with no reported total behind it **and
  the destination really does have a VAT** — so the money might be yours and nothing on file says.
  Those are **refused, not emptied**; zeroing would destroy the only copy of the figure. They need a
  person.

Nothing here is destructive: `salesTaxAmount` always keeps the full figure.

To see the decision rather than the totals — which orders take which branch — from Git Bash in
`C:\dev\masquare`:

```bash
REPORT=step3-plan bash scripts/prod-scan.sh
```

It runs the shipped planner over production and writes nothing. Use it when a dry run returns a
different count than you expected: `step3-candidates` lists what would be cleared straight from the
database, with no date window, which a comparison against a spreadsheet cannot do.

---

## 4. Channel listings

### Link live listings to their product

```javascript
await (await fetch('/api/channel-listings/relink', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('masquare.token') } })).json()
```

No dry run; idempotent. Runs automatically whenever a product's SKUs change — this is for the
backlog from before that existed.

**Expect** `claimed` (rows linked), `moved` (rows that changed product — rare, and worth a look if
non-zero), and `unknownSku`, which is **not a failure**: it counts listing SKUs the catalogue cannot
name an owner for. Guessing one would attach a stock figure to the wrong listing.

### See the unknown ones

```javascript
await (await fetch('/api/channel-listings/unknown-skus', { headers: { Authorization: 'Bearer ' + localStorage.getItem('masquare.token') } })).json()
```

A worklist, not a job: counts by channel plus the first 500 SKUs. Each needs an alias defining on a
product, or a product creating. Until then the availability push cannot see them — that is stock you
believe you are publishing and are not.

---

## 5. Checking afterwards — read-only, from Git Bash

These never write. They read production through the Railway CLI; the connection string is never
printed.

```bash
REPORT=vat-flag-state bash scripts/prod-scan.sh
```

| Report | Answers |
|---|---|
| `vat-flag-state` | Where the collected flag stands, by channel |
| `ebay-flag-gap` | eBay orders the marketplace collected on that nothing has flagged |
| `collected-tax-repair-preview` | What step 3 would remove, without running it |
| `marketplace-vat-overstated` | VAT recorded as ours that the channel kept |
| `push-coverage` | Listings the availability push cannot see |
| `alias-listing-coverage` | Whether alias-SKU listings are linked |
| `jct-classification-check` | The one tax classification that moves profit |
| `country-rate-check` | The destination rates the VAT fallback depends on |
| `step3-plan` | Which branch step 3 takes on each order — move, zero or refuse |
| `step3-candidates` | What step 3 would clear, from the database, with no date window |
| `order-forensics` | Everything stored about one order (`REF=...`), for the ones a repair refuses |
| `us-tax-shape` | Whether US sales tax landed in the right column |

`REPORT=` with anything unrecognised prints the full list.

Two take a file of facts to compare against:

```bash
FACTS=/path/to/amazon-facts.json REPORT=vat-order-review bash scripts/prod-scan.sh
FACTS=/path/to/channel-facts.json REPORT=channel-vat-review bash scripts/prod-scan.sh
```

---

## 6. Shipping a change

Railway deploys `main` on merge. Work happens on a dated branch.

```bash
git switch -c 12-09-2026        # or today's date
# ... commits ...
git push -u origin 12-09-2026
gh pr create --base main --head 12-09-2026 --title "..." --body "..."
```

Merge on GitHub. Railway builds in roughly 6–9 minutes.

**A migration runs `migrate deploy` before the app boots**, so its output is above whatever window
`railway logs` returns. "The app started" is not evidence the table exists — check it:

```bash
REPORT=migration-state bash scripts/prod-scan.sh
```

---

## 7. If something looks wrong

**A count far smaller than expected** — company scope. See §1.

**A job stuck at `total: null`** — it is still assembling its candidate list. Give it a moment.

**`failed` above zero on the Amazon pass** — pull the reason:

```bash
railway logs --service "@masquare/api" | grep -i "VAT flag repair"
```

**A sync reporting errors** — the chip on Integrations is clickable. It names the orders and why.

**Numbers that moved when you did not run anything** — a sync re-saves orders through the current
rules, so figures correct themselves as orders come through. Check when the lines were last touched:

```bash
REPORT=when-did-vat-change bash scripts/prod-scan.sh
```
