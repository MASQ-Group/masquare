# FedEx Integration Module — Handoff Brief

**For:** Claude Code, maSquare ERP
**Prepared:** 8 September 2026
**Status:** Requirements and constraints. Architecture, stack and patterns are yours — this document contains no implementation direction.

---

## 1. Purpose

Build a FedEx module in the maSquare ERP that connects to our existing FedEx account and covers: rate quoting, shipment creation and label generation, pickup booking, customs documentation, tracking, and reconciliation of FedEx charges against our orders.

FedEx exposes a REST API programme. It is free with an account — we pay for shipping, not for calls. Authentication is OAuth 2.0 client credentials; payloads are JSON.

The legacy SOAP platform (FedEx Web Services) went maintenance-only on 1 July 2026. It is not an option. Everything below is REST.

---

## 2. Hard constraints

These cannot be engineered around. They are properties of what FedEx sells, and they shape scope.

**2.1 — There is no billing or invoice API.** Nothing FedEx publishes returns invoices, charges or account financials. Freight cost data arrives as a scheduled file (CSV or EDI) over sFTP, arranged through FedEx billing separately from the developer portal. The module must therefore ingest a file feed for cost reconciliation, not call an endpoint. See §8.

**2.2 — There is no shipment-history query API.** FedEx will not hand back what we shipped. `Retrieve Async Ship` returns only a job we ourselves submitted, keyed by job ID. Tracking data is retained 90 days after delivery and carries no charge information. **The ERP must be the system of record.** Every shipment we create has to be persisted on our side at creation time — tracking number, our order reference, the service selected, and the rate we were quoted — because none of it can be recovered from FedEx later. This is also what makes invoice reconciliation possible at all (§8).

**2.3 — Tracking webhooks are not available to us.** FedEx's push product, Advanced Integrated Visibility, is sold only to US accounts; the pricing terms state this and the service description scopes eligible shipments to US and Canada domestic lanes. There is no EU purchase path. Tracking must be retrieved by polling the free Track API. Volumes are not the constraint: 30 tracking numbers per call, 100,000 calls per day.

The Track API also offers "notifications" — these send email and SMS to people. They are not callbacks to a server. Do not mistake them for a webhook facility.

**2.4 — Label generation requires manual certification before production.** See §7. This gates go-live and involves a human FedEx review with a multi-day queue.

**2.5 — Every FedEx API uses POST or PUT**, including pure lookups such as rating and tracking. Do not infer idempotency from the fact that a call reads like a query.

---

## 3. Prerequisites — human actions, some blocking

| # | Action | Owner | Blocks |
|---|---|---|---|
| 1 | Create the developer organisation on the FedEx portal, **selecting Cyprus as the project country** — this determines which sandbox account is assigned | maSquare | Everything |
| 2 | Attach and verify our FedEx shipping account to the organisation | maSquare | Any move to production |
| 3 | Create the API project; obtain API Key and Secret Key for sandbox and production | maSquare | Development |
| 4 | Request basic certification for the APIs that need it (§6) — email support rep with production key and API list | maSquare | Address Validation, Pickup, Trade Documents |
| 5 | Open the EDI/CSV billing feed request with our FedEx Cyprus billing contact | maSquare | Phase 4 (§8) — long lead time, start now |
| 6 | Resolve the open questions in §11 | maSquare | Service catalogue scope, Phase 4 design |

At least one **verified** FedEx account must be attached to the organisation before any project can move from sandbox to production. Development can start before this; deployment cannot.

---

## 4. APIs in scope

Grouped by the approval each requires, because that determines what can ship first.

### 4.1 No approval — available immediately

| API | Role in the module |
|---|---|
| **API Authorization** | Issues the bearer token every other call requires |
| **Rates and Transit Times** | Our negotiated account rates and delivery estimates for an origin/destination pair, including surcharges and special services. Feeds quoting on sales orders. |
| **Service Availability** | Which services actually run between two postcodes. Prevents offering a service not sold on that lane. |
| **Postal Code Validation** | Validates postcode / city / country combinations, returns service area |
| **FedEx Locations Search** | Drop-off points and ShipCentres with opening hours, by address or coordinates |
| **Basic Integrated Visibility** (Track) | Tracking by tracking number (30 per call), by our own reference number, by door tag; signature proof of delivery |

### 4.2 Basic certification required

| API | Role in the module |
|---|---|
| **Address Validation** | Cleans and classifies delivery addresses, business vs residential. Up to 100 per request, 40+ countries. |
| **Pickup Request** | Checks availability, books a courier, cancels a booking |
| **Trade Documents Upload** | Electronic Trade Documents — sends the commercial invoice and customs paperwork digitally instead of printing and pouching it. Up to 5 documents per transaction. |

