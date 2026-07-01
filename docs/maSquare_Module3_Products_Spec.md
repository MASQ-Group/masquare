# maSquare Platform — Module 3: Products

**Status:** Updated draft · **Scope:** The Products module — the master product record, the All Products List/Grid views with search, filtering and column control, and the tabbed Add/Edit Product modal.

Builds on Module 1 (foundation, co-ownership, shared components), Module 2 (vendors, brands, product types, fulfilment types, categories, attributes, and format settings), and the Design System. This build creates and manages products with their attributes, cost, and suggested-price band. **Per-channel selling prices and listing economics remain out of scope** (later module).

**Conventions:** units follow the Global Settings measurement system (**metric — cm / kg** by default); dates render in the Global Settings date format (**dd/mm/yyyy** by default).

---

## 1. The product record

One product is held as a **single master record**, co-owned by every company that shares the Products module (Module 1 §3). Any co-owning company may edit it.

### 1.1 Core fields

| Field | Type | Notes |
| :--- | :--- | :--- |
| main_sku | text (mono), **required** | Primary identifier. Unique within the platform SKU namespace (§1.2). |
| title | text, **required** | Product title |
| brand_id | fk -> brand | Smart-dropdown from Global Settings; create-on-confirm |
| vendor_id | fk -> vendor | Smart-dropdown from Global Settings |
| product_type_id | fk -> product_type | Managed in Global Settings; smart-dropdown |
| fulfilment_type_id | fk -> fulfilment_type | Managed in Global Settings (not a hard-coded enum); single value per product for now |
| category_id | fk -> category (leaf) | A node in the Module 2 tree; the L1 > L2 > L3 path is derived from it |

### 1.2 SKUs & aliases

- **Main SKU** is the primary, required identifier.
- **Alias SKUs** are free-form alternative SKUs the same product can be referred to by (e.g. `RE-S8540` -> `RE-S8540-FBA`, `NK-S8540`). Each alias is a SKU value plus an **optional label**. Aliases carry **no cost or attributes of their own** — they resolve to the one product.
- **Namespace:** the union of every main SKU and every alias is **unique platform-wide** — no value maps to two products. Search and smart suggestions match across the whole namespace; any alias resolves to its product.
- Aliases are managed from within the product card.

| Entity | Field | Notes |
| :--- | :--- | :--- |
| product_sku_alias | product_id (fk) | |
| | sku_value (text, mono, unique in namespace) | |
| | label (text, optional) | e.g. FBA, NK |

**Vendor SKU** and **Manufacturer SKU** are separate external-reference fields; searchable, but **not** part of the internal alias namespace.

### 1.3 Identifiers & origin

| Field | Type | Notes |
| :--- | :--- | :--- |
| ean | text (mono) | |
| upc | text (mono) | |
| vendor_sku | text (mono) | Supplier's code |
| manufacturer_sku | text (mono) | Manufacturer's code |
| country_of_origin | text | ISO country, smart-dropdown |
| hs_code | text (mono) | Harmonised System tariff code |

### 1.4 Cost & pricing

| Field | Type | Notes |
| :--- | :--- | :--- |
| purchase_cost | money (amount + currency, default EUR) | Cost to acquire |
| map | money (default EUR) | **Minimum** suggested retail price *(per your definition)* |
| msrp | money (default EUR) | **Maximum** suggested retail price *(per your definition)* |

Together MAP and MSRP define a **suggested retail price band** (floor and ceiling) for the product.

> **Naming flag — MSRP.** In standard retail/marketplace usage, **MSRP = "Manufacturer's Suggested Retail Price"** (a single recommended price), and **MAP = "Minimum Advertised Price"**; neither conventionally means a *maximum*. Your platform defines MSRP as the maximum of a suggested band, which is fine internally — but Amazon/eBay integrations and other staff will likely read "MSRP" with the standard meaning. Worth deciding whether to keep the `MSRP` label or rename the ceiling field (e.g. `max_suggested_price`) to avoid confusion downstream. Modelled per your definition for now.

**Deferred** (acknowledged from the master field list, not shipped now): **Landed Cost** (purchase + shipping + import charges), introduced with the costing module.

### 1.5 Package & logistics

Units follow the Global Settings measurement system — **metric by default: dimensions in cm, weights in kg**.

| Field | Type | Notes |
| :--- | :--- | :--- |
| product_weight | number (kg) | |
| package_weight | number (kg) | |
| package_length / width / height | number (cm) | |
| volumetric_weight | number (kg), **calculated, read-only** | = (L x W x H) / 5000 |

*(The /5000 divisor with centimetres yields kilograms — the carrier-standard result unit. If the measurement system is switched to imperial, units and the divisor convert accordingly.)*

### 1.6 Media

- Up to **8 images** per product; formats **jpg / png / webp**.
- The **first image is the featured image** (grid cards, search results).
- Reorderable (drag); stored in object storage.

