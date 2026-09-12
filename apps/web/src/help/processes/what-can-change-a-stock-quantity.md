---
title: What can change a stock quantity
section: Processes
order: 2
summary: Every route by which a number on a shelf moves, and the one rule they all obey.
status: outline
covers:
  - apps/api/src/warehouses/stock.service.ts
  - apps/api/src/warehouses/transfers.service.ts
  - apps/api/src/warehouses/adjustments.service.ts
  # The sale and replacement routes out are performed here. Absent from this list, the freshness
  # check could not see that changing when a sale deducts had made this page wrong.
  - apps/api/src/sales-transactions/sales-transactions.service.ts
reviewed: 2026-09-12
---

# What can change a stock quantity

> **Outline.** The rule below is accurate and worth knowing now; the walkthrough of each route
> is still to be written.

## The one rule

A stock level never changes on its own. Every change writes a **stock movement** in the same
database transaction, so a balance can always be explained by the list of things that produced it.
If a quantity is wrong, the movement history says who made it wrong and when.

## The routes in

- **Goods receipt** — units booked against a purchase order. Also moves the product's average cost.
- **Customer return** — a returned unit put back on a sellable shelf.
- **Manual adjustment (add)** — stock that appeared with no document behind it.
- **Transfer in** — the receiving half of an internal move.

## The routes out

- **Sale** — an order recorded. Stock leaves when the order is saved, not when the parcel goes:
  a draft is an order whose paperwork is unfinished, not one that has not happened, and channel
  orders arrive already shipped. Serial-tracked lines are the exception — they wait until the
  individual units have been named.
- **Replacement despatch** — a second unit sent for the same order.
- **Return to vendor** — units sent back to whoever supplied them.
- **Manual adjustment (remove)** — damage, loss, or a correction.
- **Transfer out** — the sending half of an internal move.

## Still to cover

- Serial-tracked products, and why a transfer of them names the units rather than a count
- Why warehouses and stock are one permission rather than two
- What "included in inventory" does to a warehouse, and how Damaged or Quarantine stock stays
  visible without being sellable
- Stock owed: what happens when something is sold before it is on the shelf
