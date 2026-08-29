# MASQUARE — Product Types & Category Tree

**Handover for Claude Core.** Built from `catalogue-for-copywriting.csv` (1,174 SKUs). Every SKU is assigned a product type and exactly one primary category leaf. Nothing is left uncategorised.

## Files in this handover

| File | Purpose |
| :--- | :--- |
| `masquare-taxonomy.json` | The taxonomy to create: 239 product types + 309 categories over 3 levels. Create this **first**. |
| `masquare-product-assignments.json` | One object per SKU: `sku` → `product_type_id` + `category_id`. Apply **after** the taxonomy exists. |
| `masquare-product-assignments.csv` | Same rows, flat, for eyeballing in a spreadsheet. Not the import source. |
| `masquare-taxonomy-brief.md` | This document. |

## Import contract

1. **Create categories** from `categories[]`, in array order — parents always appear before their children.
   - `id` is the stable key (kebab-case; level 2 and 3 are parent-prefixed paths, so `id` doubles as the URL path).
   - `parent_id` is `null` at level 1. `position` is the sort order within the parent.
   - `show_in_navigation: false` marks the **Services & Fees** branch — create it, keep it out of the customer-facing menu.
2. **Create product types** from `product_types[]`. `primary_category_id` is the leaf that type normally lives in; `spec_template_group` groups the 239 types into 10 families so one specification template can serve many types.
3. **Assign products** from `assignments[]`. `sku` is the correlation key and is returned exactly as supplied — match on it, never on `title`.
4. Validate before writing: every `category_id` and `product_type_id` in the assignments must exist; all 1,174 SKUs must resolve; no SKU may appear twice.

## Design principles

- **Maximum 3 levels**, as asked. Level 1 = main menu (12 entries), level 2 = menu column heading, level 3 = the clickable leaf. Products only ever sit on level 3.
- **Products live on exactly one leaf.** Cross-listing is done with brand and product-type filters, not with duplicate categories — it keeps counts honest and avoids the same SKU appearing twice in a menu.
- **Trade buyers navigate by what a thing is, not who made it.** Brand belongs in a facet, so `brand` was deliberately not used as a level of the tree.
- **Spares and consumables are separated from the machines they fit.** A buyer ordering a Fissler gasket and a buyer ordering a Fissler pressure cooker are on different errands; mixing them makes both lists unusable. Same reasoning for coffee descalers, air-purifier filters and shaver blades.
- **No empty leaves.** Every one of the 234 level-3 categories has at least one SKU, so nothing dead-ends on the storefront.
- **Consumer-facing and non-merchandise are kept apart.** Shipping, installation, service and internal placeholder SKUs sit in a hidden branch.

## Navigation shape

| # | Level 1 category | Level 2 | Level 3 | Products |
| ---: | :--- | ---: | ---: | ---: |
| 1 | Home Appliances | 5 | 23 | 130 |
| 2 | Kitchen & Dining | 8 | 41 | 252 |
| 3 | Personal Care & Health | 6 | 29 | 191 |
| 4 | TV, Audio & Photography | 6 | 22 | 109 |
| 5 | Computing, Office & Stationery | 8 | 28 | 84 |
| 6 | Smart Home, Networking & Electrical | 4 | 12 | 25 |
| 7 | Cleaning, Hygiene & Janitorial | 5 | 26 | 121 |
| 8 | Catering & Food Packaging | 5 | 16 | 114 |
| 9 | Outdoor, BBQ & Leisure | 5 | 12 | 38 |
| 10 | Fashion & Accessories | 6 | 18 | 91 |
| 11 | Pet Supplies | 2 | 4 | 12 |
| 12 | Services & Fees *(hidden)* | 3 | 3 | 7 |
| | **Total** | **63** | **234** | **1,174** |

## The tree

### 1. Home Appliances (130)

- **Large Kitchen Appliances** (19)
  - Ovens (3)
  - Hobs & Cooktops (3)
  - Cooker Hoods (2)
  - Dishwashers (5)
  - Refrigerators & Freezers (5)
  - Wine Cabinets (1)
- **Laundry & Garment Care** (49)
  - Washing Machines & Washer Dryers (6)
  - Steam Irons (15)
  - Steam Generator Irons (11)
  - Garment Steamers (5)
  - Ironing Boards (2)
  - Clothes Airers & Drying Racks (10)
