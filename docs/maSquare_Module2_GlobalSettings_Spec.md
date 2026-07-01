# maSquare Platform — Module 2: Global Settings

**Status:** Updated draft · **Scope:** The Global Settings shell and the **Product reference data** it manages — Vendors, Brands/Manufacturers, Product Types, Fulfilment Types, Categories, and Attributes — plus **platform-wide format settings** (measurement system and date format).

Builds on Module 1 (foundation) and the Design System. Reuses the three shared components — smart reference input, bulk import, modal shell — throughout.

---

## 1. Page structure

Global Settings opens a page with **horizontal tabs across the top**. A **General** tab holds platform-wide settings; one tab per **module** holds that module's settings (only **Products** is defined now — future-module tabs appear as those modules are built).

The **Products** tab is organised into six managed-list sections, each using the standard table + modal + smart-input + bulk-import pattern:

1. Vendors
2. Brands / Manufacturers
3. Product Types
4. Fulfilment Types
5. Categories
6. Attributes

The **General** tab holds platform format settings (§9).

---

## 2. Reference-data ownership

**Decision (still flagged):** Product reference data is **platform-global** — one shared library used by every company. Rationale: products are co-owned across companies (Module 1 §3), so anything a product points to must be visible wherever that product is. Reversible: if Vendors later need per-company scoping, that section can be scoped without disturbing the others.

---

## 3. Vendors

A supplier record products can be purchased from.

| Field | Type | Notes |
| :--- | :--- | :--- |
| name | text, **required** | Vendor name |
| vat_number | text (mono) | |
| address | structured | line1/line2, city, region, postal code, country |
| phone | text (mono) | Main line |
| email | text | |
| website | text | |

**Contacts** (repeatable — one vendor -> many):

| Field | Type | Notes |
| :--- | :--- | :--- |
| contact_name | text | |
| contact_phone | text (mono) | |
| contact_email | text | |
| contact_type | enum | `person` / `department` |
| contact_role | text | e.g. Sales, Accounts |

---

## 4. Brands / Manufacturers

| Field | Type | Notes |
| :--- | :--- | :--- |
| name | text, **required** | Brand / manufacturer name |
| website | text, optional | Reserved for later enrichment |

---

## 5. Product Types

A managed list of product types (e.g. Hair Straightener, Shaver, Trimmer), selected on a product. Defining types here makes them appear as suggestions; creating one inline from a product (create-on-confirm) also adds it here.

| Field | Type | Notes |
| :--- | :--- | :--- |
| name | text, **required** | e.g. Hair Straightener |

---

## 6. Fulfilment Types

A managed list of fulfilment methods — **not hard-coded values**, so new methods can be added as they arise. Seeded with FBA and FBM.

| Field | Type | Notes |
| :--- | :--- | :--- |
| name | text, **required** | e.g. Fulfilled by Amazon |
| code | text, optional | Short code, e.g. FBA / FBM |
| active | bool | Whether it is available for selection |

---

## 7. Categories

A **multilevel category tree** of arbitrary depth.

- **Create Category** modal: `name` (required) + `parent` (smart-dropdown of existing categories, optional).
  - No parent -> **Level 1**; parent at L1 -> **L2**; parent at L2 -> **L3**; and so on.
- Categories display as an **expandable tree**, with an "add child" affordance on any node that pre-fills that node as the parent.
- Reordering and re-parenting are done by **drag-and-drop** (dnd-kit).

| Field | Type | Notes |
| :--- | :--- | :--- |
| name | text, **required** | |
| parent_id | fk -> category, nullable | Null = Level 1 |

Level is **derived from depth**, not stored, so moving a subtree recomputes levels automatically. Sibling names are unique under the same parent. A category referenced by products cannot be hard-deleted (soft-delete / reassign on removal).

---

## 8. Attributes

Reusable product characteristics (e.g. *Power Supply Type*, *Plug Type*) with two value modes.

**Attribute:**

| Field | Type | Notes |
| :--- | :--- | :--- |
| name | text, **required** | e.g. Plug Type |
| input_type | enum, **required** | `predefined` / `free_text` |

**Value modes:**

- **Predefined** — you define the allowed set up front (e.g. Plug Type: `UK`, `EU`, `US`); on a product the user may only choose from that set.
- **Free text** — the user types a value on the product; every entered value is stored and offered as a suggestion for that attribute on future products (behind the standard create-on-confirm prompt).

**Attribute values:**

| Field | Type | Notes |
| :--- | :--- | :--- |
| attribute_id | fk -> attribute | |
| value | text | mono where the value is a code/figure |

Attributes are **never auto-assigned** to products — users assign them manually per product (Module 3 §1.7).

---

## 9. General — platform format settings

Platform-wide display/format defaults, editable on the **General** tab. The platform uses the **metric system** and **dd/mm/yyyy** dates by default; both are changeable here.

| Setting | Default | Options |
| :--- | :--- | :--- |
| Measurement system | **Metric** | Metric (cm, kg) / Imperial (in, lb) |
| Date format | **dd/mm/yyyy** | dd/mm/yyyy · mm/dd/yyyy · yyyy-mm-dd |

The measurement system drives weight/dimension units and the volumetric-weight divisor; the date format drives how every date renders across the platform. Scope is platform-wide for now (can become a per-user display preference later).

| Entity | Field | Notes |
| :--- | :--- | :--- |
| platform_settings | measurement_system (enum) | `metric` (default) / `imperial` |
| | date_format (enum) | `dd/mm/yyyy` (default) / `mm/dd/yyyy` / `yyyy-mm-dd` |

---

## 10. Entity-relationship diagram

```mermaid
erDiagram
    vendor ||--o{ vendor_contact : has
    product_category ||--o{ product_category : "parent of"
    product_attribute ||--o{ product_attribute_value : defines

    vendor ||--o{ product : "supplies (M3)"
    brand ||--o{ product : "branded (M3)"
    product_type ||--o{ product : "types (M3)"
    fulfilment_type ||--o{ product : "fulfils (M3)"
    product_category ||--o{ product : "classifies (M3)"
    product_attribute_value ||--o{ product_attribute : "assigned (M3)"

    vendor { uuid id; text name; text vat_number }
    vendor_contact { uuid id; text contact_name; text contact_type }
    brand { uuid id; text name }
    product_type { uuid id; text name }
    fulfilment_type { uuid id; text name; text code }
    product_category { uuid id; text name; uuid parent_id }
    product_attribute { uuid id; text name; text input_type }
    product_attribute_value { uuid id; text value }
```

---

## 11. Shared-component behaviour in this module

- **Smart reference input** — every reference field (vendor, parent category, attribute value, brand, product type, fulfilment type) pulls existing values centrally and offers create-on-confirm. Global Settings is where these values are primarily authored, but they can also be created inline from a product and appear here.
- **Bulk import** — each section accepts manual entry and `.xls`/`.csv`; the import review screen batches any new values behind confirmation.
- **Modal shell** — Create/Edit for every section uses the tabbed, resizable modal with the unsaved-changes guard.

---

## 12. Out of scope / assumptions to confirm

- Reference data is **platform-global** (§2) — confirm, or flag Vendors for per-company scoping.
- Vendor contacts modelled as **repeatable** (§3) — confirm vs. single.
- Format settings are **platform-wide** for now (§9); per-user display preference is a later option.
- Attribute **units** (e.g. a Weight attribute with kg/g) are not modelled separately yet; free-text covers it.