| Entity | Field | Notes |
| :--- | :--- | :--- |
| product_media | product_id (fk) | |
| | url (text) | Object-storage reference |
| | sort_order (int) | Position 0 = featured |

### 1.7 Attributes

Attributes are assigned from the Module 2 attribute library, **manually by the user** — nothing is auto-assigned, and there is no category-driven gating. The user adds the attributes relevant to each product when they choose to.

- **Predefined** attributes — choose only from the attribute's defined values.
- **Free-text** attributes — type a value; it is stored and offered as a suggestion on future products (create-on-confirm).

| Entity | Field | Notes |
| :--- | :--- | :--- |
| product_attribute | product_id (fk) | Assignment |
| | attribute_id (fk -> attribute) | |
| | value (text, mono where a code/figure) | |

---

## 2. All Products — view shell

Default screen; fills the full page width.

**Top toolbar:**

- **Search bar** — placeholder "Search SKU, title, attributes...", with smart suggestions. **Field-aware mode**: the user can choose a specific field to search within (e.g. just Main SKU, or just HS Code), each offering per-field suggestions.
- **Filters** — Vendor(s), Brand(s)/Manufacturer(s), Attributes.
- **Columns selector** — choose visible optional columns (List view).
- **List / Grid toggle.**
- **Clear all filters.**
- Applied filters render as removable **chips** beneath the toolbar.

---

## 3. List view

TanStack Table (virtualised), mono for every identifier and figure, money right-aligned, dates in dd/mm/yyyy.

**Standard columns:** featured thumbnail · Main SKU (with alias count) · Title · Brand · Vendor · Fulfilment Type · Category · Attributes · Purchase Cost.

**Optional columns** (Columns selector): Product Type · Vendor SKU · Manufacturer SKU · EAN · UPC · Country of Origin · HS Code · MAP · MSRP · Product Weight · Package Weight · Dimensions · Volumetric Weight.

**Excel-like per-column filtering** on: Brand, Vendor, Fulfilment Type, Product Type, Category, Country of Origin.

---

## 4. Grid view

Cards showing: **featured image · Main SKU · Title · Brand/Manufacturer.** Click opens the product card (edit modal).

---

## 5. Add / Edit Product modal

Shared modal shell (centered, expand, drag-resize, dirty-guard). Tabs:

1. **General** — media (up to 8), Title, Main SKU, alias SKUs, Fulfilment Type, Brand, Vendor, Product Type.
2. **Classification** — Category (tree picker), Attributes (user-assigned: predefined pickers + free-text with suggestions, shown as chips).
3. **Identifiers** — EAN, UPC, Vendor SKU, Manufacturer SKU, Country of Origin, HS Code.
4. **Cost & pricing** — Purchase Cost, MAP (min suggested), MSRP (max suggested). *(Landed Cost appears here with the costing module.)*
5. **Package & logistics** — Product Weight, Package Weight, L/W/H, Volumetric Weight (auto-calculated, read-only).

Footer CTA reads **Create product** / **Save changes**; Cancel triggers the unsaved-changes guard. Every reference field uses the smart-dropdown with create-on-confirm; the form supports `.xls`/`.csv` bulk import.

---

## 6. Entity-relationship diagram

```mermaid
erDiagram
    product ||--o{ product_sku_alias : "has"
    product ||--o{ product_media : "has"
    product ||--o{ product_attribute : "assigned"
    product }o--|| brand : "branded"
    product }o--|| vendor : "supplied by"
    product }o--|| product_type : "typed"
    product }o--|| fulfilment_type : "fulfilled"
    product }o--|| product_category : "classified"
    product }o--o{ company : "co-owned (M1)"

    product {
        uuid id
        text main_sku
        text title
        money purchase_cost
        money map
        money msrp
        numeric volumetric_weight
    }
    product_sku_alias { uuid id; text sku_value; text label }
    product_media { uuid id; text url; int sort_order }
    product_attribute { uuid id; uuid attribute_id; text value }
```

---

## 7. Resolved decisions & remaining flag

Resolved: Fulfilment Type is a **Global-Settings-managed list** (not an enum); Product Type is **managed in Global Settings**; units are **metric (cm/kg)** and dates **dd/mm/yyyy**, both configurable in Global Settings; **MAP and MSRP are included** in this build; attributes are **assigned manually** by the user with no auto-assignment or category gating.

Remaining flag: the **MSRP naming** question in §1.4 — keep the `MSRP` label for the maximum-of-band field, or rename to avoid clashing with its standard industry meaning.

---

## 8. Milestone

With this approved, **Modules 1–3 are fully specified** — foundation, global settings, and products — the coherent first slice to build: companies and users, the product reference data, and the catalogue itself, on the shared component layer and the design system.