- **Vacuums & Floor Care** (10)
  - Vacuum Cleaners (3)
  - Window Cleaning Robots (4)
  - Vacuum Bags, Filters & Accessories (3)
- **Climate & Air Treatment** (44)
  - Air Conditioners (6)
  - Dehumidifiers (12)
  - Air Purifiers (4)
  - Fans & Air Coolers (4)
  - Heaters (5)
  - Air Treatment Filters & Accessories (13)
- **Water Dispensers & Filtration** (8)
  - Water Dispensers & Coolers (3)
  - Water Filters & Cartridges (5)

### 2. Kitchen & Dining (252)

- **Coffee, Tea & Beverage Machines** (48)
  - Espresso & Bean-to-Cup Machines (16)
  - Filter & Capsule Coffee Makers (5)
  - Coffee Grinders (4)
  - Kettles (17)
  - Frappe & Milkshake Mixers (6)
- **Food Preparation Appliances** (33)
  - Blenders (20)
  - Food Processors & Choppers (4)
  - Stand & Hand Mixers (2)
  - Juicers & Citrus Presses (4)
  - Meat Grinders (1)
  - Vacuum Sealers & Food Storage (2)
- **Countertop Cooking Appliances** (18)
  - Air Fryers (2)
  - Microwave Ovens (3)
  - Toasters (3)
  - Food Steamers (2)
  - Rice & Slow Cookers (4)
  - Portable Hobs & Cooking Plates (2)
  - Speciality Cooking Appliances (2)
- **Cookware & Bakeware** (46)
  - Frying Pans & Grill Pans (14)
  - Woks (3)
  - Pots & Casseroles (6)
  - Pressure Cookers (11)
  - Cookware Sets (4)
  - Lids & Cookware Accessories (8)
- **Kitchen Tools & Gadgets** (31)
  - Kitchen Knives (5)
  - Knife Sharpeners, Blocks & Care (2)
  - Peelers, Graters & Choppers (10)
  - Mills, Grinders & Openers (7)
  - Cooking Utensils (3)
  - Kitchen Scales & Thermometers (4)
- **Tableware, Glassware & Wine Accessories** (12)
  - Corkscrews & Bottle Openers (7)
  - Wine Pourers, Stoppers & Thermometers (4)
  - Glassware & Drinkware (1)
- **Appliance Care, Filters & Spare Parts** (53)
  - Descalers & Cleaning Tablets (13)
  - Coffee Machine Accessories & Filters (8)
  - Pressure Cooker Spare Parts (21)
  - Cookware Handles, Valves & Gaskets (9)
  - Stainless Steel Care Products (2)
- **Food & Beverages** (11)
  - Coffee (9)
  - Coffee Capsules (1)
  - Milk & Grocery (1)

### 3. Personal Care & Health (191)

- **Hair Styling** (67)
  - Hair Dryers (19)
  - Hair Straighteners (23)
  - Curling Tongs & Wavers (6)
  - Hot Air Brushes & Airstylers (11)
  - Multi-Stylers & Styling Sets (5)
  - Hair Brushes & Styling Accessories (3)
- **Shaving & Grooming** (60)
  - Electric Shavers (7)
  - Beard & Stubble Trimmers (9)
  - Hair Clippers (13)
  - Nose, Ear & Detail Trimmers (4)
  - Body Groomers (5)
  - Multi-Grooming Kits (16)
  - Shaver Blades, Heads & Accessories (6)
- **Hair Removal & Beauty Devices** (23)
  - Epilators & Lady Shavers (7)
  - Facial Cleansing & Skin Devices (6)
  - Cosmetic Mirrors (3)
  - Manicure & Pedicure Devices (6)
  - Nail Dryers & Accessories (1)
- **Health & Wellbeing Devices** (23)
  - Blood Pressure Monitors (4)
  - Thermometers & Pulse Oximeters (2)
  - Body Analysis & Bathroom Scales (2)
  - Massagers & Massage Guns (13)
  - Therapy & Treatment Devices (2)
- **Cosmetics & Toiletries** (11)
  - Sun Care & Tanning (8)
  - Skincare (1)
  - Bath, Body & Fragrance (2)
- **Baby & Nursery** (7)
  - Baby Wipes (4)
  - Bottle Warmers & Feeding (2)
  - Baby Monitors (1)

