# What a booked shipment must record

**Written:** 8 September 2026, before building the Ship API
**Status:** Design. Not built — the Ship request schema has to come from FedEx's own collection.

---

## Why this needs deciding before any code

Handoff §2.2, which is the most consequential paragraph in the brief:

> There is no shipment-history query API. FedEx will not hand back what we shipped… **The ERP must
> be the system of record.**

Rating is forgiving — a bad quote is a wrong number on a screen and can be asked for again. Booking
is not. Whatever we fail to record at the moment a label is created is gone, and §8 makes the
consequence concrete: the reference codes we send on the Ship request are what come back on the
invoice file, and they are the only join between a FedEx charge and a maSquare order. Get that wrong
and reconciliation is not merely harder later, it is impossible.

## What the Shipment model holds today

| §2.2 requires | Held now? |
|---|---|
| Tracking number | `Shipment.trackingNumber` |
| Our order reference | via `transactionId` → `transactionRef` |
| The service selected | `shippingServiceId` — but that is *our* courier config, not a FedEx service type |
| The rate we were quoted | **No.** `shippingCostEur` is the ACTUAL cost, entered from a despatch note or invoice |

So two of the four are genuinely missing, and the fourth is the interesting one.

## The finding worth acting on

**We record what a shipment cost, never what we were told it would cost.**

Today that is unavoidable — nobody quotes us in a form the platform can capture. Booking through
FedEx changes it: the quote arrives with the label, for free, at the moment of creation.

That turns the cost review shipped earlier today into a genuine three-way check:

- **quoted** — what FedEx said when the label was bought
- **invoiced** — what the CSV invoice feed says weeks later (§8)
- **reviewed** — accounting confirming the two agree

A discrepancy between the first two is the thing worth alerting on, and it is invisible without the
first. Storing the quote also makes the existing `reviewedAt` tick mean more than "somebody looked".

## What to persist at creation

Beyond what exists:

- **Which carrier account booked it.** Determines which account is billed, and is required to cancel
  the shipment or to match its charges. Not derivable afterwards.
- **The FedEx service type and name**, as sent and as returned. Ours is a different vocabulary.
- **The quoted rate**, in the quote's own currency and in euro, with the surcharges that made it up.
- **The label itself** — object storage, as `ProductDocument` already does, with its format (PDF or
  ZPL). FedEx returns it encoded in the reply and will not return it again.
- **Every identifier FedEx gives back**, including the per-piece tracking numbers on a multi-piece
  shipment. A parcel group here maps onto the group work already in Shipments.
- **The reference codes we sent.** §8's join key. Storing what we sent, rather than assuming it,
  is what makes a later mismatch diagnosable.
- **Cancellation state.** A cancelled label is not a deleted row; the charge may still appear.

## Open until the collection arrives

The field names above are ours and stable. What is not settled is what FedEx *returns* — whether
there is a shipment identifier distinct from the master tracking number, how per-piece tracking
numbers are structured, and how the label is encoded. Those come from the Ship API's JSON collection
in the portal, the same way the rate schema did.

Writing the schema before that risks columns with nothing to put in them, and a second migration to
correct them.