Basic certification is an email exchange, not a technical review: send the production API key and the list of APIs to our support representative, wait for confirmation. FedEx publishes no turnaround time for this step.

### 4.3 Label certification required

| API | Role in the module |
|---|---|
| **Ship** | Creates the shipment, returns tracking number and encoded label. Operations: Create Shipment, Validate Shipment, Cancel Shipment, Retrieve Async Ship, Create Tag / Cancel Tag (returns). Sync and async (batch) modes. |
| **Open Ship** | Builds a consignment incrementally over a five-day window before confirming. Relevant only if we pick orders across multiple days — confirm need before scoping. |

### 4.4 EU compliance — see §5 and §10

| API | Role in the module |
|---|---|
| **Regulatory** | Stores per-product compliance data against our SKUs: EU de minimis filing and Product Identifiers. Launched June 2026, up to 25 product profiles per request. Certification tier is not published — see §11. |
| **Global Trade** | Returns which licences, statements and advisories a given shipment requires before booking |

Note: the Regulatory API stores and transmits data. It does **not** file entries with the EU Commission or any other authority.

### 4.5 Explicitly out of scope

- **Advanced Integrated Visibility** (webhooks) — US accounts only, §2.3
- **Ground End of Day Close** — US Ground only, irrelevant to a Cyprus origin
- **Returns API** — requires a separate FedEx Returns Technology portal profile we do not hold. Note that basic return labels are available through the Ship API's Create Tag operation without it.
- **Dangerous Goods API** — restricted to DG-approved shippers and partners
- **Credential Registration** — only relevant if maSquare resells the ERP to companies shipping on their own FedEx accounts. Not current scope; flag if that changes.
- **Freight LTL** — not currently in scope; confirm if we move freight

---

## 5. Data the ERP must supply

These are FedEx and EU customs requirements, not preferences. Where the ERP does not currently hold a field, it needs one.

### 5.1 Product master

| Field | Requirement |
|---|---|
| **HS code** | Minimum 6 digits, **per line item**. Required by ICS2. |
| **Goods description** | Accurate and specific. Generic descriptions cause holds. |
| **Country of origin** | Per commodity |
| **Merchant Product Identifier** | Mandatory for B2C EU imports from 1 Nov 2026 |
| **Manufacturer Product Identifier (non-standardised)** | Same deadline |
| **Manufacturer Product Identifier (standardised)** | Same deadline. Regulatory API accepts SKU, PART_NUMBER, GTIN, UPC, EAN, MPN, OTHER as identifier types. |
| Weight, dimensions, unit value | Per commodity, for customs valuation and rating |

FedEx states explicitly that supplying this data **only on the commercial invoice**, rather than in the structured API fields, "will likely lead to delays." It has to be structured data in the ERP, not free text.

### 5.2 Customer / partner master

| Field | Requirement |
|---|---|
| **EORI** | Recipient EORI on B2B shipments. Absent values cause 24–72 hour customs holds — this is the single most common EU failure. |
| **VAT number** | Recipient-side where applicable |
| Address, contact, phone | Recipient details; residential vs business classification affects rating |

### 5.3 Company-level configuration

| Field | Requirement |
|---|---|
| **IOSS number** | Seller-level configuration, not per-order. The common failure is treating it as an order field — it gets omitted and VAT is charged at the border. |
| Shipper EORI, VAT, TIN | Our own identifiers |

EORI, VAT, IOSS and other tax identifiers travel in the TIN arrays inside `customsClearanceDetail` on the Ship API request — both shipper-side and recipient-side.

### 5.4 Service catalogue

Cyprus-origin services available to us: FedEx International First, International Priority Express, International Priority, International Connect Plus, International Economy, plus International Priority and Economy Freight.

`FEDEX_GROUND`, `GROUND_HOME_DELIVERY`, `SMART_POST` and `FIRST_OVERNIGHT` are US/Canada domestic enums and will error from a Cyprus origin. Do not expose them.

`FEDEX_REGIONAL_ECONOMY` (intra-Europe, former TNT road network) is unconfirmed from Cyprus — see §11. Do not build it into the selector until confirmed.

---

## 6. FedEx platform rules

Constraints imposed by FedEx that bound how the module may behave. How you satisfy them is yours.

| Rule | Detail |
|---|---|
| **Token endpoint** | `POST /oauth/token`, grant type `client_credentials`. Returns a bearer token, `expires_in` 3600. |
| **Token throttle — critical** | The token endpoint is throttled separately and harshly: roughly 3 requests/second burst, 1/second sustained, **per IP**. Breaching it earns a **10-minute ban**, extended on repeat. FedEx's own guidance is to cache the token and refresh only on observing a 401 — not pre-emptively. Minting a token per request will take the integration down. |
| **Base URLs** | Sandbox `https://apis-sandbox.fedex.com` · Production `https://apis.fedex.com` |
| **Rate limit** | 1,400 transactions per rolling 10-second window, per project. Breach returns HTTP 429. |
| **Daily quotas** | Per capability, per project — 100,000/day for tracking. Plus an organisation-wide daily cap that varies by account and is only visible in the portal. See §11. |
| **Batch limits** | Tracking 30 numbers per call. Address Validation 100 addresses per call. Trade Documents 5 per transaction. Regulatory 25 product profiles per request. |
| **Versioning** | Major version in the path (`/ship/v1/shipments`); minor versions never appear in the URL. A superseded major version is supported for two further years. |
| **Credential handling** | The secret key is server-side only. Never in client code, never in version control. |