### 4. TV, Audio & Photography (109)

- **Televisions & Receivers** (16)
  - Televisions (12)
  - Set-Top Boxes & Decoders (1)
  - Remote Controls (3)
- **TV Mounts, Brackets & Stands** (6)
  - TV Wall Mounts (4)
  - TV Carts & Stands (1)
  - Mounting Accessories (1)
- **Audio & Hi-Fi** (63)
  - Headphones & Earphones (50)
  - Bluetooth & Portable Speakers (6)
  - Soundbars & Home Theatre (2)
  - Turntables & Hi-Fi (1)
  - Radios & Clock Radios (1)
  - Speaker Mounts & Audio Accessories (3)
- **Car Audio & In-Car Electronics** (12)
  - Car Stereos & Multimedia Receivers (4)
  - Car Speakers & Subwoofers (4)
  - Car Amplifiers (2)
  - Car Phone Holders & Accessories (2)
- **Cameras & Photography** (8)
  - Cameras (1)
  - Instant Film & Memory Cards (1)
  - Camera Accessories & Cleaning (6)
- **Musical Instruments & Accessories** (4)
  - Musical Instruments (2)
  - Instrument Accessories & Strings (1)
  - In-Ear Monitors & Stage Audio (1)

### 5. Computing, Office & Stationery (84)

- **Computers & Tablets** (10)
  - Laptops & Notebooks (6)
  - Tablets (2)
  - Docking Stations & Laptop Stands (2)
- **Monitors & Displays** (5)
  - Monitors (4)
  - Monitor Mounts & Stands (1)
- **Computer Peripherals & Accessories** (17)
  - Keyboards & Mice (6)
  - Webcams & Conferencing (3)
  - Laptop Bags & Cases (3)
  - Storage & Memory Cards (1)
  - Power Adapters & Chargers (2)
  - Cables & Adapters (2)
- **Printing & Imaging** (21)
  - Printers & Multifunction Devices (5)
  - Ink Cartridges (9)
  - Toner Cartridges (6)
  - Printer Maintenance & Consumables (1)
- **Mobile Phones & Accessories** (7)
  - Smartphones (3)
  - Phone Cases & Covers (2)
  - Power Banks & Chargers (2)
- **Office Paper & Stationery** (9)
  - Copy & Printing Paper (4)
  - Thermal, Plotter & Label Rolls (2)
  - Folders & Filing (2)
  - Labelling & Stickers (1)
- **Gaming** (6)
  - Video Games (4)
  - Gaming Accessories (1)
  - Gaming Chairs (1)
- **Art & Craft Supplies** (9)
  - Watercolours (3)
  - Acrylic & Oil Paints (4)
  - Pastels & Drawing (2)

### 6. Smart Home, Networking & Electrical (25)

- **Networking** (3)
  - Routers & Access Points (1)
  - Network Switches (2)
- **IoT Sensors & Gateways** (7)
  - LoRaWAN Gateways (2)
  - LoRaWAN Sensors (3)
  - LoRaWAN Controllers (2)
- **Electrical Accessories** (11)
  - Plugs, Adapters & Converters (5)
  - Power Strips & Extension Leads (1)
  - Batteries & Chargers (2)
  - HDMI & AV Cables (3)
- **Home Safety & Wellbeing** (4)
  - Personal Alarms & Call Buttons (1)
  - Emergency & First Aid Kits (1)
  - Sleep & Wake-Up Devices (2)

### 7. Cleaning, Hygiene & Janitorial (121)

- **Cleaning Chemicals** (32)
  - Multi-Surface Cleaners & Disinfectants (10)
  - Bathroom & Toilet Cleaners (6)
  - Kitchen & Oven Cleaners (2)
  - Bleach & Chlorine (5)
  - Dishwashing & Rinse Aids (4)
  - Laundry Detergents & Softeners (1)
  - Glass & Window Cleaners (4)
- **Hand & Body Hygiene** (14)
  - Liquid Soaps (5)
  - Sanitisers & Alcohol (5)
  - Soap & Paper Dispensers (4)
- **Paper & Wiping Products** (26)
  - Toilet Paper (7)
  - Hand Towels & Interfold (5)
  - Kitchen & Wiping Rolls (7)
  - Napkins (5)
  - Facial Tissues & Medical Rolls (2)
