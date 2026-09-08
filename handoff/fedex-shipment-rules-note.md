# Shipment defaults as rules, not as memory

**Raised:** 8 September 2026, during the FedEx review
**Status:** Design note. Nothing built — the outcome vocabulary has to come from FedEx's actual Ship
request fields, and we hold no API credentials yet.

---

## The problem, in the words it was raised in

> *"If an order was placed on Amazon AE and is shipped to the AE we need to cover/pay any import
> duty taxes at the delivery location, so in this case the system must autoselect this option in
> FedEx shipment creation… I want to do so so I avoid our team forgetting to state important things
> during creating a FedEx shipment that might cause us problems later."*

The failure being designed against is not ignorance. It is a person who knows the rule perfectly
well, creating the fortieth shipment of the day, and not thinking of it. A checklist in somebody's
head is not a control, and neither is a note in a manual.

## Why this one matters more than it looks

The Amazon AE example is a duties-and-taxes term — DDP (we pay duty at the border) versus DAP (the
buyer is billed on delivery). Getting it wrong is not a label defect that shows up at print time.
It shows up days later as a customer who has been asked for money they did not expect, on a
marketplace whose policy forbids exactly that.

It also has a money consequence the ERP already models: `Shipment.dutyImportEur`. A rule that says
"we bear the duty here" is asserting a cost, so the shipping-cost estimate and the profit figure
have to know about it too. This is not purely a carrier-form default.

## Shape

Two halves, and the second is the one that actually prevents the problem.

**Conditions** — everything the rule can match on. Nearly all of it already exists on the order:

| Input | Where it lives today |
|---|---|
| Sales channel / marketplace | `SalesTransaction.salesChannelId` |
| Destination country | `SalesTransaction.destinationCountryId` |
| Order value | transaction totals |
| Business or residential | `SalesTransactionAddress.isBusiness` (added 8 Sep) |
| Recipient EORI present | `SalesTransactionAddress.eori` (added 8 Sep) |
| Hazmat / battery | `Product.hazmatClassId`, `batteryRequired` |
| Weight and dimensions | `Product.packageWeightKg` and the dimension columns |

So the matching side needs almost no new data. That was not obvious before the address work landed.

**Outcomes** — what the rule sets on the shipment. Provisional, because the field names must come
from FedEx's Ship request rather than from us:

- Who pays duties and taxes (the AE case)
- Service level
- Signature requirement
- Declared value / insurance
- Electronic Trade Documents on or off
- Incoterm on the commercial invoice

## The part that does the work

A rule that silently fills a field is only half a control, and the weaker half. Somebody who does
not know the rule exists cannot check it, and a default nobody notices is a default nobody
questions.

So: **every applied rule states itself on the shipment screen, in the words of the rule.** Not a
pre-ticked box, but a line saying *"Amazon AE to AE — we pay duties and taxes at destination"*.

And **overriding is allowed, but never silent.** A person may have a reason the rule cannot know.
They should be able to act on it, and be asked to say why in a sentence that is stored with the
shipment. That converts the two failure modes worth caring about — the rule was wrong, and the rule
was ignored — from invisible into reviewable.

This is the same shape as the review tick on shipping costs: the record says who asserted what, and
when.

## Open questions before anything is built

1. **Which rules, exactly?** The AE one is confirmed. The rest were described as "other rules will
   apply also" — they need writing down, because each one is a claim about a marketplace's policy or
   a customs regime, and a wrong rule applied automatically is worse than no rule.
2. **Where do rules live — code or data?** A settings screen where anybody can add one is flexible
   and dangerous: a bad rule then applies to every shipment silently. Given the consequences here, my
   inclination is a small, reviewed, seeded set with a settings screen that can enable and disable
   them but not invent them. Worth deciding deliberately rather than by default.
3. **What happens when two rules match and disagree?** Needs an answer before there are two rules,
   not after.
4. **Does a duties-paid rule feed the profit calculation?** It should — otherwise the margin on
   every AE order is overstated by the duty we have committed to pay. That is a pricing change, not
   a shipping one, and it deserves its own decision.

## Dependency

Nothing here can be built until the FedEx developer organisation exists and we can read the Ship
request schema (handoff §3, items 1–3). Guessing the outcome field names would produce a rules
engine that has to be rewritten the day real credentials arrive.