**Sandbox limitation worth knowing before planning test coverage:** most APIs are *virtualised* in sandbox — they return canned responses regardless of input, with only country codes validated on address fields. Sandbox will confirm authentication, serialisation and error handling. It will not confirm that our customs data is correct or that a service is valid on a lane. Real validation needs live test shipments after the account is verified.

**Endpoint paths:** FedEx does not publish these in machine-readable form outside a logged-in portal session. Take them from the JSON API collection on each API's documentation tab in the portal rather than from any third-party listing.

---

## 7. Label certification workflow

Required before Ship or Open Ship work in production. It is a manual FedEx review of physical print quality, and it has a queue.

1. Develop against sandbox with test credentials.
2. Generate representative labels in the test environment — domestic, international, multi-piece.
3. Move the project to production in the portal to obtain production credentials.
4. **Print the labels physically**, on the printer and stock we will actually use, and scan them at **600 DPI minimum**. FedEx states in capitals that files generated directly by the API are not accepted — they are checking barcode quality on our hardware. Thermal printers must use the correct format (ZPL II for Zebra).
5. Complete the Label Cover Sheet — contact details, planned services, account number, production API key — and submit with each label batch to `label@fedex.com`.
6. The Bar Code Analysis group evaluates within **three business days** and either approves or requests corrections. Print quality and unintended scaling are the leading causes of failure; assume at least one resubmission cycle.
7. On approval, production credentials are authorised for label transactions, confirmed by email.

**Scheduling implication:** this is the long pole and it is mostly queue time outside our control. It should be started as soon as the module can produce a representative label, not after the Ship integration is complete.

Label output formats available: PDF and PNG for laser stock, ZPL II and other thermal formats. Label stock size, doc-tab content and inclusion of regulatory labels are all controllable in the request.

---

## 8. Cost reconciliation — the file feed

Because there is no billing API (§2.1), FedEx charge data arrives as a scheduled file.

**What to request from FedEx:** the **CSV selectable invoice over sFTP**, delivered daily. This carries the same content as the X12 110 (Express) and 210 (Ground/Freight) transaction sets but needs no X12 parser or translator. Column selection is configurable, and FedEx publishes an Invoice File Data Dictionary defining every field.

**What each record contains:** one record per tracking number — shipper and recipient addresses, service and packaging codes, **our own reference and department codes as we supplied them at label time**, proof of delivery for Express, and **21 separate charge categories** including base freight, volume and earned discounts, fuel, residential, delivery-area surcharge, declared value, signature, additional handling, address correction, plus **duties and VAT**. Duty and tax invoices for international shipments arrive as separate invoices. Everything billed to the enrolled accounts is included except Same Day Service.

**Delivery options:** sFTP (push or pull), AS2, secure web upload/download, or VAN. Daily or weekly.

**Enrolment:** through our FedEx Cyprus country billing contact or account manager. The US enrolment mailbox is `EDIInvandRemit@fedex.com` but EU entities route through the country billing department. No minimum volume is published. **Confirm sFTP availability for our EU billing entity before designing around it** (§11).

**EU caveat:** remittance advice (EDI 820) is documented as US-payor only. Non-US customers are directed to their country billing department. Assume we receive invoice data, not remittance.

**Why §2.2 matters here:** the reference and department codes we send on the Ship request come back on the invoice record. That is the join key between a FedEx charge and a maSquare order. If we do not send our references at label time, reconciliation is not possible afterwards — FedEx has no other handle on our order.

**Weaker fallbacks, for context only:** FedEx Billing Online can auto-generate a CSV/XML file whenever an invoice is issued, but only into a download centre inside the portal — it pushes nothing out. "Billing by Email" sends a PDF, requiring OCR. Neither is a supportable integration target; both are mentioned so they are not proposed as alternatives later.

---

## 9. Suggested phasing

Ordered by dependency and deadline, not by effort.

**Phase 1 — Foundation and read path.** Authentication, then Rates and Transit Times, Service Availability, Postal Code Validation, Locations, Basic Integrated Visibility. No FedEx approval required for any of these, so this phase can reach production as soon as the account is verified. Delivers live quoting and tracking into the ERP.