- **Cleaning Tools & Equipment** (31)
  - Mops, Buckets & Wringers (6)
  - Brooms, Brushes & Dustpans (4)
  - Window Wipers & Squeegees (4)
  - Dusters & Microfibre Cloths (3)
  - Sponges & Scourers (2)
  - Replacement Heads, Handles & Refills (12)
- **Waste, Bags & Air Care** (18)
  - Bin Bags & Refuse Sacks (9)
  - Waste Bins (1)
  - Air Fresheners & Home Fragrance (4)
  - Insecticides & Pest Control (3)
  - Disposable Gloves & Protection (1)

### 8. Catering & Food Packaging (114)

- **Cups & Lids** (47)
  - Paper Cups (14)
  - Plastic Cups (13)
  - Cup Lids (18)
  - Cup Carriers & Accessories (2)
- **Food Containers & Boxes** (19)
  - Paper Boxes & Trays (6)
  - Plastic Containers (6)
  - Bowls & Salad Containers (7)
- **Plates, Cutlery & Straws** (28)
  - Disposable Plates (6)
  - Disposable Cutlery (8)
  - Straws (9)
  - Stirrers & Toothpicks (5)
- **Bags & Wrapping** (17)
  - Paper Bags (11)
  - Cling Film & Baking Paper (4)
  - Bubble & Stretch Film (2)
- **Catering Sundries** (3)
  - Skewers & Cooking Accessories (2)
  - Hygiene Caps & Disposables (1)

### 9. Outdoor, BBQ & Leisure (38)

- **BBQ & Grilling** (15)
  - Charcoal BBQ & Rotisserie Sets (7)
  - Gas Barbecues (2)
  - BBQ Motors & Spare Parts (3)
  - BBQ Tools, Covers & Accessories (3)
- **Camping & Gas Equipment** (4)
  - Camping Stoves (1)
  - Gas Regulators, Hoses & Fittings (3)
- **Cycling** (15)
  - Mudguards (14)
  - Bicycle Components & Accessories (1)
- **Travel & Outdoor Gear** (2)
  - Backpacks & Daypacks (1)
  - Travel Accessories & Organisers (1)
- **Automotive & Industrial Parts** (2)
  - Vehicle Parts (1)
  - Hydraulic & Industrial Equipment (1)

### 10. Fashion & Accessories (91)

- **Sunglasses** (48)
  - Aviator & Pilot Sunglasses (8)
  - Rectangle & Square Sunglasses (11)
  - Round & Oval Sunglasses (7)
  - Shield & Wrap Sunglasses (12)
  - Oversized & Geometric Sunglasses (10)
- **Watches** (3)
  - Wristwatches (3)
- **Bags & Luggage** (8)
  - Backpacks (3)
  - Briefcases & Business Bags (3)
  - Travel & Weekend Bags (2)
- **Wallets & Small Leather Goods** (5)
  - Wallets (4)
  - Card Holders (1)
- **Knives & Multi-Tools** (20)
  - Swiss Army & Pocket Knives (7)
  - Outdoor & Hunting Knives (1)
  - Sheaths, Pouches & Chains (11)
  - Knife Care & Accessories (1)
- **Smoking Accessories** (7)
  - Lighters (2)
  - Cigar Cutters & Humidors (3)
  - Cases & Holsters (2)

### 11. Pet Supplies (12)

- **Cages & Housing** (11)
  - Bird Cages (6)
  - Small Animal Cages (4)
  - Carrier Parts & Accessories (1)
- **Pet Care** (1)
  - Cat Litter (1)

### 12. Services & Fees (7)  — hidden from navigation

- **Logistics & Delivery** (3)
  - Shipping & Delivery Charges (3)
- **Service & Repair** (1)
  - Equipment Service & Repair (1)
- **Internal & Uncategorised** (3)
  - Miscellaneous Internal Items (3)

## Product types

239 types, one per SKU. Most map 1:1 to a category leaf; a handful span two leaves where the same kind of item legitimately appears in more than one place (`category_ids` lists all of them, `primary_category_id` is the default).

### Specification template groups

`spec_template_group` exists so the specification table in the content guide can be driven by ~10 templates rather than 239. Suggested attribute sets:

