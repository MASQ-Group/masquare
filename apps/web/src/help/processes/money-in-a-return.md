---
title: Money in a return
section: Processes
order: 3
summary: What happens to revenue, cost and stock when an order is cancelled, returned or replaced.
status: outline
covers:
  - apps/api/src/sales-transactions/sales-transactions.service.ts
  - apps/web/src/components/sales/ResolveTransactionModal.tsx
reviewed: 2026-09-04
---

# Money in a return

> **Outline.** The distinction below is the one that catches people out, so it is stated now;
> the full walkthrough is still to be written.

## Cancelled before despatch is not the same as returned

An order cancelled **before** anything shipped is worth nothing at all: no revenue, no cost of
goods, no fee, no profit. The money was either never taken or is certain to go back, and the
marketplace returns its fee.

This matters because reversing the cost while keeping the revenue — which an earlier version did —
reported a cancelled order as *more* profitable than a fulfilled one, and the bigger the order the
better it looked.

Whether the goods actually went is answered by the **channel**, not by us. An order Amazon
cancelled before despatch and an order nobody has got round to recording look identical in our own
records, and only Amazon can tell them apart.

## Still to cover

- Restocking: when the cost of goods is reversed, and when the unit is a loss
- The three shipping legs a returned-and-replaced order can carry, and that all three count
- Duty on a return leg, which we owe whichever direction the parcel was going
- Refunds, and why a partial refund is not the same as a return
- Serial-tracked units coming back