**Phase 2 — Shipping.** Ship API: create, validate, cancel, return labels. Pickup Request. Address Validation. Label certification submission starts as soon as Phase 2 can produce a representative label, and runs in parallel with the remainder of the work rather than after it.

**Phase 3 — EU compliance.** Product and partner master extensions per §5, Trade Documents Upload, Regulatory API for Product Identifiers, Global Trade where useful. Fixed external deadline of 1 November 2026 (§10).

**Phase 4 — Cost reconciliation.** Invoice file ingestion and matching per §8. The FedEx-side enrolment request should be raised at the start of the project, not at the start of this phase, because the lead time is theirs.

---

## 10. Fixed external deadlines

| Date | Event | Consequence |
|---|---|---|
| **1 Jul 2026** *(passed)* | EU €150 de minimis duty exemption removed | €3 customs duty per declaration line now applies. FedEx recommended supplying Product Identifiers from this date onward, ahead of enforcement. |
| **1 Nov 2026** | **EU Product Identifiers become mandatory** on B2C import declarations | Three PIDs required per product (§5.1). An EU-wide handling fee also begins; the amount was still being finalised by the EU at time of writing. If maSquare handles B2C imports into the EU, Phase 3 must land before this date. |
| **1 Jul 2026** *(passed)* | FedEx Web Services (SOAP) moved to maintenance-only | Not applicable to a new build, recorded so the legacy stack is never proposed. |

ICS2 is already fully in force — Phase 1 (air) since March 2023, Phase 2 (road, rail, maritime) since April 2025. The 6-digit HS code and EORI requirements in §5 are live obligations today, not future ones.

---

## 11. Open questions — blocking or scope-affecting

Raised with our FedEx account manager. Answers change scope; do not guess.

1. **Can our Cyprus billing entity receive the CSV selectable invoice over sFTP daily, and what is the enrolment lead time?** — Blocks Phase 4 design. If sFTP is unavailable for our entity, the reconciliation approach has to change.
2. **Which certification tier applies to the Regulatory API, and what is the turnaround?** — FedEx publishes no tier for it. Given the 1 November deadline, an unexpected certification queue is a schedule risk.
3. **Is FedEx Regional Economy available with Cyprus as origin?** — Determines whether intra-Europe road service appears in the service catalogue (§5.4). Currently excluded.
4. **Is there any roadmap for Advanced Integrated Visibility outside the US?** — If no, polling is permanent and can be treated as final rather than transitional.
5. **Who is our named API support representative, and what is our organisation's daily transaction quota?** — Needed for basic certification requests (§3 item 4) and to size against the org-wide daily cap (§6).
6. **Do we need Open Ship?** — Only if orders are picked across multiple days. Internal question; excluded from scope until confirmed.
7. **Will maSquare ERP be sold to other companies shipping on their own FedEx accounts?** — If yes, the Credential Registration API and a provider-tier certification enter scope, which materially changes the credential model. Internal question, worth settling early because it is expensive to retrofit.

---

## 12. Reference

- FedEx Developer Portal, Cyprus: https://developer.fedex.com/api/en-cy/home.html
- API catalogue: https://developer.fedex.com/api/en-us/catalog.html
- Quotas and rate limits: https://developer.fedex.com/api/en-us/guides/ratelimits.html
- Best practices (base URLs, token caching): https://developer.fedex.com/api/en-us/guides/best-practices.html
- API versioning: https://developer.fedex.com/api/en-us/guides/versioning.html
- Sandbox virtualisation: https://developer.fedex.com/api/en-us/guides/sandboxvirtualization.html
- Certification tiers: https://developer.fedex.com/api/en-us/project/certification.html
- Shipper certification steps: https://developer.fedex.com/api/en-us/certification/shipper.html
- Ship API: https://developer.fedex.com/api/en-cy/catalog/ship/docs.html
- Regulatory API: https://developer.fedex.com/api/en-cy/catalog/regulatory/docs.html
- Trade Documents Upload: https://developer.fedex.com/api/en-us/catalog/upload-documents.html
- Basic Integrated Visibility: https://developer.fedex.com/api/en-us/catalog/track.html
- EDI invoicing and remittance overview: https://www.fedex.com/content/dam/fedex/us-united-states/services/FedEx_EDI_Invoicing_and_Remittance_Overview_Guide-April2021.pdf
- CSV selectable invoice specification: https://www.fedex.com/content/dam/fedex/us-united-states/services/csv_selectable_invoice_and_fixed-length_remittance_records.pdf
- EU de minimis removal 2026: https://www.fedex.com/en-cn/service-news/eu-customs-reform/de-minimis.html
- ICS2: https://www.fedex.com/en-us/regulatory-news/ics2.html

Figures dated in this brief — quotas, service enums, deadlines, fee amounts — should be re-confirmed against the portal before they are relied on in code.