| Group | Products | Specification attributes that matter |
| :--- | ---: | :--- |
| `non-powered-hardware` | 204 | Material, dimensions, capacity, finish, compatibility, weight |
| `powered-appliance` | 191 | Power (W), voltage, capacity/volume, dimensions, weight, energy class, controls, warranty |
| `personal-care-device` | 170 | Power source, cordless/corded, runtime, attachments, wet & dry, settings, warranty |
| `disposable-packaging` | 140 | Size / capacity, material, ply, units per pack, cases per pallet, food-contact compliance |
| `spare-part-consumable` | 116 | Fits models, part number, material, dimensions, pack quantity |
| `av-electronics` | 103 | Screen size / driver size, resolution, connectivity, power output, battery life, ports |
| `fashion-accessory` | 93 | Material, frame/lens (eyewear), dimensions, colour, closure, capacity |
| `consumable-chemical` | 81 | Volume / weight, concentration, fragrance, dilution rate, hazard and storage data |
| `it-electronics` | 69 | CPU / chipset, RAM, storage, display, ports, wireless standard, OS, warranty |
| `service` | 7 | Not a physical product — no specification table |

### Types by category (top 40 by volume)

| Product type | Products | Primary category |
| :--- | ---: | :--- |
| Headphones & Earphones | 50 | tv-audio-and-photography/audio-and-hi-fi/headphones-and-earphones |
| Sunglasses | 48 | fashion-and-accessories/sunglasses/shield-and-wrap-sunglasses |
| Hair Straightener | 23 | personal-care-and-health/hair-styling/hair-straighteners |
| Pressure Cooker Spare Part | 21 | kitchen-and-dining/appliance-care-filters-and-spare-parts/pressure-cooker-spare-parts |
| Blender | 20 | kitchen-and-dining/food-preparation-appliances/blenders |
| Hair Dryer | 19 | personal-care-and-health/hair-styling/hair-dryers |
| Cup Lid | 18 | catering-and-food-packaging/cups-and-lids/cup-lids |
| Kettle | 17 | kitchen-and-dining/coffee-tea-and-beverage-machines/kettles |
| Espresso Machine | 16 | kitchen-and-dining/coffee-tea-and-beverage-machines/espresso-and-bean-to-cup-machines |
| Steam Iron | 15 | home-appliances/laundry-and-garment-care/steam-irons |
| Frying Pan | 14 | kitchen-and-dining/cookware-and-bakeware/frying-pans-and-grill-pans |
| Mudguard | 14 | outdoor-bbq-and-leisure/cycling/mudguards |
| Paper Cup | 14 | catering-and-food-packaging/cups-and-lids/paper-cups |
| Descaler & Machine Cleaner | 13 | kitchen-and-dining/appliance-care-filters-and-spare-parts/descalers-and-cleaning-tablets |
| Hair Clipper | 13 | personal-care-and-health/shaving-and-grooming/hair-clippers |
| Massager | 13 | personal-care-and-health/health-and-wellbeing-devices/massagers-and-massage-guns |
| Multi-Grooming Kit | 13 | personal-care-and-health/shaving-and-grooming/multi-grooming-kits |
| Plastic Cup | 13 | catering-and-food-packaging/cups-and-lids/plastic-cups |
| Cleaning Refill & Spare | 12 | cleaning-hygiene-and-janitorial/cleaning-tools-and-equipment/replacement-heads-handles-and-refills |
| Dehumidifier | 12 | home-appliances/climate-and-air-treatment/dehumidifiers |
| Television | 12 | tv-audio-and-photography/televisions-and-receivers/televisions |
| Air Treatment Filter | 11 | home-appliances/climate-and-air-treatment/air-treatment-filters-and-accessories |
| Hot Air Brush & Airstyler | 11 | personal-care-and-health/hair-styling/hot-air-brushes-and-airstylers |
| Paper Bag | 11 | catering-and-food-packaging/bags-and-wrapping/paper-bags |
| Pressure Cooker | 11 | kitchen-and-dining/cookware-and-bakeware/pressure-cookers |
| Sheath & Pouch | 11 | fashion-and-accessories/knives-and-multi-tools/sheaths-pouches-and-chains |
| Steam Generator Iron | 11 | home-appliances/laundry-and-garment-care/steam-generator-irons |
| Clothes Airer | 10 | home-appliances/laundry-and-garment-care/clothes-airers-and-drying-racks |
| Multi-Surface Cleaner & Disinfectant | 10 | cleaning-hygiene-and-janitorial/cleaning-chemicals/multi-surface-cleaners-and-disinfectants |
| Peeler & Chopper | 10 | kitchen-and-dining/kitchen-tools-and-gadgets/peelers-graters-and-choppers |
| Beard Trimmer | 9 | personal-care-and-health/shaving-and-grooming/beard-and-stubble-trimmers |
| Coffee | 9 | kitchen-and-dining/food-and-beverages/coffee |
| Cookware Handle | 9 | kitchen-and-dining/appliance-care-filters-and-spare-parts/cookware-handles-valves-and-gaskets |
| Ink Cartridge | 9 | computing-office-and-stationery/printing-and-imaging/ink-cartridges |
| Straw | 9 | catering-and-food-packaging/plates-cutlery-and-straws/straws |
| Bin Bag | 8 | cleaning-hygiene-and-janitorial/waste-bags-and-air-care/bin-bags-and-refuse-sacks |
| Disposable Cutlery | 8 | catering-and-food-packaging/plates-cutlery-and-straws/disposable-cutlery |
| Sun Care | 8 | personal-care-and-health/cosmetics-and-toiletries/sun-care-and-tanning |
| Bowl & Salad Container | 7 | catering-and-food-packaging/food-containers-and-boxes/bowls-and-salad-containers |
| Charcoal BBQ & Rotisserie Set | 7 | outdoor-bbq-and-leisure/bbq-and-grilling/charcoal-bbq-and-rotisserie-sets |

The full list of 239 is in `masquare-taxonomy.json`.

## Judgement calls worth a second opinion

These are the places where the catalogue is genuinely ambiguous. Each is decided and applied consistently — flagging them so you can overrule rather than discover them later.

- **Sunglasses are split by frame shape** (Aviator & Pilot, Rectangle & Square, Round & Oval, Shield & Wrap, Oversized & Geometric), taken from the wording already in the titles. It is how eyewear buyers actually browse. If the 46 SKUs are better sold by brand, collapse the five leaves into one and put shape in a filter.
- **Built-in vs. countertop.** Built-in ovens, hobs, hoods, dishwashers, fridges and washing machines sit under Home Appliances → Large Kitchen Appliances; anything that sits on a worktop sits under Kitchen & Dining. The Neff built-in microwave is filed as a built-in oven, not as a microwave.
- **Irons.** Three leaves: Steam Irons (single unit), Steam Generator Irons (separate boiler, quoted in bar) and Garment Steamers (handheld/vertical). Braun's `IS` range is generator, the `GS` range is steamer.
- **Automotive & Industrial Parts** (2 SKUs: fuel injectors, a hydraulic PTO pump) sits under Outdoor, BBQ & Leisure because there is nowhere better. If more stock like this arrives it deserves its own level 1.
- **Cleaning tools vs. cleaning chemicals.** Leifheit mops, squeegees and brooms are tools; Bien and Zoflora liquids are chemicals. Window cleaning *robots* are appliances, window cleaning *fluid* is a chemical.
- **Hidden branch.** 7 SKUs are shipping charges, installation, repair labour and internal placeholders (`Sony`, `Various Equipment`, `Various Stickers`). They must exist so orders balance, but they should never render in navigation or search.
- **Eight duplicate titles** exist in the source (same product listed twice under different SKUs — e.g. the Philips Avent bottle warmer, two Leifheit mop heads, several Ass Savers mudguards). Both copies are assigned identically. Worth de-duplicating in the catalogue, not in the taxonomy.

## Frontend notes

- Level 1 has 12 entries — a comfortable mega-menu width. The largest are Kitchen & Dining, Personal Care & Health and Home Appliances; put those first in the menu, which is the order the JSON already uses.
- Recommended facets on every listing page: **brand**, **product type**, price, availability. Brand matters most — 890 of 1,174 SKUs carry one.
- Leaves under 5 products (there are a number) will look thin on their own page. They are correct taxonomically; consider showing the parent level-2 page as the landing page and using the leaves as filters within it until stock deepens.
- `meta_title` and `meta_description` in the JSON are plain, factual placeholders derived from the category names. They state nothing that isn't true; rewrite them for SEO when the categories are live.
