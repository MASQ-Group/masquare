# Source-data discrepancies found during content generation

One bullet per issue, grouped by batch. Format: SKU | field | source value | manufacturer value | action taken.


## Batch t1-b001 (tier 1)

# Discrepancy notes — t1-b001

- 3W-AR1F402 | source_title | "Ardes AR1F402 ARON Portable Induction Hob 2000W Digital" | Ardes AR1F402 "Ceramico Duo" double glass-ceramic cooker, 2400 W max, thermostat-controlled | Three separate errors in one title. Ardes lists AR1F402 (same EAN 8004032112085) as the Ceramico Duo, an infrared glass-ceramic twin-plate cooker — not induction, not the ARON range, and not digitally controlled (it has adjustable thermostats and pilot lamps). Rated maximum is 2400 W, not 2000 W. Corrected the product type, variant name, control type and power throughout; noted in the long description that it takes any flat-bottomed metal pan, since the induction claim would mislead a buyer into thinking ferrous cookware is required.
- AMZ-DE-B0FS145ZBT | source_title | "InstaCord Retractable 2ft Cable" | 70 cm (2.3 ft) retractable USB-C cable | Anker and the Amazon.de listing for this product both state 70 cm. Published 70 cm.
- AMZ-DE-B0FS145ZBT | manufacturer_sku | null | A1638 | No manufacturer code in the source. Matched to Anker A1638 (Nano Power Bank 10K, 45W, built-in retractable USB-C cable) on Anker's own EU and US product pages, which match the source description exactly. Published A1638 as the manufacturer code.
- IT71909 | source_title | "Orange" | Cosmic Orange | Apple's official finish name for the iPhone 17 Pro Max is Cosmic Orange. Corrected in the title, bullets and specification table.
- IT71909 | manufacturer_sku | null | (none published) | The SKU carries no vendor prefix pattern and is not one of the four catalogue SKUs that are manufacturer codes, so no model code was published in text. Apple part numbers vary by market and could not be tied to this listing.
- 47-AS126E | source_title | "BaByliss AS126E Hair Brush 1000W, Black" | BaByliss AS126E Perfect Finish | Manufacturer's variant name for AS126E is Perfect Finish; added silently to the title and as the Range row.
- 47-AS126E | attachment count | Amazon lists "3 attachments"; two other retailers list four items | (unresolved) | Sources disagree on how many attachments ship with AS126E. Published only the two brush heads both sources agree on (38 mm thermal, 20 mm soft-bristle) and omitted a "What's in the box" section rather than state a contents list that may be wrong.
- 47-AS136E | source_title | "Corded Electric Air Styler 1000W ... Copper, Grey" | BaByliss AS136E Air Style 1000, grey | Manufacturer's variant name is Air Style 1000. The source lists two colours; retailer listings for AS136E give grey only (copper is the colourway of the AS952E in this same batch), so grey was published and copper dropped.
- 47-AS136E | ionic function | retailer sources conflict | (unresolved) | One retailer lists AS136E as ionic, another explicitly as not ionic. No ionic claim published.
- 47-6709DE | heat/speed settings | retailer sources conflict (3 heat + 2 speed vs 2 + 2) | (unresolved) | Settings count not published. Wattage (2100 W), AC motor and ionic function are consistent across sources and were published.
- 47-6709DE | colour | retailer sources conflict (black vs black and rose gold) | (unresolved) | No colour published; the source title gives none.
- 47-6709DE | attachments | one retailer lists a concentrator and diffuser | (unconfirmed) | Single-source only, so no attachment list or "What's in the box" section was published.
- 47-C325E | source_title | "Pro180 Curling Iron" | BaByliss C325E Pro 180 Sublim' Touch | Manufacturer's full variant name is Pro 180 Sublim' Touch, and the model name is spaced "Pro 180". Corrected in the title and Range row.
- 47-AS95E | source_title | no colour given | Gold | Two independent sources (Amazon UK listing title and Coolblue specification table) give the AS95E as gold. Published as Colour: Gold. No wattage figure could be confirmed, so none was published.
- 47-AS952E | source_title | no wattage or colour given | 650 W, copper | 650 W confirmed by two independent retailer specification pages; copper finish from the Coolblue specification table. Published both.
- HADJ-AGA-MMB, HADJ-AGA-MMW | source_title | "Anthony Gallo Nucleus Micro Wall Mount" | Micro / A'Diva Wall Mount (single) | Gallo Acoustics sells this as one bracket fitting Nucleus Micro, Micro SE, A'Diva and A'Diva SE, supplied singly. Broadened the compatibility statement accordingly and recorded that it is a single mount. No dimensions, material or load rating are published by the manufacturer, so none were stated.
- ASB-MD821ZM/A | manufacturer_sku | ASB-MD821ZM/A (includes the vendor prefix) | MD821ZM/A | The supplied manufacturer_sku still carries the ASB- vendor prefix. Published the manufacturer part MD821ZM/A only. Supplied EAN 885909627509 published unchanged.
- MT-27G4HRE | source_title | "1 ms" | 1 ms GtG (0.5 ms MPRT) | AOC quotes both figures; qualified the response time so the 1 ms claim is not read as MPRT. All other source-title claims (200 Hz, G-Sync, HDR10, 1920 x 1080, 2 x HDMI 2.0, DisplayPort 1.4) were confirmed against AOC's own leaflet.


## Batch t1-b002 (tier 1)

# Discrepancy notes — t1-b002

- 47-ST255E | source_title | "Babyliss 47-ST255E Hair Straightener" | "BaByliss ST255E Sleek Finish 230 Hair Straightener" | Source title carries the internal vendor-prefixed SKU in the customer-facing text. Published the manufacturer code ST255E only, and added the manufacturer's official range name "Sleek Finish 230".
- 47-E650E, 47-ST255E, 47-6715DE, 47-AS122E, 47-AS774E, 47-AS950E, 47-AS970E, 47-E652E, 47-E786E, 47-E974E, 47-MT728E, 47-SC758E, 47-T861E, 47-ST492E | brand | "Babyliss" | "BaByliss" | Manufacturer casing is BaByliss. Corrected silently in all output text and in the Brand row. (47-E650E and 47-ST492E already had the correct casing in the source.)
- 47-ST492E | source_title | leading zero-width space before "BaByliss" | "BaByliss ST492E Steam Straight Hair Straightener" | Invisible U+200B character at the start of the source title; stripped. Also added the manufacturer's official model name "Steam Straight".
- BA-ST495E | manufacturer_sku | null | ST495E | No manufacturer code supplied. Derived ST495E from the SKU (vendor prefix "BA-") and confirmed ST495E is a real BaByliss straightener model; published ST495E as the manufacturer code.
- BA-ST495E | source_title | "BaByliss Smooth Finish Straightener" | steam hair straightener | "Smooth Finish" is the name of a different BaByliss line (the AS122E hot air brush in this same batch). Every listing found for ST495E describes a steam straightener with ceramic plates. Wrote the title as "Steam Hair Straightener" and dropped "Smooth Finish".
- BA-ST495E | ean | null | (not found) | No EAN supplied and none could be tied to ST495E with confidence. EAN row omitted from the specification table.
- BA-ST495E | model/variant name | n/a | (unresolved) | Retailers give conflicting marketing names for ST495E ("Steam Pure", "Ultra Sonic Steam", "Pure Metal Steam"). No official name published, and long_description left empty because only two facts (steam function, ceramic plates) could be confirmed by more than one source.
- 47-6715DE | source_title | "Hair Dryer PRO 2400W" | Compact Pro 2400 | The manufacturer's model name is "Compact Pro 2400", not "PRO". Corrected in the title and recorded as Model name. The 2400 W figure in the source is correct and confirmed.
- 47-AS774E | source_title | "Hydro Fusion 4 in 1 Hair Styler Brush" | Hydro-Fusion 4-in-1 Hair Dryer Brush | Used the manufacturer's official product name and hyphenation.
- 47-AS774E | specifications | n/a | wattage not published | One retailer datasheet gives 1000 W but no second independent source or manufacturer page confirmed it, so no wattage was published for this model.
- 47-AS950E | source_title | "Rotating Heating Hair Brush" | Big Hair Dual rotating hot air brush | Added the manufacturer's model name "Big Hair Dual". Wattage was NOT published: retailer figures conflict (650 W and 600 W) with no manufacturer confirmation.
- 47-AS970E | source_title | "Hair Rotating Hot Air Styler" | Big Hair Luxe rotating air styler | Added the manufacturer's model name "Big Hair Luxe". 650 W published only because two independent sources agree.
- 47-E652E | source_title | "Nose And Eyebrowns" | Nose, Ear and Eyebrow Trimmer | Typo "Eyebrowns" corrected, and "Ear" added — the manufacturer's booklet confirms the rotary head is for nose AND ears, which the source title omitted.
- 47-E974E | source_title / product_type | "Men's Battery-Powered Hair Trimmer" / "Hair Trimmer" | Power Glide rechargeable hair clipper | E974E is a rechargeable (Ni-MH) full-head hair clipper named "Power Glide", not a battery-powered trimmer. Corrected in the content; the source `category` and `product_type` fields were left as supplied since they are not output fields.
- 47-SC758E | source_title / product_type | "Men's Battery-Powered Hair Trimmer" / "Hair Trimmer" | Crew Cut rechargeable hair clipper | SC758E is a Li-ion rechargeable hair clipper named "Crew Cut", not a battery-powered trimmer. Corrected in the content.
- 47-MT728E | source_title | "Garbon Steel" | Carbon Steel | Obvious typo; the manufacturer's model name is "10-in-1 Carbon Steel" and the blades are carbon steel. Corrected silently.
- 47-T861E | source_title | "0.5-12MM" | manufacturer booklet states 1-12 mm on the dial | The source figure and an independent retailer datasheet both give 0.5-12 mm, while the BaByliss booklet describes the dial as 1-12 mm (0.5 mm is presumably the bare blade, as on the E786E in this batch). Published 0.5-12 mm as the cutting range but described the dial without a lower figure. Flagging for the data owner.
- 47-ST255E | specifications | n/a | plate size not published | Retailer sources give both 25 x 90 mm and 25 x 95 mm for the plates and no manufacturer page confirmed either, so no plate dimension was published.
- 47-ST492E | specifications | n/a | auto shut-off period not published | The BaByliss booklet states 20 minutes; a retailer datasheet states 72 minutes. Published "Automatic shut-off: Yes" with no period.
- 47-AS950E, 47-AS970E, 47-AS774E, 47-ST492E, BA-ST495E | specifications | n/a | weight and product dimensions not published | Only retailer-supplied figures were available and several were clearly carton rather than product measurements, so no weights or dimensions were published for these items.


## Batch t1-b003 (tier 1)

# Discrepancy notes — batch t1-b003

- IT74029 | manufacturer_sku | null | not determinable | No model code supplied and Belkin sells several distinct 20,000 mAh BoostCharge 20K units (BPB002, BPB003, BPB011, BPB012) with different port counts and output wattage. Could not confirm which one this is, so nothing was published beyond the source title: no wattage, ports, dimensions or box contents, and long_description left empty.
- EL-CF1100aed06 | product_title | "Belkin IEEE 1394 Firewire Cable, 1.8 M, 6-Pin to 4-Pin" | "Belkin CF1100aed06 FireWire Cable, 6-Pin to 4-Pin, 1.8 m" | Reordered to brand/model/type/detail and fixed casing and unit spacing ("Firewire" to "FireWire", "1.8 M" to "1.8 m"). The model code was matched to a Belkin 6-pin to 4-pin 1.8 m FireWire cable, but no manufacturer specification page was found; no further specs published and long_description left empty.
- BE-BF600 WHITE | product name | "Beurer BF600 Diagnostic Scale" | "BF 600 Pure White" | Supplied EAN 4211125749033 matches Beurer article 74903, the BF 600 Pure White. Used the manufacturer's official variant name and recorded the colour as Pure White.
- BE-BM28 | product identity / ean | "Beurer BM28 Blood Pressure Monitor", EAN 4211125658212 | EAN 4211125658212 is Beurer article 658.21, the BM 28 supplied with a mains adapter; the plain BM 28 is article 658.13 / EAN 4211125658137 | Supplied EAN published unchanged as instructed. Content and title were corrected to the mains-adapter version, and the adapter is listed in the box contents. Specifications otherwise taken from Beurer's BM 28 page.
- BE-BM57BT | manufacturer_sku | "BM57BT" | "BM 57" | Beurer's model designation is BM 57 (article 658.22, EAN 4211125658229, which matches the supplied EAN). "BM57" published as the manufacturer code; "BT" appears to be a distributor suffix for the Bluetooth version.
- BE-BM57BT | cuff range | not supplied | 23–43 cm | A Beurer product catalogue page returned 22–44 cm, but that entry belongs to a different article (655.12). The official BM 57 instruction manual and a retailer listing carrying the exact article 658.22 both give 23–43 cm, so 23–43 cm was published.
- BE-BR60 | product name | "Beurer BR60 Insect Bite Healer Pen" | "BiteX Original BR 60 Pure White" | Supplied EAN 4211125606176 matches Beurer article 60617, the Pure White BiteX Original. Added the official series name and colour.
- BE-BR90 | product name | "Beurer BR90 Insect Bite Healer Pen with Light" | "BiteX Day & Night BR 90 Deep Black" | Supplied EAN 4211125607340 matches Beurer article 60734, Deep Black. Added the official series name and colour; the light is Beurer's "BiteSpotLight".
- BE-BS39 | product name | "Beurer BS39 Illuminated cosmetics mirror" | "Illuminated cosmetics mirror with powerbank BS 39" | Source title omits the integrated 3,000 mAh power bank, which is the defining feature of this model. Added it, and fixed source title casing.
- BE-BS49 | ean / variant | 4211125584009 | Beurer's currently listed BS 49 is article 584.01 / EAN 4211125584016 | The supplied EAN is article 584.00, a colour variant of the same BS 49 (confirmed by a retailer listing the article as 584.00 for the BS 49). Supplied EAN published unchanged. Colour was omitted from the content because only the 584.01 variant is documented as white.
- BE-CM50 | specifications | — | Beurer no longer publishes a CM 50 product page | Only figures corroborated across the product manual data and more than one retailer were published: 2 intensity settings, mains supply 100–240 V 50/60 Hz, 292 g, adjustable handle. Dimensions, wattage and box contents were left out, and no "What's in the box" section was written.
- BE-CM51 | colour | not supplied | Beurer lists article 10443 as turquoise blue, with a white version also available | Colour left out of the listing because the two variants could not be cleanly separated by article number.
- BE-FC41 | ean vs model | manufacturer_sku "FC41", EAN 4211125584115 | EAN 4211125584115 is Beurer article 584.11, which multiple retailers list as the FC 40; Beurer's own FC 41 page is article 584.17 | Could not resolve which unit actually ships. Supplied EAN published unchanged and FC41 retained as the model code per the source. Only specifications confirmed for BOTH the FC 40 and the FC 41 were published (5 suction levels, 3 attachments, USB charging, approx. 90 minutes runtime, LCD display); the FC 41-only dimensions (16.9 x 4.3 x 4.3 cm) and weight (172 g) were deliberately omitted.


## Batch t1-b004 (tier 1)

# Discrepancy notes — t1-b004 (Beurer, 15 products)

- BE-HL16 | manufacturer_sku | `BE-HL16` | `HL16` | Source repeated the prefixed internal SKU in the manufacturer_sku field. Published the manufacturer part only, as `HL16` / `HL 16`. The `sku` value was left exactly as supplied.
- BE-FC45 | source_title | `Beurer FC45 Facial Cleansing Brush` | `Facial brush FC 45` | Beurer writes the model with a space (`FC 45`). Applied that spacing in the titles and copy for this and all other items in the batch (`FC 65`, `FC 72`, `FC 76`, `FT 65`, `HC 30/35/60/80`, `HL 16/40/76`, `HR 2000`, `HS 30/60`); the unspaced form is retained in the eBay title and in the Manufacturer code row.
- BE-FC65 | source_title | `Cleansing Brush` | `facial brush` | Manufacturer names the product `FC 65 Pureo Deep Clear` facial brush. Kept the source's `Pureo Deep Clear` variant name, used the manufacturer's product noun.
- BE-FC72 | source_title | `Pureo Ionic Hydration Facial Sauna` | `Ionic facial sauna FC 72` | The manufacturer's global catalogue lists this simply as `Ionic facial sauna FC 72`; `Pureo Ionic Hydration` is the market/marketing name used in the source. Kept the source wording in the product title, as it does not assert a specification, but did not repeat it in the specification table (Model row reads `FC 72`).
- BE-HC35 | power | not supplied | `1600-2000 W` | The manufacturer states a 1600-2000 W range for the 230 V model matching the supplied EAN. A US-market listing for the same model code quotes 1500 W at 120 V; that figure was not used.
- BE-HC60 | power | not supplied | `1400 W` | The manufacturer's own specification table gives an output of 1400 W. Marketing copy on the same page describes this as converting "1400 watts consumption into 2000 watts of power" via ECO technology, and at least one retailer lists the dryer as 2000 W. Published the manufacturer's figure only, labelled `Power consumption 1400 W`; the 2000 W claim was not published.
- BE-HS30 | catalogue status | listed as current | discontinued from the manufacturer's current global range | No live manufacturer product page exists for article 59112. Specifications were taken from the manufacturer's own regional product page and the manufacturer's instructions for use for HS 30, which agree on 45 W, 100-240 V and a 100-200 degC range.
- BE-HR2000 | catalogue status | listed as current | no live manufacturer specification page | The manufacturer's UK product URL for article 58000 now redirects to the homepage. Figures were taken from the manufacturer's instructions for use for HR 2000.

## Fields deliberately left empty / not published

- BE-FC65 — product dimensions and weight omitted. The only figures found (16 x 5.6 x 7.5 cm, approx. 140 g) come from the US-market instruction manual and could not be confirmed as the product-only dimensions for the EU model.
- BE-FC72, BE-FC76 — no "What's in the box" section. Manufacturer pages confirm attachment counts but do not itemise a scope of delivery, and for FC 72 no accessory list could be confirmed at all.
- BE-FC76 — product dimensions omitted. The manufacturer publishes packaging dimensions only (given in the Packaging section); the weight shown (229 g) is the manufacturer's stated weight excluding packaging.
- BE-HC60 — cable length omitted; not stated by the manufacturer.
- BE-HS30, BE-HS60 — heat-up time and cable length omitted; not stated by the manufacturer. No "What's in the box" section, as the only confirmed contents are the appliance and its instructions.
- BE-FC45 — battery type/count omitted; the manufacturer states only "battery-operated".


## Batch t1-b005 (tier 1)

# Discrepancy notes — t1-b005 (Beurer)

- BE-MG205 | source_title | "Beurer MG 206 Shiatsu Massage Seat Cover" | Beurer MG 205 Shiatsu massage seat cover (article 640.57) | Source title model code contradicts the supplied `manufacturer_sku` (MG205) and the supplied EAN 4211125640576, which both resolve to MG 205. MG 206 is a separate current product (article 649.13, EAN 4211125649135). Wrote all content as MG 205.
- BE-HS80 | source_title | "Hair Iron" | Beurer names the product "Hair straightener HS 80" | Used "Hair Straightener" as the product type in the titles and content; no facts dropped.
- BE-HT50 | source_title | "Hot Air Brush Multistyler" | Beurer names it "Hot Air Styler HT 50" | Kept the source's "Hot Air Brush Multistyler" wording in the product title for searchability and used "hot air styler" in the body copy; the specification table records the manufacturer type.
- BE-HT15 | ean | 4211125591687 | Beurer's own documentation lists HT 15 under article number 593.34 (which would give EAN 4211125593346) | Supplied EAN published unchanged as instructed. Several European retailers do list HT 15 against the supplied EAN, so this is likely a second article/pack variant rather than a wrong code.
- BE-LR310 | ean | 4211125660239 | Beurer's LR 310 datasheet is issued under article 660.19 (EAN 4211125660196) | Supplied EAN published unchanged as instructed. A UK retailer listing confirms 4211125660239 as the LR 310 purifier unit (not a filter), so the specifications used are the LR 310 ones.
- ALL SKUs | brand/model formatting | "HS80", "HT10", "MG145" etc. | Beurer writes its model codes with a space ("HS 80", "HT 10", "MG 145") | Spacing corrected in customer-facing titles and copy; the unspaced manufacturer code is retained verbatim in the specification table's "Manufacturer code" row.
- BE-HT15 | source claim vs manual | source title implies general use | Beurer's HT 15 instruction manual states that if the comb has been used on an animal it must never afterwards be used on humans, while a Beurer press release promotes cat and dog use | No pet-use claim was written into the listing.


## Batch t1-b006 (tier 1)

# Discrepancy notes — batch t1-b006

- BE-MG70 | source_title | "Beurer MG70 Infrared Body Massage" | Beurer "MG 70 infrared tapping massager" | Used the manufacturer's product type (infrared tapping massager) and spaced model form "MG 70" in content; EAN 4211125649050 confirmed against Beurer article 649.05.
- BE-MG79 | source_title | "Beurer MG79 Sensitive Deep Tissue Massager" | Beurer "MG 79 Sensitive Limited Edition" (article 103.30, black) | Supplied EAN 4211125103309 identifies the Limited Edition variant, not the standard MG 79 Sensitive (EAN 4211125102180). Used the official variant name and stated the colour.
- BE-MG99 | source_title | "Beurer MG99 Deep Massager Limited Edition" | Beurer "MG 99 Compact Limited Edition", black/bronze (article 103.35) | Added the official "Compact" designation and the limited-edition colourway. Supplied EAN 4211125103354 matches the limited edition, not the standard turquoise MG 99 Compact (EAN 4211125650032).
- BE-MP28 | source_title | "Portable Pedicure Device, White" | Beurer product name is "callus remover" (Hornhautentferner) | Described as a callus remover; kept "White" from source as no manufacturer colour statement was found.
- BE-MP55 | source_title | "Callus Remover, Pink" | Beurer colourway is white/pink | Stated as White / pink.
- BE-WL 32 | source_title | "Dual Alarms" / "Adjustable Brightness" | Confirmed: 2 alarm times, adjustable light intensity | No correction needed; recorded because both were verified against the Beurer 589.22 datasheet.
- 08-MCP3000 | product_type / source_title | "Juicer" | Bosch classifies MCP3000 as a citrus press (VitaPress range) | Titled and described as a citrus press; "juicer" retained only as a search keyword in the eBay title.
- 08-MCP3000 | ean | null | No EAN found for the plain MCP3000 (as distinct from MCP3000N / MCP3000NGB) | EAN row omitted from the specification table.
- 08-MMR08R2 | product_type | "Food Processor" | Bosch classifies MMR08R2 as a chopper | Described as a food chopper.
- 08-MFW67440 | source_title | "Meat Grinder with a Power of 700 W" | Bosch "meat mincer"; 700 W rated power, 2000 W motor block | 700 W confirmed as the rated connection power; the 2000 W figure is the motor block rating and is labelled as such rather than used as the headline wattage.
- 08-BCH6ATH25 | ean | 787162844665 | Not verifiable against any Bosch document found | Published exactly as supplied, per brief. Flagged only because the prefix is not one Bosch normally uses for this range.

## Confirmed correct in source (no change made)

- BE-MG55: "20 W" and "3 Attachments" both verified against the Beurer 643.20 datasheet. A Beurer catalogue page appeared to contradict this (22 W, 2 attachments) but that entry describes the MG 70; the datasheet was taken as authoritative.

## Fields left empty / omitted because they could not be confirmed

- 08-BCH6ATH25: running time, charging time, battery capacity, dust container volume, filter type and the accessory/nozzle list are not stated in the Bosch spec sheets found; all omitted. Net weight omitted — two Bosch spec sheets for this model give 3.9 kg and 4.0 kg.
- 08-MCP3000: power consumption omitted. The 25 W figure that circulates belongs to the MCP3000N / MCP3000NGB, a different suffix.
- BE-MG70: weight omitted — the Beurer product page gives 1.11 kg and the Beurer instruction manual gives approx. 992 g.
- BE-MG79: weight omitted — Beurer's own MG 79 Sensitive page gives 313 g, a retailer listing for the Limited Edition gives 250 g.
- BE-MG70: no auto switch-off row. Beurer lists "automatic switch-off: no" alongside a 20-minute figure that reads as a maximum recommended session, so nothing was published.
- BE-MP48: wattage not published — not stated on the Beurer product page.
- BE-WL 32: FM frequency range not published — the only manual located is the US-band edition (88.1–107.9 MHz), which need not match the EU article 589.22.


## Batch t1-b007 (tier 1)

# Discrepancy notes — batch t1-b007

- IT74508 | manufacturer_sku | `GS3024BL ` (trailing space) | `GS3024BL` | trimmed; published as the model code
- IT74508 | source_title | "Steamer Quick Style Pro" | "QuickStyle 3 Pro Garment Steamer" | corrected to the manufacturer's official range name and spacing
- IT69288 | manufacturer_sku | null | `GS5011PU` | identified from the supplied EAN (8021098003928) and published as the model code
- IT69288 | source_title | "Quick Style 7" | "QuickStyle 5" | corrected; GS5011PU is the QuickStyle 5, not the QuickStyle 7
- IT69288 | colour | "White" | "White/Purple" | corrected to the official variant name (the source's own "W/P" agrees)
- IT69288 | source_title | "V/Iron" | (dropped) | vendor feed abbreviation, not a product attribute; removed from titles
- IT69289 | source_title | "Quick Style 7 V/Iron B/C, Black" | "QuickStyle 7 ... Black/Copper" | corrected spacing, dropped the feed abbreviation, used the official colour name
- IT57834 | colour | "Blue" | "White/blue" | manufacturer's official variant name used in title and table
- IT57834 | wattage | not supplied | conflicting retailer figures (2200 W vs 2400 W); Braun's own page states none | wattage omitted from all fields
- IT62942 | manufacturer_sku | `IS1514VI ` (trailing space) | `IS1514VI` | trimmed
- IT62942 | source_title | "Steam Iron System" | "CareStyle 1 Pro Steam generator iron" | corrected to the official range and product type
- IT73903 | source_title | "Iron Care Style" | "CareStyle 3" | corrected garbled range name
- IT69488 | steam rate | not supplied | Braun states up to 150 g/min; one retailer states 140 g/min | published Braun's own figure, hedged as "up to 150 g/min"
- IT69488 | pump pressure | "7 Bar" | one retailer lists 7.5 bar, another 7 bar | kept the supplied 7 bar (majority and source agree)
- IT69486 | category / product_type | "Steam Irons" / "Steam Iron" | steam generator iron | IS5247VI is a CareStyle 5 steam generator; content written as a steam generator iron
- IT69486 | pump pressure | not supplied | one retailer states 7.5 bar | single unverified retailer figure, so pressure omitted
- IT65875 | source_title | "Steam Iron System" | "CareStyle 7" | official range name added; model is CareStyle 7 (some retailers label it "CareStyle 7 Pro")
- IT65875 | weight | not supplied | retailers give 4.7 kg and 4.94 kg | conflicting, so weight omitted; dimensions not clearly labelled as product dimensions and also omitted
- IT65876 | steam rate | not supplied | Braun's 190 g/min figure is footnoted as applying to IS7286BK only | continuous steam omitted for IS7282BL
- IT60281 | colour | "Black" | Braun lists the finish as Black/Copper | published as Black, matching the source and the official product name "IS 7286 Black"
- SL-COMPETITOR1500 | source_title | "Premium Performance" | (dropped) | marketing wording, not a confirmed attribute; no specification data for this model found in research, so power, impedance, sensitivity and mounting depth are all omitted and long_description left empty
- BR-MGK7 | manufacturer_sku / ean | null / null | not determined | "MGK7" is a Braun range (MGK7220, MGK7320, MGK7331, MGK7440, MGK7491 and others), not a single article number; no specification could be tied to this entry, so long_description and key_features left empty


## Batch t1-b008 (tier 1)

# Source-data discrepancies — batch t1-b008

- IT62908 | brand | Braun | Ufesa | Source brand field said Braun but the source title, manufacturer code (PV2600 GlidePro) and EAN are all Ufesa. Published as Ufesa throughout.
- IT62908 | manufacturer_sku casing | PV2600 GLIDEPRO | PV2600 GlidePro | Manufacturer styles the model as GlidePro; casing corrected in all text.
- IT45602 | source_title colour | Green | Turquoise | Braun's own listing for SI3041GR is "TexStyle 3 Steam iron SI 3041 Turquoise". Used the official colour name.
- IT64555 | source_title range name | (none given) | TexStyle 1 | Braun's official name is "TexStyle 1 Steam Iron SI 1080 Violet/white". Range name added to title and specification table.
- IT57699 | source_title colour | Purple & White | Purple | Braun lists the SI3030PU as Purple. Published as "Purple/White", keeping the source fact.
- IT71658 | source_title product name | Burr Mill | Professional Burr Mill | Cuisinart's official product name for DBM8V2U. Used the official name.
- IT71149 | brand spelling | Delonghi | De'Longhi | Brand corrected to the manufacturer's spelling. Same correction applied to IT42774, IT48352 and IT64566.
- IT71149 | source_title | "DeLonghi EC890.M Dedica Duo EC890.M Espresso Coffee Machine, Silver" | Dedica Duo EC890.M, Stainless Steel | Model code was duplicated in the source title; removed the repeat. De'Longhi describes the finish as stainless steel rather than silver.
- BR-S9-4200 | manufacturer_sku and ean | null | not found | No manufacturer code or EAN supplied, and no Braun listing for a "Series 9 4200" could be confirmed. Written from the source title alone: long description left empty, key features left empty, specification table limited to brand, range, model and type.
- IT67018 | ean | null | not found | No EAN supplied and no manufacturer listing for Crystal Air DF-AF1312CC1 found. Only the 23 litre tank from the source title is published.
- IT42774 | research | — | not found | De'Longhi AC75 is not on any current De'Longhi regional site (checked the UK and Italian product sitemaps). No specification beyond source data published.
- IT48352 | research | — | not found | De'Longhi DDSX225 is not on any current De'Longhi regional site. No specification beyond source data published; no extraction capacity claimed.
- IT64566 | research | — | not found | De'Longhi DEX210SF is not on any current De'Longhi regional site. The source's "10lt" is ambiguous between daily extraction and tank volume, so it appears only in the title as given and is not published as a labelled specification.
- IT45604 | wattage (conflicting third-party figures) | 2300 W seen at one retailer | 2400 W | Braun's own product page for SI3055BK states 2400 W. Published the manufacturer figure.
- IT64555 | water tank capacity | not in source | 220 ml | Not stated on Braun's product page; published on the strength of several independent retailer listings for the same model code.


## Batch t1-b009 (tier 1)

# Discrepancy notes — batch t1-b009

- IT68405, IT45600, IT55102, IT41812, IT69482, IT42307, IT64669, IT69480 | brand | "Delonghi" | "De'Longhi" | corrected spelling and apostrophe throughout (IT69480 supplied a curly apostrophe; normalised to a straight one)
- IT68405 | source_title | "Tasciugo AriaDry 16L Multi Dehumidifier" | "Tasciugo AriaDry Multi" | corrected to the manufacturer's official range name and word order
- IT68405 | dimensions | not supplied | De'Longhi gives 508 x 334 x 220 mm | published without an axis order because De'Longhi does not label the axes; tank capacity is not published on De'Longhi's own page, so no tank row
- IT45600 | source_title | "20 litres" | 7.5 L / 24 h | corrected; DNS80 is the Tasciugo AriaDry Light rated at 7.5 litres per 24 hours (agreed by De'Longhi's own product naming and several independent retailers). The "20 litres" figure could not be tied to any published specification and was dropped
- IT45600 | source_title | range not stated | "Tasciugo AriaDry Light" | official range name added
- IT45600 | colour | not supplied | Grey | added from the manufacturer's variant description
- IT45600 | dimensions / weight / tank / noise | not supplied | 500 x 192 x 340 mm, 6.5 kg, 2.8 L, 48 dB | taken from a reputable retailer's product-specification table (explicitly product, not carton); De'Longhi's own DNS80 page could not be reached
- IT45600 | wattage | not supplied | not found on any manufacturer source | power consumption omitted from all fields
- IT55102 | manufacturer_sku / source_title | "EC 785.GY" (space) | "EC785.GY" | space removed
- IT55102 | source_title | "Dedica" | "Dedica Metallics" | corrected to the manufacturer's official range name
- IT41812 | source_title | "Dedica Pump Espresso Coffee Maker" | "Dedica Style" | corrected to the manufacturer's official range name
- IT55102, IT41812 | dimensions | not supplied | De'Longhi gives 149 x 330 x 305 mm for both | published without an axis order, as De'Longhi does not label the axes (the 149 mm figure is the width, confirmed by De'Longhi's "only 15 cm wide" claim)
- IT69482 | source_title | "Magnifica Plus Titanium, Black" | "Magnifica Plus", colour "Titanium black" | reordered; "Titanium black" is the single colour name, not two colours
- IT69482, IT64669, IT69480 | wattage / pump pressure / tank / bean hopper / dimensions / weight | not supplied | not published on De'Longhi's product pages and no manufacturer datasheet reachable | all omitted; the tables carry only manufacturer-confirmed drink, milk-system, display and finish data
- IT42307 | source_title | "Electric Fan Heater" | "Capsule Fan heater Cream 1.8KW" | corrected to the official range ("Capsule") and product description; the element is ceramic
- IT42307 | colour | not supplied (".IW" suffix) | Cream | De'Longhi names the finish Cream; published as Cream
- IT64669 | manufacturer_sku | "IT64669" (the internal code repeated) | "ECAM290.31.SB" | the real model code was taken from the source title and published; the internal code was not published anywhere
- IT64669 | source_title | "Fully Automatic Espresso Maker" | Magnifica Evo bean-to-cup coffee machine | described as a bean-to-cup machine, matching De'Longhi's own wording
- IT69480 | source_title | model only, no product type | "Magnifica Evo Next automatic coffee maker" | product type and colour (silver black) added from the manufacturer page
- 47-DNE302HB, 47-DNE302HS | research | no manufacturer or reputable retailer specification page found for DNE302HB / DNE302HS | written from the source title alone; only brand, model, type, colour and the 100 W rating published, long_description left empty
- 47-DNE302HS | ean | null | not found | EAN row omitted from the table
- LHT65N-868 | source_title | "LHT65N" | "LHT65N-868" | the supplied manufacturer code carries the band suffix; published in full, and the frequency band published as EU868 on the strength of that suffix (Dragino's page lists the whole band family, not the per-variant band)
- LHT65N-868 | IP rating / TX power | not supplied | not stated on Dragino's product page | omitted
- LT-22222-L-868 | source_title | "RS485" | not present in Dragino's I/O list for this model | RS485 dropped from all fields; Dragino enumerates 2 digital in, 2 digital out, 2 relay out, 2 x 0-20 mA and 2 x 0-30 V analogue in, with no serial interface
- LT-22222-L-868 | source_title | "Data Logging" | not confirmed on Dragino's product page for this model | dropped from all fields
- DY-533896-01 | manufacturer_sku | "533896-01" | Dyson's own Airwrap Origin Nickel/Copper page shows part number 112905-01 | the supplied code was published unchanged as the manufacturer code, but the mismatch means the bundle could not be pinned down; the "What's in the box" section was therefore omitted even though Dyson lists attachments for that colourway. Machine-level specification (V9 motor, 1300 W, 3 heat / 3 speed, weight, dimensions, cable) is from Dyson's own Airwrap Origin page
- DY-533896-01 | ean | null | not found | EAN row omitted
- DY-AB14 | manufacturer_sku / ean | null / null | not determined | "AB14" does not resolve to a Dyson Airwrap article number on any Dyson source, and "Airwrap Complete" covers several generations and bundles. No specification published; long_description and key_features left empty
- DY-HD08 | manufacturer_sku / ean | null / null | not determined | HD08 is an earlier Supersonic generation and Dyson's current Supersonic pages do not state a model code, so none of the specification on those pages could be tied to HD08. Nothing beyond brand, range, model and type published; long_description and key_features left empty


## Batch t1-b010 (tier 1)

# Discrepancy notes — t1-b010

- DY-V11-ADVANCED | manufacturer_sku | `DY-V11-ADVANCED` | `V11 Advanced` | The supplied manufacturer_sku carries the vendor prefix `DY-`. Published the Dyson model name only; no bare manufacturer article number could be confirmed, so no "Manufacturer code" row was emitted (Model row used instead).
- DY-V11-ADVANCED | ean | null | not found | No EAN supplied and none confirmed; EAN row omitted from the table.
- 65-16567828 | source_title | "20 Shot Pack" | twin pack, 2 x 10 sheets | Fujifilm supplies this article as a twin pack of two 10-sheet cartridges. Stated the pack format explicitly rather than leaving "20 shot" ambiguous.
- HADJ-GAS-42800 | source_title | "Design Mini Egg Cooker" | "Design Egg Cooker Mini" (Design Eierkocher Mini) | Used the manufacturer's official variant name and word order.
- HADJ-GAS-42800 | wattage | 350 W (source) | 350 W max (manufacturer) | Source figure confirmed against Gastroback. Noting that at least one retailer listing states 280 W for the same article; the manufacturer figure of max. 350 W was published.
- MT-1Y4D0UT | source_title | "HP 235 Wireless Mouse and Keyboard Combo" | confirmed unchanged | No discrepancy; HP's official product name matches the source.
- MT-671R3UT | source_title | "HP USB-C power adapter - AC 115/230 V - 65 Watt" | "HP USB-C 65W Laptop Charger" | Used HP's official product name. Retained the source input-voltage fact (AC 115/230 V) in the title and table; HP's own page states input frequency 47-63 Hz but does not restate that voltage pair.
- IT41840 | sku | `IT41840` | manufacturer article 78691 | The internal sku does not contain the manufacturer article number and carries no recognisable vendor prefix. Published `78691` (Hama full article number 00078691) as the manufacturer code; the sku appears nowhere in text.
- IT41840 | research | Hama Professional Lens Cleaning Kit | not confirmed | Hama's own product page could not be reached and no manufacturer-level contents list was confirmed. Kit contents, long description and key features left empty rather than assumed.
- HB-HOBOT-S7-PRO | source_title | "15nm Ultrasonic Spray" | published as "15 nm ultrasonic" | Spacing normalised only; the figure is carried through from source and could not be independently confirmed against Hobot.
- HB-HOBOT-2S | manufacturer_sku | `HOBOT-2S` | `HOBOT-2S` | No change. Title uses "Hobot 2S" to avoid the doubled brand name; full model code `HOBOT-2S` appears in the specification table.
- HB-HOBOT-388 | manufacturer_sku | `HOBOT-388` | `HOBOT-388` | No change. Title uses "Hobot 388"; full model code appears in the specification table.
- MAR-EM-JE061-NV | source_title | "Little Bird in ear navy" | "Little Bird In-Ear Earphones, Navy" | Corrected casing and used the manufacturer's official product name. Confirmed EM-JE061-NV is the Navy variant of the wired Little Bird in-ear earphones (not the Little Bird True Wireless earbuds, model EM-JE123).
- MAR-EM-JA014-SB | source_title | "Singature Black" | "Signature Black" | Typo corrected silently in all output fields.
- MAR-EM-JA015-SB-FOC | source_title | "Bleutooth" | "Bluetooth" | Typo corrected silently in all output fields.
- MAR-EM-JA015-SB-FOC | sku vs manufacturer_sku | `MAR-EM-JA015-SB-FOC` | `EM-JA015-SB` | The sku carries both a vendor prefix and a trailing `-FOC` suffix not present in the manufacturer code. Published `EM-JA015-SB` only.
- MAR-EM-JA013-SB / MAR-EM-JA014-SB / MAR-EM-JA015-SB-FOC | specifications | — | not confirmed | Get Together Mini, Bag of Riddim 2 and No Bounds are discontinued and no longer listed by House of Marley; no manufacturer specification page could be reached. No driver, output power, battery, Bluetooth version, IP rating, dimension or weight figures were published for these three, and their long descriptions were left empty.


## Batch t1-b011 (tier 1)

- MAR-EM-JE061-WT | manufacturer_sku | JE061-WT | EM-JE061-WT | Source code was missing the "EM-" prefix; manufacturer lists the White Little Bird variant as EM-JE061-WT. Published the corrected code; sku and ean unchanged.
- MAR-EM-JE041-DN | manufacturer_sku | EM-JE041-BA | EM-JE041-DN | Source carried the Brass code on the Denim item. Manufacturer's Smile Jamaica variant list has Denim as EM-JE041-DN. Published the corrected code; sku and ean unchanged.
- MAR-EM-JE041-PU | source_title colour | Peach | Purple | EM-JE041-PU is listed as Purple by the manufacturer variant list and by reputable retailers; Smile Jamaica has no Peach colourway (Peach belongs to the Little Bird line, EM-JE061-PH). Corrected the colour in all content; sku and ean unchanged.
- MAR-EM-JE041-PU / MAR-EM-JE041-PUB | ean | 846885007075 on both | not resolved | Two different SKUs share one EAN and, once the Peach/Purple error above is corrected, both resolve to Purple Smile Jamaica. Published the supplied EAN on both as instructed; flagged for the catalogue owner as a probable duplicate listing.
- MAR-EM-JH121-CP | source_title colour | "Denim - ... , White" | not resolved | The source title contains two conflicting colours (Denim mid-string, White at the end) and the -CP suffix is Copper elsewhere in the House of Marley range. Could not confirm the variant colour, so no colour is stated anywhere in the content and the Colour row is omitted from the table.
- MAR-EM-JH121-DN | source_title | duplicated marketing string shared with the -CP item | Denim | Kept Denim for this item; the same wording appears on the -CP item and is the likely source of that item's colour conflict.
- MAR-EM-JT002-SB | source_title | "Singature Black" | Signature Black | Obvious typo in the colourway name; corrected in the content.
- MAR-EM-JA006-SBA | source_title | "Singature Black" | Signature Black | Obvious typo in the colourway name; corrected in the content.
- MAR-EM-JA006-SBA | source_title model code | JA006-SBA | EM-JA006-SBA | Title used the short form without the "EM-" prefix; used the full manufacturer code from the manufacturer_sku field in the content.
- MAR-EM-JE041-PUB | source_title model code | JE041 | EM-JE041-PUB | Title used a truncated model code; used the full manufacturer code from the manufacturer_sku field in the content.
- MAR-EM-JE041-SB | source_title colour | "Smile Jamaica Signature, Black" | Signature Black | Colourway name was split by a stray comma; the manufacturer's variant name is Signature Black. Corrected in the content.
- MAR-EM-JE061-BK / MAR-EM-JE061-RA | source_title | no model code in title | EM-JE061-BK / EM-JE061-RA | Titles carried only the product name; added the manufacturer code from the manufacturer_sku field.
- MAR-EM-JT002-SB, MAR-EM-JA006-SBA | research | n/a | n/a | EM-JT002-SB (Stir It Up Wireless) and EM-JA006-SBA (Get Together) are discontinued and absent from the manufacturer's current catalogue; no specification page could be confirmed for either exact code. The manufacturer page for the Stir It Up Wireless handle now serves the successor model EM-JT005-SB, whose specifications were deliberately NOT used. Both items are published from source-title facts only, with an empty long_description.


## Batch t1-b012 (tier 1)

# Discrepancy notes — t1-b012

- MAR-EM-JE091-BA, MAR-EM-JE091-SB | source_title | "Wired Headphones" | Wired in-ear earphones | House of Marley and Currys Business both list EM-JE091 as in-ear earphones ("Uplift 2.0 Earphones"), not over- or on-ear headphones. Corrected the product type in the title, bullets and specification table.
- MAR-EM-JE091-SB | source_title | "Marley Uplift 2.0" | House of Marley Uplift 2.0 | Source title drops the brand's first two words while the brand field carries the full name. Corrected silently in the title.
- MAR-EM-JE091-SB | colour | "Black" | Black (confirmed) | One reseller lists EM-JE091-SB as Silver. Currys Business lists EM-JE091-SB as Black against EAN 846885009444, which is the supplied EAN, so Black was published. The reseller's Silver listing carries a different EAN (846885009468) and is a different variant.
- MAR-EM-JE091-BA, MAR-EM-JE091-SB | driver size | sources conflict (9 mm vs 8 mm) | (unresolved) | Currys Business gives a 9 mm driver, a second reseller gives 8 mm. No driver size published. All other audio figures (20-20,000 Hz, 16 ohms, 103 dB, 10 mW max input, 1.3 m cable, 3.5 mm jack, in-line mic, recycled aluminium and silicone) come from the Currys Business specification sheet for EM-JE091-SB and are shared across the two colourways of the same model.
- MAR-EM-JE091-BA, MAR-EM-JE091-SB | in-line control | retailer sheet says "Volume control: Yes" but "Remote control: No" | (unresolved) | Internally contradictory, so only the microphone was published. No claim made about volume or track control on the cable.
- MAR-EM-JE091-BA | research | no listing found for the Brass colourway itself | (unresolved) | Only the Black variant of EM-JE091 could be found on a reputable retailer. The specifications published for Brass are the shared EM-JE091 figures; nothing colour-specific beyond the finish name was published.
- ATP-RM-L1379 | research | nothing usable found | (unresolved) | No manufacturer page or reputable retailer listing for Huayu RM-L1379 could be reached. Written from the source title alone: brand, model, remote control, LG compatibility. long_description returned empty and no specification figures were published.
- CED-223636 | manufacturer_sku | " IZ-1500" (leading space) | IZ-1500 | Stray leading whitespace in the source field. Trimmed; published as IZ-1500.
- CED-223636 | source_title | "Spicy Stand Mixer, Red" | Izzy Spicy Red IZ-1500 | The manufacturer's variant name is "Spicy Red", not "Spicy" plus a separate colour. Corrected silently in the title. The Greek distributor's own product page for this machine carries article number 223636, which matches the supplied SKU, confirming the match.
- CED-223636 | source_title | no power, capacity or attachments given | 1500 W, 7 L stainless steel bowl, 6 speeds plus pulse, planetary action, whisk / beater / dough hook / bowl cover / non-slip base, overheat and overload protection | All confirmed on the distributor's product page for IZ-1500 and published.
- JAM-HX-P505GY | ean | 31262087348 (11 digits) | 031262087348 | The supplied value is a 12-digit UPC-A with the leading zero stripped. Published exactly as supplied, per the rule on EANs. Same issue on JAM-HX-EP303BK (31262087669) and RET-EA817810 (10942222934).
- JAM-HX-P505GY | source_title | "Waterproof" | IP67 | Both the JAM instruction book and a specification database give IP67 (dust proof, submersible to 1 m for 30 minutes). Published the rating rather than the bare word.
- JAM-HX-EP303BK | protection rating | one specification database lists "Waterproof" with no IP rating; the manufacturer's manual gives none | (unresolved) | No water-resistance claim published for the earbuds. Playtime (7 h), charge time (~2 h), micro-USB integrated cable, three ear tip sizes, controls and microphone are confirmed by JAM's own instruction book.
- JAM-HX-EP303BK | dimensions and weight | a specification database gives 31.75 g and 30.99 x 12.7 x 9.91 mm | (not published) | Single-source figures for a single earbud, of no practical use to a buyer and not clearly labelled as product-level. Omitted.
- HADJ-PBWH | manufacturer_sku | "PBWH" | PMB-WH | The manufacturer_sku field and the source title disagree. PMB-WH (the form in the source title, and consistent with JBL's Pole Mount Bracket / White naming) was published as the manufacturer code. Neither form could be confirmed on JBL Professional's site, which blocks automated access, nor on a pro-audio retailer.
- HADJ-PBWH | research | nothing usable found | (unresolved) | No specification, material, load rating, dimensions or cable length published. long_description returned empty; content is limited to what the source title states.
- 2E-KDM120-PBL, 2E-KDM120-PSV, 2E-KDM120-PRD | model code | KDM120 | KDM120P | Kalko's own catalogue lists this machine as the KDM120P household frappe mixer; the vendor codes append the colour to it (KDM120-PBL etc.). Published KDM120P as the model in the title and the vendor's colour-suffixed code as the manufacturer code.
- 2E-KDM120-PSV | manufacturer_sku | "KDM120-PSL" vs source title and SKU "KDM120-PSV" | KDM120-PSV | The manufacturer_sku field disagrees with both the SKU and the source title. Published KDM120-PSV, the form carried by two of the three source fields.
- 2E-KDM120-PSV | colour | "Silver" | Kalko lists this line in Black, Mint Green, Red, White and Grey — no Silver | (unresolved) | Kalko's own colour list has no Silver; the nearest is Grey. The supplied colour was kept in the content because no mapping from the vendor's PSV/PSL suffix to a Kalko finish could be confirmed. Flagged here as the one field on this item a buyer could be misled by.
- 2E-KDM120-PRD | manufacturer_sku | null | KDM120-PRD | No manufacturer code in the source. Derived from the SKU by stripping the 2E- vendor prefix, consistent with the two sibling items.
- 2E-KDM120-PBL, 2E-KDM120-PSV, 2E-KDM120-PRD | ean | null | (none published) | No EAN supplied for any of the three; no EAN row emitted.
- IT50448 | source_title | "2L Capacity" | 2 L goblet, 1.5 L working capacity | Kenwood's own specification for BLP41 gives a 2 L goblet with 1.5 L of usable working volume. Both figures published so the buyer is not told to fill it to 2 L.
- IT50448 | source_title | "Dishwasher-Safe Parts" | (not published) | Kenwood's own specification table leaves the dishwasher-safe field blank for BLP41 on both the UK and Greek sites. The claim was dropped rather than repeated; the removable stainless steel blade unit, which is what the marketing text actually describes, is published instead.
- IT50448 | weight | not in source | 2.04 kg | Taken from Kenwood's own specification table. The unit is not stated explicitly on the page; kg is the unit used throughout Kenwood's tables and 2.04 kg is consistent with a plastic-goblet jug blender. Published as kg.
- IT57048 | manufacturer_sku | null | CHP61.100WH | No manufacturer code in the source. Taken from the source title and confirmed against Kenwood's own product pages for the Easy Chop.
- IT57048 | source_title | "Easy Chop Chopper" | Easy Chop Mini Chopper | Kenwood's official product name. Corrected silently in the title.
- IT57048 | source_title | "2 Speeds" | 2 pressure-sensitive speeds | Kenwood describes the two speeds as selected by pressure on a single button. Qualified so a buyer does not expect a two-position switch.
- IT57048 | ean | null | (none published) | No EAN supplied; no EAN row emitted.
- IT48755 | source_title | bare title, no specification | 800 W, 2.1 L bowl, 1.2 L glass blender, 2 speeds plus pulse, ten-item accessory set, 20 x 23 x 36.5 cm, 3.693 kg | FDM301SS is discontinued on Kenwood UK but still listed on Kenwood's Greek site, which carries the full specification and box contents. All published figures come from that page.
- IT48755 | specification table | Kenwood's own table lists "LCD Display" under Functions | (not published) | FDM301SS is a mechanical two-speed processor and no other part of the page, image or accessory list supports a display. Treated as an error in Kenwood's table and omitted.
- IT48755 | colour | not stated in source; Kenwood's table leaves colour blank | (not published) | The SS suffix implies stainless steel but nothing confirms it, so no colour or finish was published.
- IT48755 | ean | null | (none published) | No EAN supplied; no EAN row emitted.
- RET-EA817810 | research | model code could not be confirmed | (unresolved) | Krups lists EA817840 and EA817040 (Arabica Digital) but no EA817810. A different suffix is a different product, so nothing was carried across from those listings — no pump pressure, tank or hopper capacity, grind settings, wattage or dimensions were published. Content is limited to what the source title states: automatic espresso machine, integrated bean grinder, LCD screen. long_description returned empty.
- RET-EA817810 | source_title | keyword-stuffed ("Espresso Bean Grinder, Coffee Maker, Espresso Machine, Automatic Espresso Machine, LCD Screen") | one product type plus two features | Rewritten as a single product description; the repeated category words were collapsed rather than dropped.
- 47-BW442D10 | source_title | "BW 442 D" and "Black,Stainless steel" | BW442D10, "Black and stainless steel" | Spacing errors in the model code and a missing space after the comma. Corrected silently.
- 47-BW442D10 | range name | not in source | Krups "Control Line" BW442D | A manual database gives the range name as Control Line for the BW442D family. Not confirmable on Krups' own site, which no longer lists the model, so the range name was NOT published. The 1.7 L capacity, 2400 W rating and black / stainless steel finish are published from the source data only; no boil-dry protection, filter, water gauge or cordless-base claim was made because none could be confirmed.


## Batch t1-b013 (tier 1)

# Discrepancy notes — t1-b013

## Source-data discrepancies corrected

- STPHN-LAT.01778 | product name/casing | `LENOVO 83D40066CY Notebook IDEAPAD PRO 5` | `Lenovo IdeaPad Pro 5 16IMH9` (machine type 83D4) | Corrected brand/model casing and added the official variant suffix. Lenovo's own support catalogue lists machine type 83D4 as "IdeaPad Pro 5 16IMH9"; used that name and the 16IMH9 PSREF specification sheet as the source for series-level specs.
- MT-82YU00YQCY | model name | `Lenovo V15 Business Notebook` | `Lenovo V15 G4 AMN` (machine type 82YU) | Used the manufacturer's official variant name. Lenovo's V15 G4 AMN specification sheet lists MT 82YU and offers the Ryzen 5 7520U quoted in the source title.
- MT-82YU00YQCY | colour | `Black` | `Business black` | Used Lenovo's official colour name for this chassis.
- IT68277 | source_title typo | `W-Fi` | `Wi-Fi` | Corrected silently in the content.
- IT68274 / IT68275 / IT68276 / IT68277 | brand | `MeacoDry Arete®` | `Meaco` | The manufacturer brand is Meaco; "MeacoDry Arete" is the product range. Published Brand as Meaco and kept the range in the model name.
- LE-3238 | source_title formatting | `30X600CM` | `30 x 600 cm` | Casing/spacing fix only.
- LE-3233 | source_title formatting | `500ml, 800ml, and 1400ml` | `500 ml, 800 ml, 1400 ml` | Spacing fix only.

## SKU / manufacturer-code handling

- IT68207 | manufacturer_sku | `IT68207` | no manufacturer code confirmed | The value duplicates the internal vendor SKU. Every other `IT`-prefixed row in this batch carries a genuinely different manufacturer_sku, so `IT` is a vendor prefix and `IT68207` is not a manufacturer part number. Omitted the "Manufacturer code" row rather than publish the internal code.
- IT64530 | manufacturer_sku | sku `IT64530`, manufacturer_sku `221-0378` | `221-0378` | Published `221-0378` as the model code; the `IT` vendor code appears nowhere in text.
- MT-11239210 | manufacturer_sku | sku article number `11239210`, manufacturer_sku `CR2025` | `CR2025` | Published `CR2025`; the vendor article number appears nowhere in text.
- ROM-1A-MAT-07EQ | model code | vendor prefix `ROM-1A-` | `MAT-07EQ` | Published the manufacturer part only.
- STPHN-LAT.01778 | model code | sku bears no relation to the product | `83D40066CY` | Model code taken from the source title, not the SKU.

## EAN observations (supplied value published unchanged, as instructed)

- 47-EA815570 | ean | `10942218777` | full GTIN-13 is `0010942218777` | The supplied value is the 11-digit UPC with leading zeros stripped. Published exactly as supplied.
- 47-EA817810 | ean | `10942222934` | full GTIN-13 is `0010942222934` | Same; published exactly as supplied.

## Rated capacity vs measured extraction (Meaco dehumidifiers)

- IT68275 | extraction rate | model named `20L` | 14.02 L/day at 20 °C / 80% rh (manufacturer) | The number in the model name is a range designation, not a measured rate at the manufacturer's own quoted conditions. Published the measured figure with its test condition rather than "20 L/day".
- IT68276 | extraction rate | model named `25L` | 17.53 L/day at 20 °C / 80% rh (manufacturer) | As above.
- IT68277 | extraction rate | model named `20L` | 20.45 L/day at 30 °C / 80% rh (manufacturer) | As above; the 30 °C figure is the manufacturer's headline for this model.

## Judgement calls worth flagging

- MT-11239210 (Maxell CR2025) | voltage and cell dimensions | not from a fetched Maxell datasheet | 3 V, 20.0 x 2.5 mm, lithium manganese dioxide | No Maxell datasheet page could be reached. These three values are definitional to the IEC 60086 designation "CR2025" that is itself the supplied manufacturer code (C = lithium manganese dioxide, R = round, 20 = 20 mm diameter, 25 = 2.5 mm height, all CR coin cells 3 V nominal), so they are a decoding of the source data rather than a product-specific claim. Nominal capacity, weight and operating temperature were NOT published because those do vary by manufacturer.
- 47-EA815570 | product dimensions and weight | published 365 x 245 x 330 mm, 7.4 kg | Retailer listing that explicitly separates net dimensions/net weight from gross weight, with the 330 mm depth independently corroborated by a second listing. Treated as product, not carton, dimensions on that basis.

## Could not confirm — fields deliberately left empty

- IT64530 (LIFE 221-0378): no manufacturer page or retailer listing for this model code was reachable. No wattage, hob diameter, dimensions, controls or EAN published. `long_description` empty.
- ROM-1A-MAT-07EQ (Matestar MAT-07EQ): nothing found on this model code. No airflow, tank capacity, wattage or dimensions published. `long_description` empty, one key feature only.
- IT68207 (Matestar quartz heater): nothing found. Only the brand, type, 2200 W and black finish from the source title are published. `long_description` empty.
- BNC-2110967 (Lenovo GX20P92529): no Lenovo product page or datasheet reachable for this part number. Output voltage/current, input range, cable length, plug type, weight and device compatibility all left out; only the 65 W rating and USB-C connector from the source title are published. `long_description` empty.
- STPHN-LAT.01778 (Lenovo 83D40066CY): the machine type (83D4 = IdeaPad Pro 5 16IMH9) is confirmed, but the specific configuration behind part suffix 0066CY is not published anywhere reachable. Published only specifications common to every 16IMH9 configuration. The exact CPU model, graphics (integrated Arc vs discrete RTX), memory capacity, storage capacity, panel type/resolution and operating system are therefore all omitted.
- 47-EA817810 (Krups): pump pressure in bar could not be confirmed for this suffix, so no bar figure is published. Bean-hopper capacity and weight appeared in only one source and were omitted. Product dimensions omitted (only carton-looking figures were available).
- 47-EA815570 / 47-EA817810: no energy class or annual consumption figure could be confirmed; none published.
- LE-3238 (Leifheit 3238): the number of rolls in the pack could not be confirmed (source title says "Rolls" plural, the one reachable listing describes a single roll), so no quantity is stated — only the 30 x 600 cm roll size from the source title. The label count seen on one aggregator was omitted as unverified; the listing says only that labels are included.
- IT68274 (Meaco Arete One 12L): the manufacturer page states "HEPA filter" without a grade for this model, unlike the 20L/25L/Two 20L pages, so H13 is NOT claimed here. Energy class not published for any of the four dehumidifiers — Meaco does not state one.


## Batch t1-b014 (tier 1)

# Discrepancy notes — batch t1-b014

- IT68278 | brand | `MeacoDry Arete®` | Meaco | Brand is Meaco; `MeacoDry Arete Two 25L` is the range/model name. Published Brand as Meaco and the range separately.
- IT68278 | source_title | `W-Fi` | Wi-Fi | Obvious typo; corrected silently in the content.
- IT68278 | manufacturer_sku | null | none published | Meaco does not use a short article code for this line; only the range name is published.
- IT72524 | source_title | `QLED HD` | 1920 x 1080 (Full HD) | Two independent listings for 32MQF7000Z give 1920 x 1080. Published as Full HD; source wording "HD" not repeated.
- IT72524 | HDMI count | not in source | 2 vs 3 (sources disagree) | Conflicting retailer figures; HDMI row omitted from the table.
- IT72524 | VESA / dimensions | not in source | 200x200 vs 200x100; depth differs | Conflicting figures; VESA and dimensions omitted.
- ΙΤ73840 | manufacturer_sku | `65MNH7000` | 65MNH7000 (confirmed) | A `65MNH7000Z` variant also exists with different figures (144 Hz, energy class G, 400x200 VESA). Its data was NOT used; only sources carrying the exact code 65MNH7000 were used.
- ΙΤ73840 | dimensions / weight / Bluetooth / brightness | not in source | sources disagree | Two listings for 65MNH7000 give conflicting panel dimensions and opposite Bluetooth answers; all four rows omitted.
- CED-224140 | brand | `Midea` | Izzy | Product is an Izzy model (article 224140 = IZ-1701). Brand corrected to Izzy in the content.
- CED-224106 | brand | `Midea` | Izzy | Product is an Izzy model (article 224106 = IZ-6904). Brand corrected to Izzy in the content.
- CED-IZZY-224915 | brand | `Midea` | Izzy | Brand corrected to Izzy in the content.
- CED-IZZY-224638 | brand | `Midea` | Izzy | Brand corrected to Izzy in the content.
- CED-IZZY-224372 | brand | `Midea` | Izzy | Brand corrected to Izzy in the content.
- CED-IZZY-224372 | source_title | `IZ1110` | IZ-1110 | Manufacturer writes the code hyphenated; corrected silently.
- CED-IZZY-224915 | model link | article 224915 | IZ-8225 | Article number could not be cross-checked against the model code. Identified by unique match on brand + dual detachable basket + 10 L. Rated wattage found on only one retailer listing and is NOT published.
- CED-IZZY-224638 | model link | article 224638 | IZ-8260 | Same as above, matched on 11 L dual basket. Rated wattage found on only one retailer listing and is NOT published.
- CED-IZZY-224915 | dimensions | not in source | 32.4 x 32.4 x 38 cm (single retailer) | Possibly carton, not product; omitted.
- CED-MMO-AG25VB(BK) | source_title | `MIidea` | Midea | Typo corrected silently.
- CED-MMO-AG25VB(BK) | dimensions | not in source | 59.5 x 40 x 38.8 cm (retailer) | Too large for a 25 L microwave and likely the shipping carton; omitted.
- CED-60L07-ST/ST | model | `60L07-ST/ST` | not confirmed | No listing found for this exact code. The nearest hit, MH60L07ET24SB, is a different code and its figures (800 m³/h, class A, 71 dB, 60 cm) were NOT used. Written from the source title alone; long description left empty.
- CED-7NM30T0E | model | `7NM30T0E` | not confirmed | No listing found for this exact code. Nearest hits 7NM30E0 and MBO7NM30D0-BK are different codes and were NOT used. Written from the source title alone; long description left empty.
- CED-MD-OUT-MX3-18RD1-EF-O | model | `MX3-18RD1` | MX3-18RD1-EF | The manufacturer pairs EF-18RD1 (indoor) with MX3-18RD1-EF (outdoor). Published the full outdoor code; the trailing `-O` in the SKU is a vendor suffix and was dropped.
- CED-MD-IN-EF-18RD1 / CED-MD-OUT-MX3-18RD1-EF-O | efficiency figures | not in source | A++ / SEER 7.4 etc. apply to the pair | Both units are sold as single halves; the performance rows are labelled "as a matched pair" so they are not read as figures for one unit.
- CED-MD-IN-EF-18RD1 / CED-MD-OUT-MX3-18RD1-EF-O | Wi-Fi | not in source | listing says no Wi-Fi but also names an app | Contradictory; no connectivity claim published.
- CED-MD-IN-EF-18RD1 / CED-MD-OUT-MX3-18RD1-EF-O | noise | not in source | 58 dB / 65 dB (unclear whether sound power or pressure) | Ambiguous basis; omitted.
- CED-MD-JL2245T-E-IOT | source_title | `Water Dispenser / Purifier Cooler` | no filtration confirmed | The retailer listing explicitly records no UV, RO or UF filtration. The "purifier" claim was not carried into the content.
- CED-MD-JL2245T-E-IOT | colour | `Dark Inox` | listed as silver by one retailer | Kept the source colour, Dark Inox.
- CED-MC-6F6004R242 | colour | not in source | Black | Colour confirmed by a listing for the same model code and added.


## Batch t1-b015 (tier 1)

# Discrepancy notes — t1-b015

- CED-MIH-616AC | model code | `MIH-616AC` (implied by SKU) | `MIH616AC` | Source title gives the code unhyphenated as MIH616AC; published MIH616AC as the manufacturer code and used it in all text. SKU left untouched.
- CED-MD-MF110W70B/W-CYA | source_title | `Midea Washing Machine 7Kg Lunar Slim Line` (no model code) | `MF110W70B/W-CYA` | Source title carries no model code; took the manufacturer part from the SKU (vendor prefix `CED-MD-`) and published it as the manufacturer code and in the titles.
- CED-MFD60S500X-CYP | model code | SKU suffix `-CYP` | `MFD60S500X` | Source title states MFD60S500X. Could not confirm whether `-CYP` is part of the manufacturer code or a market/vendor suffix, so published the title form MFD60S500X only.
- CYR-AM307-868M | product type wording | `Indoor Air Quality Sensor` | `Indoor Ambience Monitoring Sensor (7-in-1 IAQ)` | Milesight's own designation is the AM300-series indoor ambience monitoring sensor. Kept the source wording in the titles (it is accurate and higher-traffic) and used the manufacturer's seven-parameter framing in the body copy.
- CYR-AM307-868M | weight | not in source | 182.5 g (datasheet) vs 181.25 g (product page) | Two Milesight sources disagree; omitted the weight row rather than pick one.
- CYR-AM307-868M | battery life | not in source | 3.9 years at SF7/EU868 (datasheet) vs approx. 3 years (product page) | Two Milesight sources disagree; omitted the battery-life row.
- CYR-EM300-SLD-868M | leak trigger threshold | not in source | 5 mm liquid level (product page) vs soaking length > 2.4 cm across both pins (user guide) | Manufacturer sources disagree; published no numeric trigger threshold.
- CYR-EM300-SLD-868M | ean | `726754602832` | 12 digits (valid UPC-A, not a 13-digit EAN) | Check digit is valid but the code is UPC-A length. Published exactly as supplied, per brief.
- CYR-UG65-868M-EA-H32 | product naming | `LoRaWAN Semi-Industrial Helium Miner` | UG65 semi-industrial LoRaWAN gateway, H32 Helium configuration | The `-H32` Helium variant is not listed in Milesight's current UG65 datasheet or catalogue. Described it as a UG65 gateway supplied in the Helium configuration, and published only UG65-series hardware specifications.
- CYR-UG65-868M-EA-H32 | weight | not in source | 548 g (UG65 datasheet, internal-antenna build) | Omitted the weight row on this external-antenna variant because the datasheet figure is not stated per-build.
- UG65-L04EU-868M-EA | sku | no vendor prefix | identical to `manufacturer_sku` | This SKU is not one of the four prefix-free SKUs named in the brief, but it matches the supplied `manufacturer_sku` exactly, so it is published as the model code.


## Batch t1-b016 (tier 1)

# Discrepancy notes — batch t1-b016 (Morphy Richards)

- MR-100742 | product_title (variant name) | "Signature Opulent Jug Kettle, Copper" | "Signature 1.5L Matt Copper Jug Kettle" | used the manufacturer's variant name; dropped "Opulent", which does not appear in Morphy Richards' own naming for this model
- MR-100742 | weight | not in source | manufacturer page states 590 g | omitted; 590 g is out of line with every comparable 1.5 L kettle in the range (1100–1420 g) and looks like a page error, so no weight row was published
- MR-100743 | product_title (variant name) | "Signature Opulent Kettle, Gold" | could not be confirmed | model is not in the manufacturer's current catalogue and no reliable listing for the exact code was found; source naming kept unchanged and no specifications published beyond source data
- MR-102781 | all specifications | "Stainless Steel Jug Kettle Rapid Boil, 3000 W, 1.7 liters, Cream" | could not be confirmed | model returns no results on the manufacturer site; only the figures stated in the source title were published, nothing added
- MR-102785 | product_title (capacity) | "Equip Jug Kettle, Red" (no capacity) | "Equip 1.7 Jug Kettle - Red", 1.7 L | capacity added from the manufacturer page
- MR-108104 | product_title / specifications | "Prism Kettle, Blue" | could not be confirmed | no Prism range results on the manufacturer site; published from source title alone, long description left empty
- MR-108131 | source_title formatting | "Vector Pyramid Kettle , Black" | "Vector 1.5L Pyramid Kettle - Black" | stray space before the comma removed and manufacturer capacity added
- MR-108134 | source_title formatting | "Vector Pyramid Kettle White" | "Vector 1.5L Pyramid Kettle - White" | missing comma before the colour inserted and manufacturer capacity added
- MR-108271 | product_title (word order) | "Kettle Hive Black" | "Hive 1.5L Black Jug Kettle" | reordered to the manufacturer's naming and identified as a jug kettle
- MR-108273 | product_title (word order) | "Kettle Hive, Grey" | "Hive 1.5L Jug Kettle - Grey" | reordered to the manufacturer's naming and identified as a jug kettle
- MR-245742 | product_title (variant name) | "Signature Toaster 4Slice, Copper" | "Signature Matt Copper 4-Slice Toaster" | used the manufacturer's variant name and finish ("Matt Copper"), corrected "4Slice" spacing
- MR-245742 | wattage | not in source | not stated by the manufacturer | no power row published; the manufacturer's own specification block omits wattage
- MR-245743 | product_title / specifications | "Signature Toaster 4Slice, Gold" | could not be confirmed | model returns no results on the manufacturer site; "4Slice" spacing corrected, but no specifications were borrowed from the copper sibling (245742)
- MR-300251 | product_title (word order) | "Iron Breeze 2600W, Blue" | could not be confirmed | reordered to "Breeze Steam Iron 2600W, Blue" using the supplied product_type; model is not on the manufacturer site, so only the source wattage was published
- MR-300285 | product_title (word order) | "Steam Iron Ceramic, Blue" | could not be confirmed | reordered to "Ceramic Steam Iron, Blue"; model is not on the manufacturer site, so no soleplate, wattage or tank figures were published
- All batch | ean | as supplied | matches manufacturer site for 100133, 100134, 100742, 102785, 108131, 108134, 108271, 108273, 245742 | no EAN discrepancies found; unverified EANs published as supplied


## Batch t1-b017 (tier 1)

# Source-data discrepancies — batch t1-b017

- MR-300301 | product_title | "Iron crystal 2400W" | "Crystal Clear 2400W Steam Iron" | source used a garbled/reordered model name; corrected silently to the manufacturer's official product name
- MR-300401 | product_title | "LightGlide" | "Light Glide" | manufacturer styles the range as two words; corrected silently
- MR-300401 | colour | "Blue/white" | "Blue" | manufacturer lists the variant as Blue only; published the manufacturer's colour name
- MR-300401 | wattage | not stated in source | 2200W | manufacturer confirms 2200W; added to title and specification table
- MR-403060 | product_title | "Compact Blender" | "Compact Sports Blender" | source used a shortened name; corrected silently to the manufacturer's official variant name
- AMZ-DE-B01ITG2JEQ | product_title | "Citiz" | "CitiZ" | corrected casing to the manufacturer's styling
- AMZ-DE-B01ITG2JEQ | manufacturer_sku | "AMZ-DE-B01ITG2JEQ" | "EN167.B" | the manufacturer_sku field holds a marketplace listing ID, not a manufacturer code; used EN167.B (from the source title) as the model code in text and specifications
- AMZ-DE-B01ITG2JEQ | ean | null | none found | no EAN supplied and none confirmed; EAN row omitted from the specification table
- 3N-LC-77 | brand | "Nivea" | "Nikon" | brand field is wrong (a cosmetics brand on a camera lens cap); the source title and model code LC-77 are Nikon, so Nikon was used throughout
- IT68853 | ean | null | none found | no EAN supplied and none confirmed; EAN row omitted from the specification table
- IT73902 | source_title | "Nutribullet  NBP013W" (double space) | single space | spacing tidied
- IT65827 | product_title | "Magicbullet" | "Magic Bullet" | manufacturer styles the range as two words; corrected silently

## Could not confirm (fields left empty rather than guessed)

- 3V-JU370810 (Moulinex Frutelia Plus) — the Moulinex site is a JavaScript app that returns no server-rendered product data, and general web search was unavailable. No specification confirmed beyond the source title. long_description and key_features left empty.
- AMZ-DE-B01ITG2JEQ (Nespresso CitiZ EN167.B) — CitiZ range specifications found on nespresso.com could not be tied to the EN167.B model code specifically (the UK listings use different De'Longhi/Krups codes), so no wattage, pressure, tank capacity or dimensions were published. long_description left empty.
- IT73902 (Nutribullet NBP013W Flex To Go) and IT65827 (Nutribullet MBR06B Magic Bullet) — the UK Nutribullet site's equivalent products carry different SKUs and barcodes (02924ALT / 5061059292599 and 02643 / 5060784679989), so they are not confirmed to be the same models. No specifications published; long_description and key_features left empty.
- IT68853 (Ninja TB401EU) — manufacturer page lists two conflicting weights (6.3 kg and 9.42 kg); weight omitted. Cord length listed only as 80.01 cm and omitted as likely a converted value.
- MR-300301 — manufacturer product dimensions are printed without a unit ("15.2 x 16.6 x 31.4"); published as cm, which is the only magnitude consistent with the product and with the units used on sibling models.


## Batch t1-b018 (tier 1)

# Source-data discrepancies — batch t1-b018

- NBP013OR | product_title | "Flex Port Blender" | "Flex To Go Blender" | "Flex Port" is a truncated name; normalised to the range name used elsewhere in the catalogue for the same NBP013 model family (NBP013BL, NBP013GM, NBP013W)
- IT74505 | product_title | "Flex Port Blender" | "Flex To Go Blender" | same truncation as NBP013OR; normalised to the catalogue's range name for NBP013
- IT70079 | source_title | "Nutribullet To Go Blender, Light Blue" (no model code) | NBP003LBL | source title omits the model code held in manufacturer_sku; NBP003LBL added to the title, eBay title and specification table
- IT69283 | source_title | "NBP003NBL To Go Blender,  Navy Blue" (double space) | single space | spacing tidied
- MT-SPK7507B/00 | product_title | "Philips 5000 Series SPK7507B Ergonomic Mouse, Black" | Philips "5000 series Wireless mouse SPK7507B/00" | source omits that the mouse is wireless and drops the /00 suffix; corrected to the manufacturer's product name while keeping "ergonomic", which Philips also states for this model
- OT-FS-20RC | manufacturer_sku | "OT-FS-20RC" (identical to the sku) | none published | the manufacturer_sku field duplicates the prefixed sku, and OT-FS-20RC is not one of the four unprefixed catalogue SKUs, so no model code was published for this item; the Manufacturer code row is omitted from the specification table
- OT-FS-20RC | ean | null | none found | no EAN supplied and none confirmed; EAN row omitted
- 4P-KX-T7603X-B | ean | null | none found | no EAN supplied and none confirmed; EAN row omitted
- 4P-KX-T7603X-B | category | "Computing, Office & Stationery > Computer Peripherals & Accessories > Webcams & Conferencing" | telephone-system accessory | the category is wrong for a DSS console; category is not an output field so it was left unchanged, but the content is written as a telephone console, not a conferencing device
- MT-SPK7507B/00 | ean | null | none found | no EAN supplied and none confirmed; EAN row omitted

## Could not confirm (fields left empty rather than guessed)

- All eleven Nutribullet items (NB1206DG, NB606DG, NB907MAJD, NB907MASN, NBF500DG, NBP003NBL,
  NBP003LBL, NBP013BL, NBP013GM, NBP013OR, NBP013VT) — none of these EU model codes appears on
  nutribullet.com or nutribullet.co.uk. The UK site's comparable products carry entirely different
  article numbers and barcodes (e.g. 02675 / 5061059290250, 02924ALT / 5061059292599) against the
  8006447… EANs supplied here, so they are not confirmed to be the same models. No wattage, RPM,
  cup capacity, dimensions or weight published; long_description and key_features left empty and
  the specification tables carry only source facts.
- OT-FS-20RC (OTTO 20 inch pedestal fan) — no manufacturer site found for this brand/model.
  Nothing published beyond the source title. Blade diameter is stated as "20 inch" only because
  the source says so; it is not attributed to a specific measurement point.
- 4P-KX-T7603X-B (Panasonic KX-T7603X-B DSS console) — a discontinued business-telephony product;
  panasonic.com and the Panasonic Connect EU site no longer list it. Compatibility with specific
  Panasonic telephone or PBX ranges could not be confirmed and is not stated.
- 3G-RP-HJE201E-K-FOC (Panasonic RP-HJE201E-K earphones) — no live Panasonic product page found
  for this model code. Driver size, impedance, sensitivity, frequency response, cord length and
  plug type were all left out.
- MT-SPK7507B/00 (Philips) — the Philips product page confirms 2.4 GHz wireless, adjustable up to
  3200 DPI, high-definition optical tracking, ergonomic shape, silent operation, intelligent power
  saving and a two-year warranty. The technical-specifications table did not render, so dimensions,
  weight, button count, battery type, wireless range and box contents are not published.

## Research constraint affecting this batch

General web search was unavailable for this run (session search budget exhausted) and non-manufacturer
domains were blocked by the egress policy, so research was limited to direct lookups on manufacturer
sites (nutribullet.com, nutribullet.co.uk, philips.co.uk, panasonic.com). Where that produced no
model-code match, fields were left empty rather than filled from a plausible default.


## Batch t1-b019 (tier 1)

- SCF358/00-PT | manufacturer_sku | SCF358/00-PT | SCF358/00 | The trailing "-PT" is not part of the Philips model code; published SCF358/00 as the manufacturer code in text and in the table.
- SCF358/00-PT | source_title | "Fast Bottle Warmer" | "Premium Fast bottle warmer" | Philips lists this model under the official variant name "Premium Fast bottle warmer"; used the official name.
- 92-BG3485/15 | source_title | "Bodygroom Series 3000 Triple Protect Shave" | "Body Groomer With Triple Protect shaving system" | Philips lists BG3485/15 under this name; used "Triple Protect shaving system" in content. Kept the Series 3000 range from source data (not restated on the manufacturer page, so it is not carried as a confirmed research fact).
- 92-BG5021/15 | source_title model code | BG501/15 | BG5021/15 | Source model code is a typo; BG501/15 does not exist. Corrected to BG5021/15 (matches manufacturer_sku) throughout the content.
- 92-BG5021/15 | source_title | "Body Shaver" | "Bodygroom Series 5000 Showerproof groin and body trimmer" | Used the manufacturer's official product name.
- 92-BG5021/15 | source_title runtime | "60M" | 61 minutes | Manufacturer states 61 minutes cordless use; published 61 minutes.
- 92-BHS520/00-BF | manufacturer_sku | BHS520/00-BF | BHS520/00 | The trailing "-BF" is not part of the Philips model code; published BHS520/00.
- 92-BHS677/00 | source_title | "StraightCare Subline Ends" | "StraightCare Sublime Ends" | "Subline" is a source typo; corrected to the official name "StraightCare Sublime Ends straightener".
- 92-CX5535/11 | source_title product type | "Ceramic Tower Heater" | "5000 series Tower Fan" | CX5535/11 is a tower fan, not a heater. Rewrote all content as a tower fan; the supplied category (Heaters) is not published.
- 92-CX5535/11 | source_title power | "2100W" | 40 W maximum power | The 2100 W figure belongs to a heater, not this product. Published the manufacturer's 40 W and dropped the 2100 W claim.
- 92-CX5535/11 | source_title feature | "App Contro[l]" | Remote control | No app or Wi-Fi control is listed for this model; it ships with a physical remote. App control claim dropped, remote control published.
- 92-QC5115/15 | source_title model code | QC5115 | QC5115/15 | Used the full model code from manufacturer_sku.
- 92-QC5115/15 | source_title | "Hair Clipper" | "Washable hair clipper" | Manufacturer lists this model as a washable hair clipper; added the washable fact, kept the multi-voltage fact from source. No further specification could be confirmed.
- 92-MG7940/15 | source_title | "Series 7000 All-in-One Hair Trimmer" | "All-in-One Trimmer Series 7000" | Used the manufacturer's official product name.
- 92-PSG3000/20 | product dimensions | Manufacturer page states "355 (L) x 192 (W) x 275 (H) cm" | 355 x 192 x 275 mm | The unit on the manufacturer page is wrong (that size in cm is impossible for a steam generator). Published in mm.
- 92-HC3525/15 | availability | not stated in source | Listed as discontinued by the manufacturer | No content change; flagged for buying/stock purposes.
- PH-BT7240 | manufacturer_sku | null | BT7240 (derived from the SKU, vendor prefix "PH-" removed) | Published BT7240 as the model code. The full variant code (e.g. /xx suffix) could not be confirmed and no specification for this model could be verified, so long_description and key_features are empty.
- PH-S5588 | manufacturer_sku | null | S5588 (derived from the SKU, vendor prefix "PH-" removed) | Published S5588 as the model code. Philips lists an S5588/30 Shaver series 5000, but the exact variant behind this SKU is unconfirmed, so no specification beyond brand, range and type was published.
- PH-BT7240, PH-S5588 | ean | null | not available | No EAN supplied and none confirmed; the EAN row is omitted from both specification tables.


## Batch t1-b020 (tier 1)

- 92-SCF358/00-PT | manufacturer_sku | SCF358/00-PT | SCF358/00 | trailing "-PT" is not part of the Philips model code; published SCF358/00 as the manufacturer code
- 92-SCF358/00-PT | source_title | "Fast Bottle Warmer" | "Premium Fast bottle warmer" | manufacturer's own product page names the SCF358/00 as the Premium Fast bottle warmer; used that variant name in the titles
- 4B-SE-CL502-G | source_title brand | "Pioneed" | "Pioneer" | corrected the brand spelling silently in all output text
- 4B-MVH-S120UBG | source_title | "Andoid" | "Android" | corrected the typo; Android compatibility confirmed by the manufacturer page
- 4B-MVH-S120UB | source_title colour | "Black" | manufacturer describes the unit as "1-DIN receiver with red illumination" | kept Black as the chassis colour and listed illumination colour (Red) as a separate specification row so the two are not confused
- 3G-CD-R310 | manufacturer_sku | "R310" | "CD-R310" | the SKU prefix is the vendor code 3G-, so the manufacturer part is CD-R310; confirmed as a Pioneer remote control and published as CD-R310
- 3G-CD-R310 | ean | null | no EAN found | EAN row omitted from the specification table
- 4B-SE-CH5T-S | source_title model form | "SE-CH5T(S)" | "SE-CH5T-S" | used the manufacturer_sku form consistently in titles and specifications
- 4B-SE-C4BT-GR | source_title | "Put In Ear Headphone" | "In-Ear Headphones" | tidied garbled product-type wording; no wireless/Bluetooth claim made because it could not be confirmed
- 4B-GM-D8704 | research finding | manufacturer continuous-power string also lists "125 W x 4 (1 ohm)" | omitted | the 1-ohm figure is lower than the stated 2-ohm figure and is internally inconsistent, so it was not published; 4-ohm, 2-ohm and bridged figures published


## Batch t1-b021 (tier 1)

# Discrepancy notes — batch t1-b021 (Pioneer earphones, 15 SKUs)

- 4B-SE-CH3T-B | source_title | "Pioneer SE-CH3T-B In Ear Headphone BL" | Colour is Black; product is a pair of in-ear headphones | Expanded the abbreviated colour code "BL" to "Black" and pluralised "Headphone" to "Headphones"; colour Black confirmed against model code SE-CH3T-B.
- 4B-SE-CH3T-R | source_title | "In Ear headphones" (inconsistent casing) | "In-Ear Headphones" | Corrected casing and hyphenation silently; no factual change.
- 4B-SE-CH3T-B, 4B-SE-CH3T-P | source_title | "In Ear" (unhyphenated) | "In-Ear" | Normalised to the hyphenated form used across the rest of the batch.
- 4B-SE-CL502T-P | ean | null (missing in source) | Not found in research | Left the EAN row out of the specification table entirely rather than borrowing the EAN of another colour variant.
- 4B-SE-CL502-K | product type (third-party data) | Source says SE-CL502-K | One barcode database entry titles this EAN "SE-CL502T-K" while giving MPN SE-CL502-K | Treated the third-party title as an error, kept SE-CL502-K (non-microphone variant) and published no microphone row for this SKU.
- 4B-SE-CL712T-L, -P, -R, -W | source_title | "Deep Bass Earphones" (no mention of a microphone) | Research confirms an in-line microphone/remote on the SE-CL712T | Kept the deep-bass description from the source and added the confirmed in-line microphone.
- 4B-SE-CL502-K, 4B-SE-CL501-G, 4B-SE-CL712T-P, 4B-SE-CL712T-R, 4B-SE-CL712T-W | specifications | (no spec data on the source record) | Electrical specifications confirmed on a sibling colour variant of the same model (SE-CL502-R, SE-CL501-W, SE-CL712T-L) | Applied model-level electrical specs across colour variants of the same model code only; nothing was carried between different model codes.
- 4B-SE-CH5T-R | specifications | (no spec data on the source record) | Driver 9.7 mm, sensitivity 108 dB, 3.5 mm four-pole plug, no active noise cancelling | Published; these figures rest on a single product-database record for MPN SE-CH5T-R, so impedance, frequency response, cable length and weight were left out rather than inferred.
- 4B-SE-CL501-G, 4B-SE-CL501-W, 4B-SE-CL502-K, 4B-SE-CL502-R, 4B-SE-CL502T-L, 4B-SE-CL502T-P | long_description | n/a | n/a | Returned empty: research yielded only figures that already appear in the specification table, so there was not enough to support two honest prose sections.
- All SKUs | long_description "What's in the box" | n/a | n/a | Section omitted throughout: no research confirmed accessory or ear-tip contents for any of these models.


## Batch t1-b022 (tier 1)

# Discrepancy notes — batch t1-b022

- 4B-SE-CL502-M | brand / source_title | "Pionerr" | "Pioneer" | corrected the brand spelling in all output text
- 4B-SE-E5T-H | source_title | "In Ear Headphone Grey" | SE-E5T is described as an in-ear clip sport headphone in the SE-E5T-R row of the same source file | harmonised the product descriptor across both SE-E5T colourways; no external spec was used
- 4B-TS-D69F | source_title | "Pioneer Speakers 6\"x9\" 2-Way Coaxial 330W" — no model code | TS-D69F | added the manufacturer model code from manufacturer_sku to the titles
- 4B-TS-A6991F | source_title | 6"x99" | 6" x 9" | corrected an obvious size typo; the manufacturer lists the diameter size as 6 x 9 inch
- 4B-TS-A6991F | source_title | "Pioneer Speakers ... 5-Way Coaxial 700W" — no model code | TS-A6991F | added the manufacturer model code from manufacturer_sku to the titles
- 47-PC8338B | brand | "Power Connections" | "PowerConnections" | corrected to the manufacturer's own styling
- 47-PC8338B | source_title | "5A" | manufacturer rates PC8338 at 8 A / 250 V / 2000 W maximum load, with a BS1362 fuse available in 3 A, 5 A or 10 A | removed the ambiguous "5A" from the titles because it conflicts with the manufacturer's current rating; published the 8 A rating and listed the fuse options instead
- 47-PC8338B | ean | null | no EAN found in research | left empty and omitted the EAN row from the specification table
- RE-D5901 | brand / source_title | "Remignton" | "Remington" | corrected the brand spelling in all output text
- RE-D5901 | source_title | "Coconut Smooth Hair Dryer" | manufacturer lists it as the Coconut Smooth hair dryer, 2200 W | kept the source name and added the confirmed wattage
- RE-PG760 | brand / source_title | "Remignton" | "Remington" | corrected the brand spelling in all output text
- RE-PG760 | source_title | "One Head & Body Multigroomer" | "Remington ONE Head & Body Multi-Groomer" | used the manufacturer's official variant name and spacing
- RE-AC5999 | source_title | "Hair Dryer Pro-Air AC" | "Pro-Air AC hair dryer" | reordered to the manufacturer's product name; added the confirmed 2300 W and black finish

## Could not confirm (fields left empty)

- Pioneer SE-CL722T-L, SE-E5T-H, SE-E5T-R, SE-E7BT-R, SE-E7BT-Y, SE-QL2T-G, SE-CL502-M: Pioneer's European and Japanese sites no longer carry the SE- headphone range (pioneer.eu and pioneer.co.uk both redirect to the car-audio site only), so no driver size, impedance, frequency response, sensitivity, cable length, battery life, Bluetooth version or IP rating could be verified. These seven listings are written from the source titles alone, with empty long_description.
- Polaroid POLC3HM: no manufacturer page found (the CUBE accessory range is discontinued and polaroid.com returns 404 for this code). No dimensions, materials or mount-interface detail published; long_description left empty.
- Remington AC5999: the manufacturer's page carries only the product name, black finish, ionic conditioning and a 2300 W figure in the page title. Motor type, heat and speed settings, cool shot, attachments, cord length and weight could not be confirmed and are omitted.
- Remington PG760: run time and battery type are not published by the manufacturer and are omitted.
- Pioneer TS-D69F / TS-A6991F / TS-G1720F: published weights are given without stating whether they are per speaker or per pair; the row is labelled simply "Weight".


## Batch t1-b023 (tier 1)

# Discrepancy notes — t1-b023

- RE-CI5538 | source_title model code | CI5338 | CI5538 | source title model code disagrees with both `sku` and `manufacturer_sku`; treated as a source typo and CI5538 used throughout the content
- RE-AS5901 | source_title / product name | "Airstyler Coconut infused Smooth Ceramic Barrels" | "Coconut Smooth Hot Air Styler" | source uses a descriptive, non-official name; replaced with the manufacturer's official product name
- RE-AS7500 | source_title | "Blow Dry&Style 1000w" | "Blow Dry and Style Caring 1000W Airstyler" | fixed missing spacing and wattage casing; published as "Blow Dry & Style 1000 W Hot Air Styler"
- RE-CI91AW | source_title / product name | "PROluxe 4-in 1 Hair Waver" | "PROluxe 4-in-1 Adjustable Waver" | hyphenation fixed and the manufacturer's official variant name ("Adjustable") restored
- RE-MB3000 | source_title | "Battery Opperated" | "Battery operated" | spelling corrected
- RE-MB3000 | source_title | "Mens" | "Men's" | apostrophe added
- RE-BHT6256 | source_title | "Wetech" | "WETech" | manufacturer's range casing applied
- RE-BB1000 and RE-BHT6256 | ean | both 4008496870851 | — | the same EAN is supplied for two different products (Reveal body brush and WETech body trimmer); at least one must be wrong, but per brief the supplied EAN was published unchanged on both. Recommend the merchandising team re-check both barcodes
- RE-D3190 | manufacturer_sku | null | D3190 | model code taken from the source title for the `Manufacturer code` row; no EAN row published as none was supplied
- RE-AS8810 | model availability | AS8810 | AS8811 is the current catalogue model | the manufacturer lists only AS8811 "Keratin Protect Rotating Air Styler"; a different suffix is a different product, so no AS8811 specification was borrowed and AS8810 was written from the source title alone

## Research coverage

Confirmed against the manufacturer's own UK specification pages (uk.remington-europe.com):
AC8901, AS5901, AS7500, CI91AW. These four carry full specification tables and long descriptions.

Not confirmable: AC8820, AS8810, MB3000, BB1000, BHT250, BHT6256, CI1019, CI5318, CI5538, CI5519,
D3190. All eleven are absent from the product sitemaps of the UK, German and pan-European
Remington storefronts (discontinued lines), and the manufacturer's own site search and manuals
index are not machine-readable. No headline specification (wattage, temperature, runtime,
dimensions) was published for these; their content is written from the supplied source data only,
with `long_description` returned empty as the brief directs.

- AC8901 | dimensions | manufacturer site lists "Height 30.1mm" | implausible for a hair dryer | no dimension row published
- AS5901 | dimensions | manufacturer site lists "Height 15.6mm" | implausible for a hot air styler | no dimension row published


## Batch t1-b024 (tier 1)

# Source-data discrepancies — batch t1-b024

- RE-D5215 | source_title | "Pro‑Air Shine ... Cool‑Shot" (non-breaking hyphens U+2011) | "Pro-Air Shine ... Cool Shot" | normalised to standard hyphens; 2300 W, ionic and cool shot all confirmed against the manufacturer listing for D5215
- RE-D5215 | colour | not stated in source | manufacturer lists Black; one retailer lists Silver | conflicting, so no colour row published
- RE-D5706 | source_title | "Curl&Sraight Confidence Dryer" | "Curl & Straight Confidence Hair Dryer" | corrected the misspelling of "Straight" and the missing spacing around the ampersand, and used the manufacturer's full product name
- RE-D5706 | colour | not stated in source | retailers give Black, Grey, Grey/Rose Gold and Pink for the same code | conflicting, so no colour row published
- RE-EP7035 | source_title | "Cordless Epilator 7-in-1" | "Smooth & Silky 7-in-1 Cordless Epilator" | added the manufacturer's official range name (Smooth & Silky); attachment list taken from the EP7035 instruction manual
- RE-EP7300 | source_title | "3-in-1 Smooth Silky Epilator" | "Smooth & Silky 3-in-1 Epilator" | corrected the range name to the official "Smooth & Silky"
- RE-EP7300 | product_type | source implies a lady shaver in the category path | EP7300 is a corded epilator with no shaver head | described as an epilator only; no shaver-head claim made
- RE-F2002 | source_title | "Foil Sshaver" | "Foil Shaver" | corrected typo; also used the manufacturer's "F2 Style Series" range name
- RE-PG2000 | source_title | "Graphite G2 Multi-Grooming Kit" | "G2 Graphite Series Multi Grooming Kit" | kept every source fact, reordered to the manufacturer's official range naming
- RE-PG4000 | source_title | "Graphite G4 Cordless Trimmer, All-in-One ..." | "G4 Graphite Series Multi Grooming Kit" | used the manufacturer's range name; the source's "mini electric shaver attachment" is confirmed as the mini foil shaver head
- RE-MB070 | source_title | "Beard Cutter Durablade Pro Shave" | "Durablade Pro" | "Beard Cutter ... Pro Shave" is a translated/expanded form; the manufacturer's product name is Durablade Pro
- RE-MB070 | product_type | source category is "Electric Shaver" | manufacturer classes it as a hybrid trimmer/shaver | described as a trimmer and shaver; category not altered
- RE-MB070 | charge time / comb count | not in source | one retailer states 260 min charge and 4 combs; not corroborated elsewhere | not published
- RE-HC5150 | comb/length data | not in source | one manual-aggregator page states 9 combs at 1.5-25 mm; the manufacturer page and two retailers state 2 adjustable combs with 15 lock-in settings, 1-42 mm | published the manufacturer-corroborated figure only; the 9-comb figure appears to belong to a different model and was discarded
- RE-HC5200 | charge time | not in source | manufacturer manual says "16-20 hours", retailer data says 16 hours | published 16 hours, the figure given on the manufacturer's own specification data
- RE-HC5020 | power type | not stated in source | corded mains only (confirmed in the manufacturer manual) | stated explicitly, as the model sits in a range that also contains cordless clippers
- RE-HC5038 | colour | not stated in source | manufacturer describes "club colours" with the club crest; retailers list Red | described as Manchester United club colours; no specific colour row published
- ALL Remington models | "Height" specification on the manufacturer's own product pages (e.g. 28.1 mm for a hair dryer, 23.5 mm for a grooming kit) | evidently a data-feed error, not a product dimension | no dimension or weight rows published for any item in this batch


## Batch t1-b025 (tier 1)

# Discrepancy notes — t1-b025 (Remington, 15 SKUs)

- RE-MB4120 | length settings | source silent; Superdrug lists "9 adjustable settings, 1.5–18mm" | Remington platform spec is 11 settings — 9 comb lengths 1.5–18mm plus 0.4mm and 1mm with the comb removed | published 11 total settings with the 9-step comb range shown separately; both figures reconciled rather than picking one
- RE-MB4120 | run time | one retailer states "up to 40 minutes per charge" | MB4120 is a 2 x AAA battery unit, not rechargeable, so the figure is boilerplate carried over from a rechargeable sibling | omitted run time entirely
- RE-MB4122 | source_title | "Beard Boss Beard & Nose Trimmer Limited Edition Gift Set" | manufacturer name is "Beard Boss Beard Trimmer Limited Edition Gift Set"; the second unit in the set is a nose AND ear trimmer | kept the set description but named the second unit correctly as a nose and ear trimmer
- RE-MB4122 | length settings | retailers give 9 steps (1–19mm), 9 steps (1–18mm) and 11 settings | could not reconcile against a manufacturer page | omitted the setting count and range from the listing
- RE-MB4128 | power source | Amazon DE and FR listings state "battery operated" | Remington's own MB4128 manual references a charging indicator, a mains adaptor and a 14–16 hour charge — the unit is rechargeable | published as rechargeable with 14–16 hour charge time
- RE-MB4128 | guarantee | retailers split between "3 year" and "2 year + 1 on registration" | unresolved | omitted the guarantee row
- RE-MB5000 | source_title | model code "MB5000" appears twice in the title | single occurrence | de-duplicated silently in product_title
- RE-MB7000 | source_title | "T-Series Ultimate Cordless Trimmer" (also a double space after "T-Series") | manufacturer name is "T-Series Ultimate Precision Trimmer" | used the official name and fixed the spacing
- RE-NE3150 | category / product_type | "Hair Clippers" / "Hair Clipper" | product is a nose and ear hair trimmer | content describes it as a nose and ear trimmer; supplied category fields left untouched
- RE-NE3870 | source_title | "Nose & Detail Trimmer" | manufacturer name is "Nano Series Nose and Detail Trimmer"; the unit also does ear hair | added the official series name and included ear in the description
- RE-PG180 | source_title | "Personal Groomer" | manufacturer name is "Pilot Personal Groomer Kit" | added the official "Pilot" range name
- RE-PG5000 | source_title | "Graphite Series G5 Rechargeable Grooming Set" | manufacturer name is "G5 Graphite Series Multi Grooming Kit" | used the official range name and product type
- RE-PG5000 | attachment count | Remington's UK page says nine attachments but itemises eight; an AU-variant retailer listing says ten | count unresolved | omitted any attachment count; listed the individual attachments instead
- RE-PG6030 | source_title | "Personal Groomer All-In-One Kit" | manufacturer name is "Edge Personal Grooming Kit" | added the official "Edge" range name
- RE-PG6030 | run time / charge time | not stated on the manufacturer page and not found in the manual | unresolved | both rows omitted
- RE-PG6130 | source_title | "Personal Groomer All-In-One Kit" | manufacturer names it "Groom Kit" (UK page heading "Multi Groom Personal Groomer") | used "Groom Kit"
- RE-PG6130 | charge time | one retailer states a 16-hour charge | not corroborated by the manufacturer | omitted
- RE-PG780 | comb specification | manufacturer page says "7 combs from 1.5mm to 15mm"; Currys itemises nine fixed barber combs 1.5–25mm plus eyebrow and body combs | the 14-comb total and 18 cutting positions agree across both | published only the totals, no comb range
- RE-PG780 | guarantee | manufacturer page shows a 1-year extended-warranty promotion; Currys states 3 years | unresolved | omitted the guarantee row
- RE-PR1350 | ean | supplied 4008496877058 | UK/EU retailers list 4008496877072 against the black PowerSeries Aqua Plus PR1350 | supplied EAN published unchanged, per brief; flagged here for the buyer to verify the colour variant
- RE-S3580 | source_title | "Ceramic Crimp for Hair" | manufacturer name is "Ceramic Crimp 220" | used the official name
- RE-S3580 | category / product_type | "Hair Straighteners" / "Hair Straightener" | product is a hair crimper, not a straightener | content describes it as a crimper; supplied category fields left untouched
- RE-S3580 | cord length / plate coating | one retailer states a 1.8m cord and a tourmaline ceramic coating | manufacturer documentation states only "ceramic crimping plates" and a swivel cord | published ceramic plates and swivel cord only, no cord length, no tourmaline claim


## Batch t1-b026 (tier 1)

- RE-S3700 | source_title | "Remington S3700 Straightening iron Black S3700, Straightening iron, All hair, 150 °C, 230 °C, Black, 60 min" | Remington Ceramic Glide 230, S3700 | Source title is a machine-concatenated attribute string with the model and "Straightening iron" repeated and no product-line name. Used the manufacturer's range name "Ceramic Glide 230" and kept all source facts (all hair types, 150-230 °C, black, 60 min shut-off).
- RE-S6308 | source_title | "Remington S6308 Lisseur Eclat Brillance" | Remington Éclat Brillance straightener, S6308 | French-language source title with the accent dropped. Restored the accented official range name "Éclat Brillance" and used the English product type in the listing copy.
- RE-S8540 | specifications (heat settings) | not in source; retailer listings state "10 heat settings" | manufacturer instruction manual states 9 variable settings, 150-230 °C | Retailer and manufacturer counts disagree, so no setting count was published; only the confirmed 150-230 °C range and the marked PRO+ 185 °C setting are shown.
- RE-S8550 | specifications (temperature) | not in source; one retailer states "9 heat settings (150-230 °C)" | manufacturer states 10 settings, 150-235 °C | Published the manufacturer figures (150-235 °C, 10 settings), confirmed on both the Remington UK page and a second listing.
- RE-S7350 | specifications (plate infusion) | not in source; some retailer listings describe "argan oil and vitamin E" | manufacturer copy states Advanced Ceramic plates with frizz-resistant micro conditioners | Published "micro conditioners" only; argan oil / vitamin E belongs to the S8550 Shine Therapy line and was not confirmed for S7350.
- RE-S5525 | specifications (guarantee) | not in source; retailers state variously 2+1 years and 3+1 years | not resolved | Conflicting retailer figures, so no guarantee row was published.
- RE-S8670 | product_title | "Remington S8670 Multistyle Interchangeable Styler, Black" | Remington's own EU product page spells it "Multistyle Interchangable Styler" | Kept the correctly spelled "Interchangeable" from the source; the manufacturer page carries a typo.
- RE-WSF5060 | source_title | "Remington WSF5060 Wet and Dry Women's Bikini Shaver" | Remington Smooth & Silky wet and dry lady shaver supplied with a bikini trimmer comb guard | The product is a foil lady shaver with a bikini trimmer attachment, not a dedicated bikini shaver. Retitled accordingly and kept the wet-and-dry fact.


## Batch t1-b027 (tier 1)

# Discrepancy notes — batch t1-b027

- AMZ-DE-B0DYTVVLH4 | brand | Revodok | UGREEN | Revodok Pro is UGREEN's docking-station line, not a brand. Published brand as UGREEN, with "Revodok Pro 314" as the range/model in the title and spec table.
- AMZ-DE-B0DYTVVLH4 | manufacturer_sku | null (empty in source) | CM843 | Model code taken from the manufacturer's user manual for this listing and published as "Manufacturer code" in the spec table. The supplied sku is an Amazon ASIN and was not published in any text.
- AMZ-DE-B0DYTVVLH4 | weight | not in source | 3.41 lb quoted by the retailer listing | Not published — figure looks like packed/shipping weight for a dock of these dimensions, so omitted.
- HADJ-DG8622 | cord length | not in source | 1.98 m (retailer datasheets; one aggregator rounds to 2 m) | Published 1.98 m, the more precise of the two figures.
- HADJ-SF411L | source_title | "Rowenta SF411L Extra Liss Keratin & Tourmaline Coated" | "Rowenta x Karl Lagerfeld Extra Liss SF411L" | Restored the manufacturer's official variant name (Rowenta x Karl Lagerfeld collaboration) in the product title and spec table.
- HADJ-SF411L | plate size | not in source | conflicting: one retailer gives 45 x 90 mm plates, another gives 296 x 31 x 34.5 mm (whole appliance) | No plate-size row published.
- HADJ-SF411L | plate coating | "Keratin & Tourmaline" | one retailer describes the plates as "ceramic tourmaline" | Kept the source's keratin and tourmaline wording, which matches the manufacturer's own listings; ceramic not published.
- HADJ-TN5224 | source_title | "Advance Trimmer" | "Advancer" | Corrected the range name to Rowenta's official "Advancer" in the title and spec table.
- HADJ-TN5224 | charge time | not in source | 90 minutes claimed by a single retailer | Not published — one unverified source only.
- RH-22760 | housing material | not in source | manufacturer: brushed stainless steel with black accents; one retailer states plastic housing | Published the manufacturer's description.
- RH-22760 | capacity / dimensions | not in source | 1 L jug and 17 x 17 x 27.5 cm quoted by single retailers only | Not published.
- RH-23120 | source_title | "Coffee Grinder" | "Classics Coffee Grinder" | Added the official Classics range name, confirmed across several listings.
- RH-23120 | grind settings | not in source | conflicting: "33 positions" on one datasheet, "12 grind levels" at another retailer | Published only "Adjustable, fine to coarse"; no count.
- RH-23120 | dimensions and weight | not in source | 185 x 130 x 285 mm, 1620 g on one datasheet | Not published — could not confirm these are product rather than carton figures.
- RH-23180 | source_title | "Nutriboost" | "Nutri Boost" | Corrected to the manufacturer's spelling.
- RH-23180 | large cup capacity | not in source | 0.75 L on the manufacturer spec table, 0.7 L in the manufacturer's own accessory list | Published 0.75 L, the figure in the structured specification.
- RH-23912 | power | not in source | conflicting: 2400 W on the brand's own marketplace listing and two other retailers, 2000 W at one distributor | Published 2400 W. EAN 4008496970865 confirms the 23912-70 brushed stainless variant.
- RH-24371 | slot width | not in source | conflicting: retailer listings say "extra wide slots", Russell Hobbs UK specification says standard slots | No slot-width row published.
- RH-25630 | dishwasher safe | not in source | conflicting: Russell Hobbs UK says no dishwasher-safe parts, two retailer listings say the inner pot is dishwasher safe | Not published.
- RH-26470 | colour | not in source | conflicting: Russell Hobbs UK lists 26470 as Mint and White, other retailers list the same code as Blue/Aqua | No colour row published.
- RH-26470 | water tank | not in source | 0.24 L quoted by a single retailer | Not published.
- RH-27030 | capacity | "Medium" | conflicting: 1.2 kg at one listing, 1.2 L at another, 145 g vs 200 g per serving across two listings | Published "Serves up to 6" only; no litre/kg capacity row.
- RH-28080 | power and capacity | not in source | 3000 W / 1.7 L confirmed by several retailer listings; the Russell Hobbs UK page does not state either | Published, as multiple independent listings agree.


## Batch t1-b028 (tier 1)

# Discrepancy notes — t1-b028

- IT59921 | colour | Silver | Brushed Stainless Steel | Sage's own colour name for the BSS variant; used "Brushed stainless steel" in the title and spec table.
- IT72712 | source_title | "Barista Express Semi-Automatic Espresso Machine" (no variant name, no colour) | "the Barista Express Impress", Black Truffle | Model code SES876BTR4GUK1 is the Impress in Black Truffle; added the official variant name and colour to the title and specs.
- IT49699 | colour | Silver | Brushed Stainless Steel | Sage's official finish name for BCG820BSSUK; corrected in title and specs.
- IT69612 | source_title model | SES985 | SES985BSS4GUK1 | Source title carries the short series code; used the full supplied manufacturer code in the title and spec table.
- IT72372 | manufacturer_sku | null | SM-X135 (UK grey 64GB LTE variant SM-X135FZAAEUB) | No manufacturer code supplied; published SM-X135 from the source title, confirmed against Samsung UK. Full regional suffix not published as the source does not specify region.
- IT72372 | colour | Gray | Grey | Used Samsung UK's spelling.
- PAN-SHRBPRO | source_title | "Acoustic Pickup Double bass" | "Rockabilly Pro" dual pickup and preamp system for upright bass | Product is an active dual-pickup plus preamp system with tuner, not a bare acoustic pickup; corrected the description and added the official range name.
- PAN-SPM435TR | manufacturer_sku | SPM435TR | Stagg presents it as SPM-435 TR | Used the hyphenated manufacturer form in titles, kept the supplied unhyphenated code in the spec table.
- PAN-SPM435TR | source_title | "Translucent" | Transparent | Stagg's own colour name is Transparent; corrected.
- IT70610 | source_title | "AR4080 Rice Cooker" | AR4080 Basmati | Ufesa's official range name is Basmati (several retailer feeds carry a "BASTAMI" typo); added Basmati.
- IT74502 | manufacturer_sku / name | EASY PRESS | Ufesa markets it as "Easy Press" (also shown as "GS Easy Press") | Used "Easy Press" in customer-facing text; kept the supplied code verbatim in the spec table.
- IT64904 | source_title / product_type | "2-in-1 Cloth Dryer & Iron", category "Steam Irons" | Automatic ironing and drying mannequin | SV1200 is an inflatable garment-drying and de-creasing mannequin, not a steam iron; described accurately in the content. Supplied category left unchanged.
- IT74236 | max phone size | not stated in source | SBS states up to 6.8"; retailer listings for the same code state 6" and a 33–118 mm width range | Sources conflict, so no maximum device size was published.
- 90-65P61K | specifications | source title "Smart Google Tv UHD 4K HDR+" | Retailer spec sheets for 65P61K contradict each other (Google TV vs Android TV 9.0; HDR10 vs HDR10+/HLG; audio 16 W vs 40 W; dimensions inconsistent with a 65" panel) | Published only screen size, 4K UHD resolution, HDR support and Google TV. long_description returned empty as there was not enough confirmed material for two honest sections.
- IT62911 / IT74502 | heat-up time and steam output | not in source | Easy Press quoted as both 25 s / 30 g/min and 40 s / 0–25 g/min by different listings | Conflicting, so heat-up time and steam output were omitted for the Easy Press. GS1700 steam output (25 g/min) was confirmed by two sources and published.
- IT59921 / IT72712 / IT69612 / IT49699 | weight | not in source | Single or feed-duplicated retailer figures only (10.98 kg, 12.1 kg) | Not published — could not be confirmed as product rather than carton weight.
- IT49699 | power | not in source | No manufacturer wattage found for BCG820BSSUK in available lookups | Wattage row omitted.
- IT69612 | bean hopper capacity | not in source | 340 g on a single retailer listing | Omitted as an unverified headline capacity figure.
- IT64904 | water tank capacity | not in source | 800 ml on a single retailer listing | Omitted as an unverified headline capacity figure.


## Batch t1-b029 (tier 1)

# Discrepancy notes — batch t1-b029

- IT70613 | source_title colour | "Grey" | Orange, white and grey (Ufesa official / MediaMarkt ES) | Kept "Grey" in the titles per source, but published the full "Grey, orange and white" in the specification table.
- LAG-8.1671.09 | product_type / source_title | "Nail Scissors" | Victorinox official product name is "Cuticle Scissors" (curved tip, 92 mm) | Corrected silently to the manufacturer's variant name in all content. The straight/nail-cutting variant in this batch is 8.1681.09.
- LAG-8.1681.09 | source_title length | "9cm" | 93 mm (Victorinox official) | Kept "9 cm" in titles, published the exact 93 mm in the specification table.
- NMK-3615-1016 | source_title product name | "Cordless Beard Shaver" | Wahl official product name is "Travel Shaver" (mains/rechargeable foil shaver) | Corrected silently to "Travel Shaver"; it is not cordless-only, so "Mains or rechargeable battery" is stated instead.
- NMK-3615-1016 | charge time | not in source | Retailer sources disagree (8 h vs 14 h) | Omitted the charge time row entirely; run time 45 min was consistent and is published.
- NMK-79111-516 | source_title | "Corded Hair Clipper, Black" | Wahl Baldfader 14-piece mains-powered hair cutting set | Added the confirmed "14-piece set" to the titles; contents section based on the confirmed kit list.
- NMK-79111-516 | ean | 4317000589 | Manufacturer/retailer EAN is 0043917000589 | Published the supplied EAN unchanged as instructed; the supplied value appears to be the same code with leading zeros stripped.
- NMK-3615-1016 | ean | 43917006888 | UPC 043917006888 | Published the supplied EAN unchanged; same leading-zero truncation pattern.
- NMK-9698-1016 | ean | 43917002484 | UPC 0043917002484 | Published the supplied EAN unchanged; same leading-zero truncation pattern.
- NMK-9649-916 | research | n/a | Only the US-market 9649P variant is documented in detail | Did not import 9649P figures (different suffix). Content restricted to what the source title and model line confirm; no EAN, no run time published.
- 9W-FFB8469BVEE | ean | null (missing) | 8003437050510 (confirmed on multiple EU retailer listings for the same model code) | Added the researched EAN to the specification table.
- 9W-FFB8469BVEE | source_title colour | "White" | Some EU retailers list the finish as black/white (white cabinet, dark door) | Retained the source value "White"; flagged here as it may need confirming against the physical stock.
- IT69166 | brand | "WILSON" (all caps) | Wilson | Corrected casing in all content.
- IT72786 | research | n/a | No manufacturer or retailer listing found for WWDFSR35B.UK in two lookups | Written from the source title alone; long_description left empty and the specification table limited to brand, model, type, colour and EAN.
- HADJ-WOO-MDK13 | manufacturer_sku | "WOO-MDK13" | MDK13 | Vendor prefix "WOO-" stripped; published the manufacturer code MDK13.
- HADJ-WOO-WDD80 | manufacturer_sku | "WOO-WDD80" | WDD80 | Vendor prefix "WOO-" stripped; published the manufacturer code WDD80.
- HADJ-WOO-WDD80 | source_title capacity | "10L" | 8 litres per 24 h at 20 C and 60% RH (Wood's official) | Published the manufacturer figure with its test conditions; the 10 L claim could not be confirmed on any Wood's source.
- HADJ-WOO-WDD80 | ean | null (missing) | 7332857000791 (Wood's official and B&Q) | Added the researched EAN to the specification table.
- HADJ-WOO-MRD25GW | brand | "Woods" | Wood's | Corrected the apostrophe in all content.
- SH-0281194 | brand / manufacturer_sku | null | Not identifiable | No brand or model code to research against. Written from the source title alone; long_description left empty and product_title is 45 characters, below the 50-80 target, because nothing further can be stated honestly.


## Batch t2-b036 (tier 2)

# Discrepancy notes — t2-b036

- AS-ASR-1-FTH, AS-ASB-1-BLK, AS-FRB-1-BLK, AS-FRB-4-BLK, AS-FRR-4-BLK, AS-FRR-BLK, AS-MFR-1-BLK, AS-ASR-1-BLK-FBA, AS-ASR-1-WHT | brand | AssSavers | Ass Savers | Manufacturer writes the brand as two words; corrected silently in all output text and in the Brand specification row.
- AS-ASR-1-BLK-FBA | manufacturer_sku | 7.35007E+12 | ASR-1-BLK | Source value is a spreadsheet-mangled number (scientific notation of the EAN), not a model code. Published the model code ASR-1-BLK, which matches the SKU and the confirmed Ass Saver Regular black variant. Supplied EAN 7350072560715 published unchanged.
- AS-MFR-1-BLK | source_title | Ass Savers Mudder Mountain Bike Front Mudguard, Black | Ass Savers Mudder Regular front fork mudguard | Manufacturer's variant name for MFR-1 is "Mudder Regular"; it mounts to a suspension fork bridge rather than being a generic MTB front guard. Used the official variant name in the title and specification table.
- AS-FRB-1-BLK and AS-FRB-4-BLK | ean | 7350072560913 on both | (unresolved) | Two distinct SKUs/model codes carry the same EAN in the source. Published the supplied EAN on both as instructed; flagging for data owner.
- AS-FRR-4-BLK and AS-FRR-BLK | ean | 7350072560449 on both | (unresolved) | Two distinct SKUs/model codes carry the same EAN in the source. Published the supplied EAN on both as instructed; flagging for data owner.
- AS-FRB-1-BLK | manufacturer_sku | FRB-1-BLK | (not confirmed) | Only FRB-4 Fendor Bendor Big is documented by the manufacturer and by retailers. Could not confirm FRB-1 is the same generation, so no dimensions, weight, material or tyre-width figures were published for this SKU; long_description left empty.
- AS-FRR-BLK | manufacturer_sku | FRR-BLK | (not confirmed) | Only FRR-4 Fendor Bendor Regular is documented by the manufacturer and by retailers. Could not confirm FRR-BLK is the same generation, so no dimensions, weight, material or tyre-width figures were published for this SKU; long_description left empty.
- AS-ASR-1-FTH | source_title | Ass Saver Regular Mudguard, Feather (Special Edition) | ASR Feather (Ass Saver Regular, Feather edition) | Manufacturer lists the edition as "ASR Feather". Kept the descriptive form in the title and recorded Edition = Feather in the table. Source gives no colourway and the Feather edition exists in more than one colour, so no colour was published.
- AP-808A, AP-A101, AP-A400, AP-A401, AP-D320X, AP-D338XW, AP-1340, AP-513B | source_title | e.g. "Bird Cage 808A,Black" | "Alfa Pets Bird Cage 808A, Black" | Missing space after the comma and no brand in the source title; corrected spacing and prefixed the brand. AP-511B already had the space.
- AP-808A, AP-A101, AP-A400, AP-A401, AP-D320X, AP-D338XW, AP-1340, AP-511B, AP-513B | long_description / specifications | n/a | n/a | No manufacturer site or reputable retailer listing could be found for Alfa Pets under these model codes. Written from the source title alone: long_description left empty and the specification table limited to brand, type, colour and manufacturer code. Product titles fall below the 50-character target because nothing further could be stated honestly.


## Batch t2-b037 (tier 2)

# Discrepancy notes — t2-b037

- AS-SFR-1-BLK | brand | AssSavers | Ass Savers | Corrected brand spacing in all output text; sku and EAN untouched.
- AS-TFR-1-BLK | brand | AssSavers | Ass Savers | Corrected brand spacing in all output text.
- AS-TFR-1-BLK | source_title / product_type | "Toetector Regular" listed as a Mudguard | ToeTector Regular, a mudflap extension that bolts onto an existing full front mudguard | Used manufacturer casing "ToeTector" and described it as a mudguard extension, not a standalone mudguard.
- AS-WGS-2-BLK | brand | AssSavers | Ass Savers | Corrected brand spacing in all output text.
- AS-WGS-2-BLK | source_title | "Win Wing Gravel 2 Standard Edition, Black Dots" | Win Wing 2 Gravel, Black Dot | Used the manufacturer's model name and colour name in the title; kept "Standard" as an Edition row in the specification table so the source fact is retained.
- AS-WGS-1-BLK | brand | AssSavers | Ass Savers | Corrected brand spacing in all output text.
- AS-WGS-1-BLK | ean | null | not found | No EAN row emitted.
- 47-H72E | research | — | — | Only brand, EAN, product type and H700E compatibility could be confirmed; no dimensions, weight or head-material data published.
- BE-LR200/210Filter | manufacturer_sku | null | Beurer article number 660.04 (taken from the source title) | Published 660.04 as the article number; no manufacturer_sku row emitted.
- BE-HM22 | manufacturer_sku | HM22 | HM 22 | Used Beurer's spacing in text and in the specification table.
- BE-HM55 | manufacturer_sku | HM55 | HM 55 | Used Beurer's spacing in text and in the specification table.
- BE-KS19 FRESH | manufacturer_sku | KS19 FRESH | KS 19 Fresh (Beurer article 70406) | Used Beurer's spacing; added the article number.
- BE-KS19-BLACK | manufacturer_sku | BE-KS19 BLACK | KS 19 Black (Beurer article 70404) | Source manufacturer_sku carries the internal "BE-" vendor prefix; published the manufacturer code without it.
- BE-KS19-SLATE | source_title / sku | sku says SLATE, title says "KS19 Sequence" | KS 19 Sequence | Manufacturer variant name is Sequence; used that. "Slate" appears only in the internal sku and was not used in any text. Beurer article number for this decor could not be confirmed, so no article-number row.
- BE-LR330-FILTER | source_title | "EPA E10 Filter" | confirmed as EPA E10 | No change; one retailer listing quotes E12 for the same kit, Beurer's own listing says E10, so E10 was published.
- BE-LR300R | source_title | "Replacement Filter Set ... for LR300/310" | Beurer article 693.02, combination filter (HEPA H13 + activated carbon) for LR 300 / LR 310 | Added filter class and article number; kept the gift-box detail from the source title.
- IT47397 | source_title | "Braun IS1012BL Iron Board," | Braun CareStyle Ironing Board IB 3001 BK | Source title carries the wrong model code and a trailing comma. Supplied EAN 8021098280480 and manufacturer_sku IB3001BK both resolve to the Braun CareStyle Ironing Board IB 3001 BK, so the content was written to IB3001BK. Supplied EAN published unchanged.
- POT-CK2133S-096-62-11 | source_title | "Calvin Klein  CK2133S  Rimless Square Shield / Navigator Sunglasses,Silver Metal" | same content, tidied | Fixed double spaces and the missing space after the comma. Colour code 096 could not be verified against Calvin Klein or an authorised retailer; it is published only as the supplied colour code and no lens/finish claims were made from it.
- AMZ-DE-B0FYW8HDH5 | manufacturer_sku / ean | null / null | not found | The Amazon ASIN did not resolve to a manufacturer listing. Written from the source title alone: no model code, no EAN, no dimensions, long_description left empty.
- AMZ-DE-B0FYW8HDH5 | category | Home Appliances > Climate & Air Treatment > Air Treatment Filters & Accessories | unconfirmed | Black & Decker HEPA-plus-sponge filter sets of this description are normally vacuum cleaner filters rather than air-treatment filters, but the exact item could not be identified, so no application was stated in the content and the category was left as supplied.


## Batch t2-b038 (tier 2)

# Discrepancy notes — t2-b038

- POT-CK3059S-283 | source_title | "Sunglassses" | "Sunglasses" | Corrected the typo in the title.
- POT-CK3059S-283 | source_title / model | "Calvin Klein 3059S" | "Calvin Klein CK3059S" | Source title omits the "CK" prefix carried by the manufacturer code; restored the full model code CK3059S in all output text.
- POT-CK981S-190 | source_title / model | "Calvin Klein 981S" | "Calvin Klein CK981S" | Same missing "CK" prefix; restored CK981S from the manufacturer code.
- POT-CK981S-190 | source_title | "TortoiseShell" | "Tortoiseshell" | Fixed casing.
- POT-CK1133S-266-59-12 | source_title | "Aviators Sunglasses" | "Aviator Sunglasses" | Normalised plural to the standard frame-shape term.
- POT-CK2079S-62-11 | source_title | "CK2079S   Shield" (triple space) | "CK2079S Shield" | Fixed spacing.
- POT-CK3062S-000-63-11 | source_title | "Shield  Sunglasses" (double space) | "Shield Sunglasses" | Fixed spacing.
- POT-CK4076S-292 | source_title | "Rectabgular" | "Rectangular" | Corrected the typo.
- POT-CK3062S-004-63-11 / POT-CK3062S-000-63-11 | source_title frame shape | same model CK3062S described as "Aviator" on one line and "Shield" on the other | not resolved | Research did not return a manufacturer page for CK3062S, so each listing was written with the shape stated in its own source line. Flagging for supplier confirmation — one of the two is likely wrong.
- POT-CK4076S-292 / POT-CK4076S-295 | source_title frame shape | same model CK4076S described as "Rectangular" on one line and "Soft Oval" on the other | not resolved | As above: no manufacturer page found; each listing follows its own source line. Flagging for supplier confirmation.
- POT-CK4075S-297-125 | category vs title | title "Oversized / Round Oval", category "Oversized & Geometric" | not resolved | Used the title wording ("Oversized round oval"); no manufacturer source found to arbitrate.
- POT-CK3059S-283, POT-CK983S-042, POT-CK4076S-295 | category vs title | listed under "Round & Oval Sunglasses" while titles say "Slightly Rounded", "Rectangle / Oval" and "Soft Oval" | not changed | Category is not part of the output; noted only as a source inconsistency.
- All 17 Calvin Klein SKUs | ean | null | not found | No EAN supplied and none confirmed by research; EAN row omitted from every specification table rather than guessed.
- All 17 Calvin Klein SKUs | frame/lens measurements | trailing numeric segments in several manufacturer codes (e.g. "-59-12", "-62-11", "-61-14", "-63-11", "-125") | not published | These look like lens/bridge/temple measurements in millimetres, but the reading was not confirmed against a Calvin Klein or reputable retailer page for the same model and colour code, so no measurement rows were published and long_description was left empty for all sunglasses.
- CL-541XL | manufacturer_sku | null | 5226B005 | Canon part number confirmed by research and published as "Manufacturer part number"; the supplied sku field was left exactly as given.
- CL-541XL | ean | null | not found | No EAN confirmed; row omitted.


## Batch t2-b039 (tier 2)

- IT43517, ΙΤ37071, IT44430, IT42517, IT52510, IT42853, IT25271, IT52423, IT62660, ATP-ECODECALK-500ML | brand | Delonghi | De'Longhi | Corrected brand spelling to the manufacturer's own form in all titles, copy and specification tables.
- IT62660 | source_title | Delonghi ECAM 450.86.T | ECAM450.86.T | Removed the space in the model code; De'Longhi writes it closed up.
- IT62660 | colour | Black | Titanium | De'Longhi's own product page gives the finish for the .T suffix as Titanium; retailer listings vary between Black, Silver and Titanium. Published Titanium.
- IT62660 | wattage | not in source | 1450 W claimed by several retailers | Not published — the figure does not appear on De'Longhi's own specification page.
- IT43517 | wattage | not in source | 1750 W claimed by several retailers | Not published — not confirmed on De'Longhi's own product page. Voltage/frequency and 15 bar pressure published from the manufacturer page instead.
- IT66909 | source_title | Cuisinart DGB2U Grind&Brew Coffee | One Cup Grind & Brew Coffee Maker | Expanded to the manufacturer's full product name and fixed the missing spacing.
- IT66909 | wattage | not in source | not stated by Cuisinart | Left empty; no wattage published on the manufacturer page or in the manual listing.
- IT66913 | source_title | Cuisinart SG6SU Seasoning Mill | Style Collection SG6SU Rechargeable Seasoning Mill, Frosted Pearl | Added the confirmed variant finish (Frosted Pearl) and the rechargeable descriptor from the manufacturer page.
- IT44430 | compatibility | "for Delonghi ECAM65xx" | ECAM510.55, 550.75, 550.85, 556.75, 650.55, 650.75, 650.85, 656.55, 656.75, 656.85 | Source understated the fitment; published De'Longhi's full compatibility list.
- IT44430 | ean | null | not found | No EAN published; the EAN row is omitted from the table.
- IT25271 | source_title | "for Fully Automatic & Espresso Machines" | "suitable for all coffee makers with filters" | Reworded compatibility to De'Longhi's own wording, which keys on the machine taking a water filter.
- IT25271 | ean | null | not found | No EAN published.
- IT42853 | product name | Fancy Collection | De'Longhi US names the same DLSC302 set "Connoisseur Collection" | Kept "Fancy Collection" (the EU/UK name matching the supplied EAN); noted the US alias here rather than in the content.
- IT52510 | tamper diameter | not in source | 50 mm on De'Longhi US page vs 51 mm on multiple retailer listings | Conflicting figures, so no diameter row published.
- IT42517 | specification depth | title only | nothing beyond stainless steel / silver confirmed for DLSC054 | long_description returned empty; only two key features and a four-row table published.
- ΙΤ37071 | sku | contains Greek letters Iota+Tau, not ASCII "IT" | left exactly as supplied | Reproduced verbatim as required; flagged as a likely data-entry issue in the source feed.
- ΙΤ37071 | manufacturer_sku | null | DLSA007 | Model code taken from the source title and confirmed against De'Longhi's own filter-kit listing (AC100 / AC150).
- ΙΤ37071 | ean | null | not found | No EAN published.
- ATP-ECODECALK-500ML | manufacturer_sku | null | DLSC500 | De'Longhi's own listing for EcoDecalk 500 ml (5 doses) is DLSC500; published that code.
- ATP-ECODECALK-500ML | ean | null | not found | No EAN published.
- FI-CORAVIN-801060 | product name | Faster Pour Needle | Coravin's own site calls part 801060 the "Fast Pour Needle" | Kept the source's "Faster Pour Needle" (used by Best Buy and other retailers for 801060); both names refer to the same part.
- FI-CORAVIN-801060 | colour | not in source | Best Buy lists 801060 as "Red", Amazon.de as "silver, stainless steel" | Conflicting, so no colour published.
- LAG-LC100CLRD | ean | 81287046950 (11 digits) | supplied value published unchanged | EAN/UPC is one digit short of a valid UPC-A; published as supplied per instruction, flagged here.
- LAG-LC100CLBR | ean | 81287046943 (11 digits) | supplied value published unchanged | Same length anomaly as above; published as supplied.
- LAG-LC100CLBR | source_title | "Colibri Leather Case for Lighter Or Cutter (Brown-Large)" | LC100CLBR, Large, Brown | Reordered into brand-model-type-attribute form and fixed casing; no facts added.
- LAG-CU300T23 | source_title | "Colibri Cutter V-Cut Blue Carbon Fiber Print" | CU300T23 V-Cut Cigar Cutter, Blue Carbon Fibre Print | Reordered, added the model code, UK spelling of "fibre".
- LAG-HU500T1 | dimensions | not in source | 14.19 x 9.19 x 5.94 in | Published from Colibri's own Heritage Humidor page (product dimensions, not carton).
- LAG-LC100CLRD, LAG-LC100CLBR | case length | not in source | "approx. 8.2 in / 208 mm adjustable length" on Colibri's site | Not published — the figure is ambiguous (likely a belt strap measurement) and not clearly a product dimension.


## Batch t2-b040 (tier 2)

# Discrepancy notes — t2-b040

- IT34190 | brand | Delonghi | De'Longhi | Corrected brand spelling/casing in all output text; source field left untouched.
- ATP-MONDO-CA6903 | brand | Delonghi | Mondo | Brand field named the machine maker, not the item's maker. The source title itself says "Mondo". Published as a Mondo-branded filter.
- ATP-MONDO-CA6903 | source_title (compatibility) | "Water Filter for Delonghi Espresso & Bean to Cup Machines" | Water filter equivalent to the Philips/Saeco CA6903 cartridge | CA6903 is the Philips/Saeco water-filter part code; De'Longhi bean-to-cup machines take SER3017/DLSC002. Content states Philips and Saeco compatibility and does not claim De'Longhi fitment.
- IT65509 | brand | EQUATOR | Equator | Corrected all-caps brand casing in output text.
- POT-EP105S-62-12-130 | brand | Emillio Pucci | Emilio Pucci | Corrected brand spelling (source title already had it right).
- POT-EP500SR-70-20-425-125 | brand | Emillio Pucci | Emilio Pucci | Corrected brand spelling.
- POT-EP600S-757-58-16-130 | brand | Emillio Pucci | Emilio Pucci | Corrected brand spelling.
- POT-EP605S-62-16-681-125 | brand | Emillio Pucci | Emilio Pucci | Corrected brand spelling.
- POT-EP638S-58-18-109-135 | brand | Emillio Pucci | Emilio Pucci | Corrected brand spelling.
- POT-EP690S-58-16-004-135 | brand | Emillio Pucci | Emilio Pucci | Corrected brand spelling.
- POT-EP690S-58-16-216-135 | brand | Emillio Pucci | Emilio Pucci | Corrected brand spelling.
- POT-EP600S-757-58-16-130 | manufacturer_sku | EP600S-75758-16-130 | EP600S-757-58-16-130 | Missing hyphen between colour code 757 and lens size 58. Published the corrected code (which matches the internal SKU).
- POT-EP690S-58-16-004-135 | manufacturer_sku | EP58-16-004-135 | EP690S-58-16-004-135 | Model designation "690S" dropped from the code. Published the corrected code (which matches the internal SKU and the sibling orange colourway).
- MUT-C13T671400 | source_title | "Epson Maintenance Box for WF-C869RDTWFC/ C879R" | Epson official product name "WF-C869R/C878R/C879R Maintenance Box" | Used Epson's own product name and its published compatibility list, which is broader than the source title (also covers WF-C878R, WF-C8190, WF-C8610, WF-C8690 and EM/EP series).
- POT-FS471M-215-135 | source_title | "Dark Tortoise Shell" | "Dark Tortoiseshell" | Word-spacing tidied.
- POT-EP600S-757-58-16-130, POT-EP605S-62-16-681-125, POT-FS299-035-59-18-130, POT-FS446-216-57-17-130, POT-FS464-61-17-272-135, POT-FS464-61-17-007-135, POT-FS465-62-13-210 | source_title | double spaces / missing space after comma | single spacing | Punctuation and spacing tidied only; no facts added or removed.

## Specifications researched but withheld

Recorded here for transparency; none of these appear in the output.

- IT34190 (De'Longhi ICM15210.1) — 900 W appeared on one retailer only, and tank capacity was given variously as 1.25 L, 1.3 L and 1.5 L across retailers. De'Longhi's own specification page lists neither. Both omitted. Published only what De'Longhi states: 10 cups, 205 x 225 x 320 mm, 220-240 V, 50/60 Hz, 40-minute auto shut-off, keep-warm plate, water-level window, dishwasher-safe carafe and filter holder.
- IT65509 (Equator CH 32) — a single Cyprus retailer listed 32 L, approx. 250 cigars, 16-20 degrees C, energy class F, 93 kWh/year, 41 dBA, 51.5 x 39.5 x 53 cm, 22 kg, R600a, LED lighting, UV-protected door, door lock, 3 shelves. No manufacturer page or second source found, so all of it was withheld and long_description returned empty.
- ATP-MONDO-CA6903 — a filter life of "2-3 months or about 50 litres" appeared on one retailer only; omitted. The listed 10 x 15 x 10 cm / 0.3 kg is almost certainly carton data; omitted.
- All 13 sunglasses — lens width and bridge width are decoded from the size groups in the manufacturer codes and published as such. Temple length and colour codes were not published, because the position of those numbers is not consistent across the codes supplied (e.g. FS465-62-13-210, FS471M-215-135, FS472M-001-125). No frame material, lens category, UV rating or case contents could be confirmed, so long_description is empty for all 13.


## Batch t2-b041 (tier 2)

- 3G-001-104-26-200/0 | source_title | "Fissler 001-104-22-200/0 Glass Lid 26cm" | 001-104-26-200/0 | Source title carried the 22 cm article number on the 26 cm lid; used the correct code from manufacturer_sku (and matching EAN 4009209385181) in all content.
- 3G-011-631-00-750 | manufacturer_sku | 011-631-00-750 | 011-631-00-750/0 | Supplied code was missing the "/0" suffix that the source title, the EAN 4009209185231 and all manufacturer/retailer listings carry; wrote the full code in the content. The sku key was left exactly as supplied.
- 3G-011-631-00-750 and 3G-011-631-00-750/0 | sku | two separate rows | same product | Both rows are the same part (identical manufacturer code once the suffix is normalised, identical EAN 4009209185231). Both were written as supplied, with identical content; flagged as a likely duplicate listing.
- 3G-018-633-00-690/0 | source_title | "Royal Pressure Cooker Handle Complete" | Vitavit Royal lid handle (Deckelstiel), complete, incl. profile strip | Manufacturer-code lookups identify this as the lid/upper handle, not a body handle; specified "lid handle" in the content and recorded the included profile strip.
- 3G-018-632-00-740/0 | source_title | "Main Valve Sealing O-Ring for Vitavit" | Vitavit Royal main valve O-ring | Retailer listings on this code give the series as Vitavit Royal specifically; used Vitavit Royal in the content.
- POT-FS5340-799-130 | source_title | "Fendi FS5340 Geometric, Yellow & Green" | Fendi FS5340 geometric sunglasses, yellow & green | Source title omitted the product type; added "sunglasses" from the supplied product_type/category. No other facts added.
- POT-FS5124-520-130 | research | - | - | No listing found for model code FS5124 on a manufacturer or reputable retailer page in two lookups. Written from source title alone; long_description left empty and no measurements published.
- POT-FS5340-799-130 | research | - | - | No listing found for model code FS5340 in two lookups (search returns a Fossil watch of the same reference). Written from source title alone; long_description left empty.
- 3G-001-104-22-200/0, 3G-001-104-24-200/0, 3G-001-104-26-200/0, 3G-001-804-32-200/0 | specifications | - | - | No manufacturer specification page found for the 001-104-xx-200/0 or 001-804-32-200/0 lid codes. Retailer figures for handle material, outer diameter, height and weight were single-source only and were not published; tables limited to brand, type, glass, diameter, code and EAN, and long_description left empty.
- 3G-001-040-01-000/0 | specifications | - | - | Manufacturer page lists product dimensions of 35 x 70 x 25 mm, which do not read as a plausible peeler length; dimensions were omitted and only the confirmed material, finish, weight, origin and warranty published.
- 3G-001-051-00-062/0 | specifications | - | - | Manufacturer page gives dimensions in inches only and no bowl capacity; a 900 ml capacity appears on one retailer listing but was not confirmed, so no capacity or dimensions were published.
- POT-FS5008-56-16-280-130 | specifications | - | - | Frame measurements (56 mm lens, 16 mm bridge, 130 mm temple) taken from the supplied manufacturer code and corroborated by a retailer listing of the same FS5008 56-16-130 frame. The "280" segment is a colour code and was not interpreted.


## Batch t2-b042 (tier 2)

# Discrepancy notes — t2-b042 (Fissler, 18 products)

- 3G-021-636-03-750/0 | source_title | "Plain Matik Valve Silicone, Black" | Fissler Unimatik valve, silicone | "Plain Matik" is a corruption of the Fissler "Unimatik" valve name (confirmed against the same article number at multiple spares retailers); corrected to "Unimatik Valve, Silicone, Black" in all content
- 3G-021-636-03-750/0 | source_title model code | "021-636-03-750" | "021-636-03-750/0" | source title omits the "/0" suffix that the manufacturer_sku field carries; used the full code in the content
- 3G-037-668-00-700/0 | source_title | "Vitaquick Safety Valve" | vitaquick cooking valve (Kochventil), supplied with valve seat gasket and rolling membrane | part is the main cooking/control valve, not the safety valve; corrected to "vitaquick Cooking Valve with Seal and Membrane" and the confirmed contents used for the What's in the box section
- 3G-040-113-20-000/0 | source_title | "San Francisco Stewpot 20cm" | San Francisco cooking pot, 20 cm, 3.3 L | in the San Francisco range the 040-113 series is the cooking pot (Kochtopf) and 040-123 the low stew pot/casserole; corrected to "Cooking Pot" and capacity 3.3 L added
- 3G-040-113-20-000/0 | ean | 4009209367637 | 4009209372594 quoted by a retailer for article 040-113-20-000/0 (the supplied number returns Fissler Adamant Classic frying pan results) | supplied EAN published unchanged as instructed; flagged for the data owner to verify
- 3G-020-090-26-000/0 | source_title | "Magic Salt Sifter" | Fissler lists a "Magic Salzstreuer" (salt shaker) in the same range | could not confirm the article number against that page (it 404s), so the source wording was left unchanged; no capacity, material or dimension claimed
- 3G-021-641-00-700/0 | source_title fitment | "Complete 22 & 26cm" | one retailer describes the same article as a Blue Point valve for all pan sizes | conflict unresolved within the research budget; kept the supplied 22 and 26 cm fitment and made no wider compatibility claim
- 3G-040-114-05-000/0 | set contents | not given in source | Fissler lists 16/20/24 cm pots, a 20 cm stew pot and a 16 cm lidless saucepan with four glass lids; a major retailer describes the same article as three cooking pots, one stew pot and one lidless saucepan | the two descriptions agree on five vessels, four glass lids and one lidless 16 cm saucepan, so the box contents were written from that overlap only

## Fields deliberately left empty
- long_description is "" for the four Magic hand tools other than the bottle opener (citrus zester, one-hand chopper, salt sifter), the silicone membrane 020-653-00-720/0, the Unimatik valve, the Blue Point cooking valve, the Blue Point lid handle and the 032-691-00-205/0 gasket: research returned nothing beyond the source title, so two honest sections were not possible.
- No dimensions, weights, oven temperatures or pack quantities are published anywhere in this batch; retailer figures for these were either carton dimensions or unverifiable against a manufacturer page.


## Batch t2-b043 (tier 2)

# Discrepancy notes — t2-b043 (Fissler, 18 products)

- 3G-081-110-20-600/0 | source_title | "Cooking Pot With Glass Lid 20cm" | Fissler Hamburg glass lid 20 cm (lid only, no pot) | Article 081-110-20-600/0 is the Hamburg-series 20 cm glass lid sold on its own; source title implies a pot is included. Rewrote all content as a glass lid; supplied EAN 4009209347783 matches the lid and was published unchanged.
- 3G-081-110-20-600/0 | brand/series | series not stated in source | Hamburg | Added the manufacturer series name to title and specification table.
- 3G-084-118-24-000/0 | source_title | "Original Profi Stew Pot 24cm" | Original-Profi Collection high stew pot 24 cm | Two model-matched listings name it the high/tall stew pot; corrected in content and used the official series name "Original-Profi Collection".
- 3G-084-378-28-100/0 | source_title | "Original Profi Grill Pan 28cm SS" | Original-Profi Collection stainless steel frying pan 28 cm | Model code resolves to the uncoated stainless frying pan (Stielpfanne), not a grill pan. Corrected to "Frying Pan"; no grooved/grill claim made anywhere in the content.
- 3G-084-388-28-100/0 | source_title | "Original Profi Pan" (no type, no size) | Original-Profi Collection serving pan 28 cm | Model code resolves to the 28 cm serving pan; added the type and size.
- 3G-156-115-20-000/0 | source_title | "Stew Pot With Glass Lid 20cm" (no series) | Adamant cooking pot with glass lid 20 cm | Added the missing "Adamant" series name and used the manufacturer's product name (Kochtopf / cooking pot).
- 3G-156-115-24-000/0 | source_title | "Adamant Cooking Pot 24cm" | Adamant cooking pot with glass lid 24 cm | Glass lid is part of the article; added to title and specifications.
- 3G-081-110-20-600/0, 3G-156-115-20-000/0 | category | "Kitchen & Dining > Cookware & Bakeware > Lids & Cookware Accessories" | mixed | 081-110-20-600/0 is correctly categorised as a lid, but 156-115-20-000/0 is a complete pot with lid and sits in the wrong category. Flagged only; category is not an output field.
- 3G-080-077-03-000/0 | brand series | "Proline" | unresolved ("Prolin" vs "Proline" both appear in retailer listings) | Could not confirm against a manufacturer page in the allotted lookups; left the source spelling "Proline" unchanged.

## Fields deliberately left empty / thin (no confirmed data found)

- 3G-059-057-30-000/0 Black Edition spaghetti lifter — no model-matched manufacturer or retailer spec page found (the 059-057 code family appears against a skimmer and a ladle in different listings, so nothing was safe to carry over). Written from the source title only; `long_description` empty, no material or dimensions published.
- 3G-080-077-03-000/0 Proline citrus peeler — no spec page for this article number. Written from source title only; `long_description` empty.
- 3G-088-013-20-000/0 Profession deba knife — only a bare retailer name match found; no confirmed blade length, steel type or handle material. `long_description` empty; "20 cm" published as a size, not asserted as blade length.
- 3G-089-023-00-000/0 Q! can opener — Fissler's own product page 404s; material not confirmed (one retailer title says stainless steel, no corroboration), so no material row published. `long_description` empty.
- 3G-089-038-00-000/0 Q! strainer 16 cm — confirmed as the Q! medium strainer 16 cm; stainless steel taken from the source title. No further specs confirmed, `long_description` empty.
- 3G-084-388-28-100/0 — retailer data conflicted on whether a lid is supplied, and capacity (3.0 l) came from a single retailer only. Both omitted.
- 3G-100-800-32-100/0 — capacity (6.0 l) and colour (retailers split between black and anthracite) came from single/conflicting sources. Both omitted.
- 3G-156-115-20-000/0, 3G-156-115-24-000/0, 3G-156-114-03-000/0 — litre capacities appeared on single retailer listings only and were omitted. Hob compatibility omitted for the two pots (unconfirmed); published for the set only, where a model-matched listing states gas/induction.
- 3G-045-301-28-100/0 — weight and height came from a single retailer and were omitted; material, coating, handle, hob and care data retained.
- Carton-vs-product dimensions: no retailer "dimensions"/"weight" figure was published unless the source clearly labelled it as product data (manufacturer pages for the Cenit grill pan and wok; knivesandtools product-spec tables elsewhere).


## Batch t2-b044 (tier 2)

# Discrepancy notes — t2-b044 (Fissler)

- 3G-157-304-26-100/0 | source_title | "Adamat Classic Pan 26cm" | "Adamant Classic Frying Pan 26 cm" | corrected the misspelled range name (Adamant) and the truncated product type in the title
- 3G-157-121-28-100/0 | source_title | "Levital Classic" | "Levital+ Classic" | Fissler's official range name is Levital+ (Levital®+); used the official variant name in the title and specifications
- 3G-084-378-24-100/0 | source_title | "Fissler 3G-084-378-24-100/0 Original Profi Grill Pan - 24cm" | "084-378-24-100/0 Original-Profi Collection Novogrill Pan" | source title contained the internal SKU with its 3G- vendor prefix; removed it and used the manufacturer code only. Also used Fissler's own naming: Original-Profi Collection, with the Novogrill waffle-structure frying surface (it is a stainless frying pan with a textured surface, not a ridged grill pan)
- 3G-045-300-20-100/0 | source_title | "Fissler 45-300-20-100" | "045-300-20-100/0" | source dropped the leading zero and the /0 suffix; used the full manufacturer code as supplied in manufacturer_sku
- 3G-045-300-24-100/0 | source_title | "Fissler 45-300-24-100" | "045-300-24-100/0" | same leading-zero/suffix correction as above
- 3G-045-300-20-100/0 | hob compatibility | not stated in source | non-induction variant | research shows 045-300 is the non-induction Cenit pan (Fissler sells the induction version as 045-301). Stated hobs as gas, electric, ceramic, halogen and flagged "not for induction" rather than assuming induction like the other pans in this batch
- 3G-045-300-24-100/0 | hob compatibility | not stated in source | non-induction variant | same as above
- 3G-159-105-28-100/0 | ean | 4009209367613 | duplicate of the EAN supplied for 3G-159-105-24-100/0 | the two Adamant Comfort sizes carry the identical EAN in the source, so at least one is wrong (Fissler lists 4009209367606 for the 20 cm size, so the ...613 code most plausibly belongs to one size only). Published the supplied EAN unchanged on both records as instructed; flagging for the data owner
- 3G-600-000-22-795/0 | ean | 4051709422675 | Fissler publishes barcode 4009209307701 for article 600-000-22-795/0 | published the supplied EAN unchanged as instructed; the supplied code sits in a different GS1 prefix range from every other Fissler item in this batch, so it may be a repackager code
- 3G-600-000-00-700/0 | source_title | "Main Control Valve for Pressure Cooker Vitavit, Vitaquick" | Vitaquick pressure cookers from 2010 onwards | Fissler's own listing for this article confirms Vitaquick (from 2010) only; Vitavit compatibility could not be confirmed, so it was left out of the content. Also corrected the part name to "control valve" and confirmed the set contains membrane, O-ring, valve base seal and screw
- 3G-600-000-01-706/0 | source_title | "Pressure Cooker Rubber Parts Set" | Set of rolling membrane, O-ring and valve seat seal, for all Vitaquick from 2010 | the supplied EAN 4009209322643 resolves to this specific three-part set; used the confirmed contents rather than the generic source description
- 3G-600-000-01-706/0 | manufacturer_sku in source_title | "600-000-01-706" | "600-000-01-706/0" | source title omitted the /0 suffix; used the full code
- 3G-600-810-10-000/0 | brand/range naming | "Vitaquick Pressure Cooker 26cm 10L" | confirmed correct | the code initially looked like a typo for 602-810-10-000/0 (Vitaquick Premium); the supplied EAN 4009209406589 confirms 600-810-10-000/0 is the standard Vitaquick 26 cm / 10 L. No change made
- 3G-602-410-04-000/0 | source_title | "VQ Premium Pressure Cooker" | "Vitaquick Premium Pressure Cooker" | expanded the abbreviated range name to Fissler's official name
- 3G-602-410-04-070/0 | source_title | "Vitaquick Premium Cooker With Tripod" | supplied with a steamer insert | every listing traceable to this article number and EAN describes the accessory as a steam insert / steam basket; a tripod or trivet could not be confirmed, so the content states "steamer insert" only and the box contents list omits a tripod

## Facts deliberately left out (could not be confirmed to the standard in the brief)
- Pan capacities in litres and pan weights: only single retailer figures were available for the Levital+, Adamant Classic, Adamant Comfort, Ceratal and Cenit pans, so no capacity or weight rows were published. The 3.7 L wok capacity IS published — it is stated on Fissler's own product page for 157-805-28-100/0
- Oven-safe ratings for the coated pans: only the Original-Profi Novogrill pan has a manufacturer-stated oven rating (230 °C), so no oven row appears on the other pans
- Cenit country of manufacture: a retailer states Italy, unconfirmed by Fissler, so no row published
- Warranty terms for the Vitaquick Premium cookers: sources conflict (10 years on Fissler's own site vs 15 years at a retailer), so no warranty row published for 602-410-04-000/0 and 602-410-04-070/0
- 3G-159-220-26-100/0 has no EAN in the source and none was published


## Batch t2-b045 (tier 2)

# Discrepancy notes — t2-b045 (Fissler, 18 products)

- 3G-602-410-06-000/0 | source_title | "VQ Premium" | Vitaquick Premium | expanded the abbreviation to Fissler's official range name in all output fields.
- 3G-602-810-08-000/0 | source_title | "602-810-08-000/00" | 602-810-08-000/0 | source title carries a trailing-zero typo in the model code; the `manufacturer_sku` field is already correct. Published the correct code.
- 3G-602-810-08-000/0 | source_title | "Pressue Cooker" | Pressure Cooker | obvious typo, corrected silently.
- 3G-602-810-08-070/0 | source_title | "22 CM" | 26 cm | 602-810-08-070/0 is the 26 cm / 8 L Vitaquick Premium cooker with steaming insert; the -810- family is 26 cm throughout. Corrected in content.
- 3G-602-810-10-070/0 | source_title | "22CM" | 26 cm | same issue: 602-810-10-070/0 is the 26 cm / 10 L cooker with steaming insert. Corrected in content.
- 3G-602-410-06-070/0 | source_title | "Cooker With Tripod" | Pressure cooker supplied with steaming insert and trivet | research confirmed the set contains cooker, steaming insert and trivet; wrote both contents rather than the tripod alone.
- 3G-610-000-00-711/0 | source_title | "Vitaquick Silicone Membrane" | Fissler lists this article as the Vitavit Membrane, fitting all diameters of Vitavit Premium, Edition and Comfort | published under Vitavit; supplied EAN 4009209307596 matches the manufacturer record.
- 3G-610-000-00-734/0 | source_title | "Bell-Shaped Nut for Control Valve" | Bell-shaped nut for the cooking valve (Vitavit Comfort / Premium / Edition) | wording aligned to the manufacturer's own part name and series list.
- 3G-610-010-00-700/0 | source_title | "Complete 4-setting Valve for Vitavit Comfort/Premium" | Fissler part name is Vitavit Kochventil S4 (S4 cooking valve) | used the S4 designation; four settings retained. Manufacturer compatibility is wider than the source states (also fits Vitavit Edition and the 18 cm pressure skillet), so the compatibility list was expanded.
- 3G-610-700-00-800/0 | source_title | "Vitaquick Inset with Tripod" | perforated steaming insert with tripod | "Inset" corrected to "Insert". Series attribution is inconsistent across sources (listed under both Vitavit and Vitaquick), so no series is claimed in the content; only the confirmed 26 cm fitment and 18/10 stainless steel construction.
- 3G-610-700-04-850/0 | source_title | "Pot Handle for Skillet Pan" | pot handle for the 26 cm pressure skillet (Schnellbratpfanne) | wording normalised. Note the near-identical 620-700-04-850/0 is the Vitavit Premium version of this handle — a different part, not used here.
- 3G-620-000-11-770/0 | source_title | "Pressure Cooker Lid Handle" (no series given) | Vitavit Premium lid handle, black, all diameters | series added from research; supplied EAN 4009209357768 matches.
- 3G-622-412-06-070/0 | source_title | diameter absent | 22 cm | added the confirmed pot diameter; supplied EAN 4009209379784 matches this model.
- 3G-084-028-07-000/0 | source_title | "Original Profi Vegerable/Rice Spoon" | Original-Profi Collection Vegetable and Rice Spoon | typo corrected and the official collection name used; supplied EAN 4009209390130 matches.

## Facts deliberately left out (could not be confirmed to brief standard)

- Product dimensions and weights for all pressure cookers, inserts and handles: the only figures available were retailer-supplied and not clearly labelled as product (rather than carton) measurements. No dimension or weight rows were published.
- Dishwasher suitability for the Vitaquick Premium cookers: Fissler's own material says dishwasher safe except removable parts, while a retailer listing for the same models says hand wash only. Conflicting, so omitted entirely.
- Warranty terms: manufacturer pages quote different periods (3, 10 and 15 years) across the same product families and regions. Omitted from all listings except where the manufacturer's own spare-part page stated it plainly (two years, spare parts only), which is mentioned in prose only.
- Integrated measuring scale, Novogrill surface and detachable-handle claims for the Vitavit Premium cookers: these appear on the current S4-generation range page, which may not describe the older 620-xxx article, so they were not applied to 620-300-04-070/0.


## Batch t2-b046 (tier 2)

# Discrepancy notes — batch t2-b046

- 3G-086-114-05-000/0 | source_title | "Set - 5 Pcs 24cm + CA 30cm" | Fissler article 086-114-05-000/0 contains 16/20/24 cm cooking pots, a 20 cm braising pot and a 16 cm saucepan | Dropped the unverifiable "24cm + CA 30cm" detail and wrote the set contents from the Fissler product page for this exact article number
- COMPU-W2211A | manufacturer_sku | null | W2211A | Derived the manufacturer part from the SKU after the COMPU- vendor prefix; consistent with the source title's "HP 207A ... Cyan"
- COMPU-W2210XC | source_title | "HP W2210A 207X" | W2210X / 207X | Source title mixes the 207A part number (W2210A) with the 207X series; the SKU carries W2210X, so published W2210X / 207X. Did not state page yield, since 207A vs 207X could not be settled by research
- COMPU-W2210XC | brand | HP | HP-compatible (non-original) | Source title says "Compatible"; described and tabulated as a compatible cartridge rather than a genuine HP consumable
- FI-0280156014 | manufacturer_sku | 280156014 | 0280156014 | Leading zero missing; published the full 10-digit OEM number as it appears in the SKU and source title
- FI-0280156014 | brand | Izzy | unconfirmed | Could not verify "Izzy" as the injector brand. Kept it as supplied, and did not present the part as Bosch-manufactured — the source only says it fits/replaces Bosch
- POT-M2808S-612 | brand | Karl Lagerfeld | Michael Kors | Source title and SKU both give Michael Kors M2808S; published as Michael Kors
- POT-M2808S-612 | manufacturer_sku | KL6325-004 | M2808S-612 | Value is a mistyped copy of the neighbouring Karl Lagerfeld row (KL632S-004); used the SKU-derived manufacturer code instead
- POT-KL628S-017 | source_title | "Karl Lagerfeld KL628S Soft Square, Tortoise Shell" | — | Title omits the word "Sunglasses"; added it from product_type, no other change
- IT41121 | category | Kitchen & Dining > ... > Coffee Machine Accessories & Filters | mismatched | A "Twist connection adapter for attachments" is not a coffee machine filter. Category is not an output field so it was left alone; no appliance fitment was stated in the content, as it could not be confirmed
- KOR-CLASSIC-SMALL-SUPERIOR+ATH-FOUKOU-MOTOR | sku vs source_title | SKU says CLASSIC, title says SUPERIOR | unresolved | Used the source title's "Superior" plus "Small" and published no model code
- LAG-095248 | brand | "L' Atelier du Vin" | "L'Atelier du Vin" | Corrected the stray space after the apostrophe
- LAG-095248 | manufacturer_sku | 95248 | 095248 | SKU and source title both use the zero-padded 095248; published 095248
- Batch-wide | research | — | — | The session's web-search budget ran out after the two Fissler lookups, and direct manufacturer-page fetches (Hama 00049590, Fissler valve seal, Kenwood KAT001ME) returned 404 or were blocked. Per the Tier 2 rule, the remaining products were written from source data alone, with long_description left empty where two honest sections were not supportable


## Batch t2-b047 (tier 2)

# Discrepancy notes — t2-b047

- ALL LAG-* SKUs | brand | `L' Atelier du Vin` | `L'Atelier du Vin` | Stray space after the apostrophe in the source brand field; corrected silently in all output text and in the Brand row of every specification table.
- LAG-095681 | source_title | `Gard Bulles` | `Gard'Bulles` | Missing apostrophe in the manufacturer's product name; corrected in titles and copy.
- LAG-095681 | source_title colour | `Black` | not confirmed | The article number resolves to the manufacturer's "Metal Gard'Bulles" stopper; listings for it describe it as metal/silver-coloured steel, not black. Colour was omitted from all fields rather than published either way.
- LAG-095681 | dimensions | none in source | conflicting | Retailer listings for this article give both 4.8 x 4.8 x 10.2 cm and 4.5 cm dia x 5.5 cm high. No dimensions published.
- LAG-095702 | source_title | `L'Atelier Du Vin` | `L'Atelier du Vin` | Casing of "Du" corrected. Note also that the manufacturer's EU site carries a separate, differently specified "Oeno Collection Silver"; contents published here are taken from the manufacturer page for Oeno Collection 3 itself.
- LAG-095610 | source_title | `Oeno Wine Bottler Opener Collection 2` | `Oeno Collection 2` | Source title garbles the official set name ("Bottler"); published under the manufacturer's name for the set. It is a 7-piece set, not a single opener.
- LAG-095647 | dimensions | none in source | conflicting | Manufacturer page gives L 9.6 in x W 3.1 in x H 1.7 in (appears to be the gift box); a retailer gives the tool as 12.5 x 3 x 1.5 cm. Not resolvable in the allotted lookups, so no dimensions published.
- LAG-095409 | ean | `null` | `3166650954098` seen on a retailer listing | Source EAN is empty and the found value is retailer-sourced only, so no EAN row was published.
- LAG-095409 | source_title | `Developer Universal alec Son Socle With its Base` | `Universal Developer and its base` | Source title contains untranslated French ("avec son socle") mis-transcribed as "alec Son Socle" and duplicated in English. Cleaned to the manufacturer's English product name.
- LAG-095464 | source_title variant | `Cast Iron` | `Wood & Chrome` (Silver & Wood) | Article 095464 is the Oeno Motion Wood & Chrome / Silver & Wood finish per two independent listings quoting the article number; "Cast Iron" is not a finish in this range. Published as Wood & Chrome.
- LAG-095464 | source_title | `095464-7` | `95464` | Source title carries a check-digit suffix form of the code. Published the manufacturer code as supplied in the `manufacturer_sku` field.
- LAG-095512 | source_title | no brand in title | `L'Atelier du Vin` added | Source title omitted the brand; added from the source `brand` field. Dimensions on the manufacturer page (L 8 in x W 7 in x H 1.8 in) appear to be the gift box, so they were not published.
- POT-L644S-214 | lens width | none in source | `59 mm` | Frame size published from retailer listings quoting model L644S (59-12-135 for colour 214, and 59 mm for the same model in colour 210). No manufacturer specification page was found; bridge and temple lengths were left out as single-source figures.
- POT-L644S-214 | source_title colour | `Brown Tortoiseshell` | `Havana` (colour code 214) | Lacoste's colour name for 214 is Havana, which is the tortoiseshell finish described. Published as "Havana tortoiseshell". `ean` is null in source, so no EAN row.
- LAC-B31AA | source_title | `Instant Filration Bottle Glass 1.1L` | `GlaSSmart` filtering bottle, 1.1 L | Typo "Filration" corrected and the manufacturer's range name GlaSSmart used. Retailer sources disagree on whether a Fast Disk filter is supplied in the box, so no box contents were published. Retailer "dimensions" (31.5 x 10.4 x 10.4 cm vs a 38.8 cm carton figure) were not published.
- LAC-F4S | source_title | `Biflux` | `bi-flux` | Manufacturer styles the range "bi-flux". Note: laica.com lists the 4-cartridge box as F4M; F4S is confirmed by several European retailers as a 4-pack (sold as 3+1) of the same bi-flux universal cartridge, so the cartridge specification is published and the pack code left as supplied.
- LAC-FD03A | filter capacity | none in source | `120 litres` per a retailer listing | Manufacturer page states only "1 filter = 1 month" and gives no litre figure, so the litre capacity was not published.
- LE-3095 | measuring range | manufacturer product page `-45 C to +200 C` | product manual `-50 C to +200 C` | The two manufacturer sources disagree. Published the figure from the product's own manual (-50 C to +200 C), which matches the retailer listings.
- LE-3095 | source_title | claims `Foldable Probe` and `Timer Function` | not confirmed | Neither the manufacturer product page nor the product manual mentions a folding probe or a timer. Both claims were dropped from the content rather than repeated. "LCD display" was also reduced to "display", which is all the manual confirms.
- LE-41520 | source_title | `Extra Large Hand Held Duster` | `Duster XL` | Published under the manufacturer's product name, with the 38 cm dusting length from the manufacturer page.
- LE-41524 | source_title | `Wall and Ceiling Broom Dusty Handheld` | `Dusty` wall and ceiling broom | Reordered to the manufacturer's naming. No width or material is stated on the manufacturer page, so neither was published.
- LE-45007 | manufacturer specification | not found | n/a | No manufacturer product page could be located for article 45007 within the research budget. Bristle material (Elaston) and the X-bristle description come from retailer listings quoting this exact article number; the handle fitting (reported by one retailer as a screw thread, unlike the Click System used on 45033) was left out as unconfirmed.


## Batch t2-b048 (tier 2)

# Discrepancy notes — batch t2-b048 (Leifheit, 18 products)

- LE-52068-FOC | manufacturer_sku | `LE-52068` | `52068` | Source put the vendor-prefixed SKU in the `manufacturer_sku` field. Published the unprefixed manufacturer article number 52068 as the model code in title, text and specifications. The `sku` key is left exactly as supplied.
- LE-52068-FOC | duplicate line | same EAN 4006501520685 and identical source_title as LE-52068 | n/a | Two catalogue lines describe the same product (one appears to be a free-of-charge line). Content written identically for both; `sku` values kept distinct as supplied.
- LE-55320 | ean | `5007411112402` | not confirmed | Check digit is valid, but the GS1 prefix sits outside the 4006501… range used by every other Leifheit line in this batch. Could not confirm against the manufacturer. Published the supplied EAN unchanged, as instructed.
- LE-55210 | source_title | `Cover &Telescopic Handle` | `Cover & Telescopic Handle` | Missing space after the ampersand. Corrected silently; title reordered for the Brand · Model · Type · Detail shape, no facts added or dropped.
- LE-51325 | source_title | `Replacement Fleece for 3-in-1 Window Cleaner with Microfibre Fleece` | `Replacement Microfibre Fleece for 3-in-1 Window Cleaner` | "Fleece" was repeated. Tidied; no facts added or removed.
- LE-52104 | source_title | `Dual-Fiber System for Deep Cleaning, Compatible with Clean Twist Systems` | `Micro Duo two-fibre; fits Leifheit Clean Twist systems` | Marketing phrasing and US spelling removed. Kept the Micro Duo two-fibre construction and the Clean Twist compatibility; dropped the unverifiable "deep cleaning" claim.
- LE-51120 | research conflict | source_title says "3-in-1", 33 cm / 28 cm and 110–190 cm / 110–200 cm quoted by different retailers | manufacturer page for article 51120 returned a "4in1 Telescopic Window Wiper and Frame Cleaner", 32 cm silicon lip, 130–210 cm handle | Sources contradict each other on the variant, wiping width and handle range. No width and no handle length published; kept the source's "3-in-1" wording. Only microfibre cover and Leifheit Click System compatibility (agreed across manufacturer and retailer listings for this article) were published.
- LE-51320 | research conflict | source_title and retailer listings for article 51320 give 28 cm hand wiper | manufacturer site page for article 51320 returned a "4in1 Window Wiper and Frame Cleaner", 32 cm | The manufacturer pages for 51120 and 51320 both resolved to the same current "4in1" product, so they could not be trusted per-article. Kept the source's 28 cm wiping width; published no other dimensions.
- LE-51522, LE-55246, LE-56671, LE-72705 | all spec fields | bare source titles only | not resolved | Web-research budget was exhausted before these could be checked. Written from the source title alone; `long_description` returned empty and specification tables limited to brand, type, model name, manufacturer code and EAN.

## Fields deliberately left empty
`long_description` is `""` for 14 of 18 lines (LE-51325, LE-51522, LE-52068, LE-52068-FOC, LE-52104, LE-55048, LE-55238, LE-55246, LE-55320, LE-56671, LE-56673, LE-72705, LE-81516, LE-81517 — 14 lines) because the source title and available research did not support two honest sections without inventing specification detail. No dimensions, weights, capacities, materials beyond those stated in the source titles, or line lengths (other than the 20 m stated in the LE-81516 source title) have been published anywhere in this batch.


## Batch t2-b049 (tier 2)

# Discrepancy notes — t2-b049

- LE-81520 | source_title | "Pegasus 200 Laundry Dryer" | Pegasus 200 Solid | Used the manufacturer's full variant name for article 81520 in the content.
- LE-81621 | ean | 9313617508625 | 4006501816214 | Supplied EAN uses a 931x (Australia) GS1 prefix; Leifheit article 81621 is listed by German retailers as 4006501816214. Published the supplied EAN as instructed and recorded the difference.
- LE-81623 | source_title | "Leifheit 81623 81621 Standing Dryer, White" | Leifheit 81623 Classic 200 Solid | The second article number in the source title is a different product (81621 is the Classic 180 Solid). Dropped it and used Classic 200 Solid, the name shown for 81623 across retailer listings. 81623 is not in Leifheit's current catalogue, so no specifications beyond the source were published.
- LE-83040 | ean | 4006501830402 | 4006501830401 | Supplied EAN fails its GS1 check digit; the valid code shown by retailers for article 83040 is 4006501830401. Published the supplied EAN as instructed.
- LE-83040 | source_title | "Rollfix 210 Wall Dryer" | Rollfix 210 Longline | Used the manufacturer's full variant name.
- LE-81620 | source_title | long multi-clause marketing title | Pegasus 160 Solid Slim | Condensed to brand, article, range and key figure; the 16 m drying length and the fold-out wings and small-item holders are confirmed on the manufacturer page.
- IT68284 | source_title | "H13 Charcoal Filter" | Active Charcoal Filter | H13 is a HEPA filter grade and does not apply to the charcoal filter; Meaco lists this item as an active charcoal filter. Dropped "H13" from the charcoal titles.
- IT68283 | source_title | "H13 Charcoal Filter" | Active Charcoal Filter | Same correction as IT68284.
- IT68282 | manufacturer_sku | "IT68282" | unresolved | The supplied manufacturer code repeats the prefixed SKU rather than giving a manufacturer part number (the sibling records supply 68284 and 68283 unprefixed). Could not confirm the unprefixed code, so the Manufacturer code row was left out rather than assume 68282.
- IT68281 | manufacturer_sku | "IT68281" | unresolved | Same issue as IT68282; Manufacturer code row omitted rather than assume 68281.
- IT68284, IT68283, IT68282, IT68281 | brand | "MeacoDry Arete®" | Meaco | MeacoDry Arete is the product range, not the brand. Recorded Brand as Meaco and Range as MeacoDry Arete; the registered-trademark symbol was dropped from display text.
- IT42177 | manufacturer_sku / ean | null | not found | No manufacturer part number or EAN supplied and none confirmable; identifier rows omitted and the listing written from the source title only.
- IT42411 | manufacturer_sku / ean | null | not found | As IT42177.
- POT-M2438S-033, POT-M2695S-017, POT-MKS638-001 | ean | null | not found | No EAN supplied; the Michael Kors site returns no results for these model codes, so no EAN row was published.

## Written from the source title alone (research returned nothing usable)

- LE-81623 (Leifheit 81623), LE-83304 (TeleClip), LE-83305 (Telegant 100) — discontinued, not in the current Leifheit catalogue.
- AP-3503 (Marchioro 3503) — no manufacturer or reputable retailer page found for the part code.
- POT-M2438S-033, POT-M2695S-017, POT-MKS638-001 — Michael Kors search returns no results for these model codes; frame shape and colour taken from the source title only, no lens/bridge/temple measurements published.
- IT42177, IT42411 (Midea JL1645T filters) — no manufacturer listing found.
- HADJ-MIE-11201150 (Miele descaling tablets) — Miele UK product page not reachable for article 11201150; pack quantity not published.


## Batch t2-b050 (tier 2)

- LAG-25-12 | manufacturer_sku | 46381 | 25-12 | SKU de-prefixes to 25-12, which resolves to a real Muela hunting knife (120 mm blade, 220 mm overall); used 25-12 as the model in text and published the supplied 46381 as the manufacturer code.
- LAG-25-12 | source_title | "Muela PRO Hunter Hunting Fishing Knife" | "Muela 25-12 Pro Hunter Hunting and Fishing Knife" | Fixed ALL-CAPS range name to "Pro Hunter" and added the model number; all source facts retained.
- POT-EV0653-301-107 | source_title | "Nike EV0653  Square Sunglasses ,Turquoise" | "Nike Swag EV0653, Turquoise" | Tidied double space and misplaced comma; added the manufacturer's model name "Swag", which is the name Nike uses for EV0653.
- POT-EV0653-502-109 | source_title | "Nike EV0653 Square Sunglasses,Royal Blue" | "Nike Swag EV0653, Royal Blue" | Tidied missing space after comma; added the manufacturer's model name "Swag" for EV0653.
- POT-EV0653-301-107 / POT-EV0653-502-109 | ean | null | not found | No EAN supplied and none confirmed; EAN row omitted from the specification tables.
- NMK-OSIO-5870 | ean | null | not found | No EAN supplied and none confirmed; EAN row omitted.
- PAWES9837Y | manufacturer_sku | PAWES9837Y | WES9837Y | Supplied manufacturer_sku carries the vendor prefix "PA"; the Panasonic part is WES9837Y (as in the source title), so WES9837Y is used in all text and in the specification table.
- TRA-400C24 | manufacturer_sku | 400C24 | TRA-400C24 | The brief lists TRA-400C24 as one of the four unprefixed SKUs that IS the manufacturer code, and the source title also uses TRA-400C24; published TRA-400C24 rather than the truncated 400C24.
- TRA-400C24 | source_title | "24 Fine Quality Oil Pastel" | "24 oil pastels per pack" | Dropped the unsupportable marketing phrase "Fine Quality"; stated the quantity as 24 pastels, not 24 colours, because the colour count is not confirmed.
- 92-QP220/55 | source_title | "Philips OneBlade QP220/50 ..." | QP220/55 | Source title model code disagrees with the supplied manufacturer_sku. Philips lists QP220/55 as a current OneBlade replaceable blade, so QP220/55 is used throughout; the supplied EAN 8710103787426 is published unchanged.
- 92-QP410/50 | source_title | "360 Shaving Blades" (plural) | pack quantity unconfirmed | The Philips page for QP410/50 is titled "OneBlade Replacement blade" without a pack count; QP420/50 is the confirmed 2-pack. No pack-quantity row published for QP410/50.
- LAG-4090001819 | source_title | "Porsche Design Roaster 3.0 Briefcase" | "Porsche Design Roadster 3.0 Briefcase" | Corrected obvious typo: the Porsche Design line is Roadster, not Roaster.
- LAG-ONY01500.001 | source_title | "Porsche Design Roaster Briefcase S" | "Porsche Design Roadster Briefcase S" | Corrected obvious typo: the Porsche Design line is Roadster, not Roaster.
- LAG-ORI05501.001 | source_title | "Roadster Expandable Bag- 21\"" | "Roadster 21-Inch Expandable Travel Bag" | Fixed spacing/punctuation around the size only; no facts added.


## Batch t2-b051 (tier 2)

- LAG-OBE09903.001 | source_title | "Porsche OBE09903.001 Desing Classic Wallet 4" | Porsche Design OBE09903.001 Classic Wallet 4, black | Corrected the "Desing" typo, wrote the brand as Porsche Design, and added the colour black, which the manufacturer's listing for this EAN confirms.
- LAG-OBE09903.001 | colour | not stated in source | Black | Colour, materials (cowhide shell, polyester lining), dimensions 20 x 110 x 95 mm, 64 g weight, four card slots, coin pocket and RFID protection all taken from the manufacturer's own page for this EAN.
- IT61601 | brand / source_title | "Breville BES058NP 58mm Naked Portafilter" with brand "Sage" | Sage, manufacturer code SES058NEU0NEU1 | Breville is the same product line sold as Sage in the UK/EU. Wrote the item as Sage and used SES058 as the model shown in the title; the full manufacturer code is published in the specification table. Stainless steel construction and Oracle / Oracle Touch / Oracle Dual Boiler / Dual Boiler compatibility confirmed on the manufacturer's accessory page for the same part.
- IT51012 | source_title | "Sage BES006UK The Steam Wand Cleaner The Steam Wand Cleaner" | the Steam Wand Cleaner | Product name was duplicated in the source title; removed the repetition. Compatible-machine list confirmed on the manufacturer's page for BES006UK.
- IT51015 | source_title | "Espresso Cleaning Tablets (8), White" | Espresso Cleaning Tablets (8) | Pack of 8, the purpose (removing coffee oils and residues from the shower screen and filter baskets) and "all Sage espresso machines" confirmed on the manufacturer's page. Colour white kept from source, unconfirmed by the manufacturer page.
- IT51013 | research | BES007UK | not found | The manufacturer product page for BES007UK could not be reached, so the listing is written from the source title alone (descaler, espresso coffee machines and kettles, 4 x 25 g). Long description left empty.
- IT51014 | product name | "ClaroSwiss" | unconfirmed | Could not reach a manufacturer page for BES008 to confirm whether the name is styled "ClaroSwiss" or "Claro Swiss", so the source spelling was kept unchanged. No filter life or compatibility published.
- IT72705 | source_title | "The Sage Organic Cleaner 12P" | Sage, the Organic Cleaner, pack of 12 | Reordered so the brand leads and expanded "12P" to a pack of 12. Nothing else about the product could be confirmed, so the long description is empty.
- IT34852 | research | EF-FA300BWEGWW | not confirmed | No manufacturer page found for this cover code within the research budget; written from the source title only (Galaxy A3 flip cover, white).
- TRA-75424 | source_title | "75 424 097" alongside manufacturer_sku 75424 | both retained | The source carries the full nine-digit article number; the six-digit manufacturer code is used in the title and both are shown in the specification table.
- TRA-77215 | source_title | "77 215 097" alongside manufacturer_sku 77215 | both retained | Same treatment as above.
- TRA-74424 | source_title | "74424097" alongside manufacturer_sku 74424 | both retained | Same treatment as above. Range name written as Horadam Aquarell rather than all-capitals in the titles.
- TRA-41202 | source_title | "Schmincke Flesh Tint 60ml Tube" | medium not stated | The source gives no range and no medium (oil or acrylic), and it could not be confirmed within the research budget, so the listing names only the colour, the volume and the format and does not state a medium.
- IT62887 | source_title | "Capriccio 6 Delux" | not confirmed | No manufacturer specification page reached for CG7115, so no wattage, carafe capacity or cup count is published; the "6" in the model name was not treated as a confirmed capacity.
- TRA-75825, TRA-23224, TRA-23111, TRA-41102 | research | Schmincke article pages | not reached | Schmincke's site returned nothing usable for these article numbers within the research budget, so each is written from its source title alone with an empty long description.


## Batch t2-b052 (tier 2)

# Discrepancy notes — batch t2-b052

- LLD-WH-6800-R | brand | Unbranded | Shimano | Source `brand` field contradicts the source title ("Shimano WH-6800-R"); published Shimano as the brand and used WH-6800-R as the model code.
- LAG-602840 | source_title | "Victorinox Architecture Urban Lomard Bad" | "Victorinox Architecture Urban Lombard" (laptop messenger bag), black | Corrected the two typos ("Lomard" to "Lombard", "Bad" to "Bag"); manufacturer/retailer listings for article 602840 confirm the Lombard mini laptop messenger in black, so the product type and colour were added.
- LAG-241682.1 | source_title | "Victorinox - Watch - 241682.1" | Victorinox I.N.O.X. Steel & Rubber, black dial, black rubber strap | Placeholder-style source title; expanded using the confirmed collection name and confirmed case/dial/strap/movement data.
- LAG-610604 | source_title | "...RFID Protection Bag Unisex – Adult, Nude, Taglia unica, Bag" | "Deluxe Concealed Security Pouch, Nude, one size" | Untranslated Italian size wording ("Taglia unica") and a duplicated type word were removed; colour and one-size retained as facts.
- LAG-5.2033.22 | product name | "Fibrox Carving Knife 22cm Wavy Edge" | Manufacturer lists the sibling article 5.2033.22B as "Fibrox Chef's Knife, 22 cm" (wavy edge) | Suffix differs, so 5.2033.22B was NOT treated as confirmation of 5.2033.22; source naming kept and no data (weight, origin, dishwasher) carried across from the B variant.
- IT74504 | product_title | "Ufesa SPLASH Ironing Board." | "Ufesa Splash Ironing Board" | Trailing full stop removed and model-name casing normalised; the code SPLASH is retained verbatim in the specifications table.
- ATH-FOUKOU-SMALL-SET+ATH-FOUKOU-MOTOR, ATH-FOUKOU-SMALL-SET-SOUVLA+ATH-FOUKOU-MOTOR | manufacturer_sku | "N/A" | none | "N/A" is a placeholder, not a part number; no manufacturer-code row emitted.
- ATH-FOUKOU-MOTOR | ean | 47151529 | (unverified) | Value is 8 digits, not a 13-digit EAN-13; published exactly as supplied per brief, but flagged as a likely incomplete barcode.
- LAG-30164101 | ean | 674204035528 | (unverified) | 12-digit UPC-A rather than an EAN-13; published exactly as supplied.

## Not confirmed by research (written from source title only)

Web-search budget for the session was exhausted part-way through, and the remaining
search hosts were blocked by egress policy. The following were written from the source
title alone, with `long_description` left empty and only source-derived specification
rows emitted:

- IT74504 (Ufesa Splash ironing board) — no dimensions, materials or board size confirmed
- ATH-FOUKOU-SMALL-SET+ATH-FOUKOU-MOTOR and ...-SOUVLA+... — set contents, dimensions and materials unconfirmed
- ATH-FOUKOU-MOTOR (GT-002BC) — battery type, torque and load rating unconfirmed
- LLD-WH-6800-R — freehub standard/speed compatibility unconfirmed
- LAG-4.0520.1, LAG-4.0548.3 — pouch dimensions and knife compatibility unconfirmed
- LAG-0.1897.J22 — tool count, blade length, scale material and edition size unconfirmed
- LAG-5.0203 — blade type, handle material and dimensions unconfirmed
- LAG-610604 — dimensions, material and card capacity unconfirmed
- LAG-30164101, LAG-605337 — dimensions, card slots and RFID status unconfirmed
- LAG-602840 — dimensions and weight found on one retailer only, so omitted


## Batch t2-b053 (tier 2)

- LAG-4.0547 | source_title / product type | "Victorinox Nylon Belt Pouch 35mm Height 125mm Lenght" | Victorinox article 4.0547 is the Leather Belt Pouch in brown, 127 x 36 x 37 mm, 33 g | source title (and its dimensions) is an exact duplicate of the 4.0547.3 record; wrote the listing as the manufacturer's Leather Belt Pouch, brown, with the manufacturer's dimensions
- LAG-4.0547 / LAG-4.0547.3 | ean | 7611160405319 supplied for both | two different articles (leather 4.0547, nylon 4.0547.3) cannot share one EAN | supplied EAN published unchanged on both, per brief; flagged for the data owner
- LAG-4.0505.L | source_title | "Victorinox Lether Belt Pouch" | Leather Belt Pouch, black, 132 x 42 x 35 mm | corrected spelling to "Leather" and added the manufacturer's colour
- LAG-4.1879 | source_title | "Neck Strap With Sap-Hook" | Neck Strap with Snap-Hook | corrected typo to the official product name
- LAG-4.0547 | source_title | "Lenght" | "Length" | typo in source; not carried into the output
- LAG-4.0547.3 | source_title | "Lenght" | "Length" | typo in source; not carried into the output
- LAG-0.9415.L24 | source_title | "Swiss Army Knife Alox Limited Edition 2024, Terra Brown" | Evoke Alox Limited Edition 2024, Terra Brown | source omits the model name; used the manufacturer's official name "Evoke"
- LAG-0.8461.MWC941 | source_title | "Swiss Army Knife, 111mm, Trailmaster Desert Camouflage" | Trailmaster Grip | manufacturer's official model name is "Trailmaster Grip"; used it, keeping the desert camouflage colourway from the source
- LAG-4.0838.4 | material | product name is "Nylon Belt Pouch" | manufacturer spec table lists the material as leather imitation | conflict between the product name and the spec field; material row omitted from the table, colour published as olive green
- LAG-4.0822.4 | colour | not stated in source | Green (listed as olive on the manufacturer page) | colour added from the manufacturer spec table
- LAG-7.8714 | country of origin | not stated in source | manufacturer page states Switzerland, a major retailer states China | conflicting; origin row omitted
- LAG-0.8271.26 | colour | "silver" | manufacturer product name is "Farmer X Alox in Silver" but its colour field reads "Gray" | published as Silver, matching the source and the official product name
- LAG-0.8271.26, LAG-0.8503.2MW, LAG-0.9415.L24, LAG-0.8461.MWC941 | weight | not stated in source | manufacturer-listed weights (109 g, 196 g, 190 g, 130 g) look higher than the bare-knife weights for these models and may include packaging | weight rows omitted from these four listings rather than risk publishing a packed weight


## Batch t2-b054 (tier 2)

- LAG-605590 | source_title | "Victoriox Werks Traveler 6.0 Toiletry Kit, Black" | Victorinox | Corrected the misspelt brand name silently in all output fields.
- LAG-4.1814 | source_title | "Victorniox Metal Chain, 2 Snap Hooks, 38 Cm" | Victorinox | Corrected the misspelt brand name and the casing of "38 Cm" to "38 cm" in all output fields.
- LAG-6.8633.26B | source_title | "Victorinox Swiss Classic Pastry Knife Wavy 26 Cm" | "Swiss Classic Bread and Pastry Knife, 26 cm" (Victorinox item 6.8633.26B, black) | Used the manufacturer's official product name, fixed "26 Cm" casing, and added the confirmed black colourway that the source title omitted.
- LAG-5.1553 | source_title | "Victorinox Swiss Classic Table Spoon, Black" | Same; manufacturer lists country of manufacture as Germany, not Switzerland | No title change. Noted because Victorinox Swiss Classic flatware is commonly assumed Swiss-made; the spoon is made in Germany and the table states that.
- LAG-611414 | manufacturer_sku 611414 | "Vx Sport EVO, Compact Backpack Scarlet Sage/Red" | Could not be resolved | No Victorinox product page found for item 611414 (611413 resolves to a "VX Sport EVO Daypack", a different article). Wrote from the source title alone; no capacity, dimensions, material or laptop size published.
- LAG-605590 | manufacturer_sku 605590 | "Werks Traveler 6.0 Toiletry Kit, Black" | Could not be resolved | No manufacturer specification page found for item 605590. Wrote from the source title alone; no dimensions, capacity or material published.
- HADJ-WB406120 | manufacturer_sku WB406120 | "Pack of 5 Classic Dustbags" | Could not be resolved | No manufacturer specification page reachable for this Wonderbag article. Wrote from the source title alone; no capacity, material or vacuum-model compatibility published.
- HADJ-WB415120 | manufacturer_sku WB415120 | "Universal Vacuum Cleaner Bag Mint Aroma" | Could not be resolved | No manufacturer specification page reachable. Source title gives no pack quantity, so no quantity row was published; wrote from the source title alone.


## Batch t3-b055 (tier 3)

# Discrepancy notes — t3-b055

- PAP-158262 | source_title | "Coconut Water Resistanse" | "Coconut, Water Resistant" | Corrected the obvious spelling error in the content; also noted this is the only Cabana Sun line with no volume in the source, so no size is published for it.
- PAP-158261 | source_title | "Cabana Sun CABANA Deep Tanning Dry Oil Spray SPF15" | "Cabana Sun Deep Tanning Dry Oil Spray SPF15" | Removed the duplicated brand token and fixed the ALL-CAPS repeat.
- PAP-158260 | source_title | "Cabana Sun CABANA Deep Tanning Dry Oil Spray SPF6" | "Cabana Sun Deep Tanning Dry Oil Spray SPF6" | Removed the duplicated brand token and fixed the ALL-CAPS repeat.
- PAP-158257 | source_title | "Cabana Sun CABANA Deep Tanning Oil Spray SPF6" | "Cabana Sun Deep Tanning Oil Spray SPF6" | Removed the duplicated brand token and fixed the ALL-CAPS repeat.
- PAP-211587 | source_title | "105G" | "105 g" | Unit casing and spacing normalised; net weight published as 105 g.
- BN-0911 | category | "Waste, Bags & Air Care > Insecticides & Pest Control" | "Cleaning Chemicals > Multi-Surface Cleaners & Disinfectants" | Source title describes a concentrated antibacterial multi-surface cleaner, not an insecticide. Content written to the title, not the category; no pest-control claim made. Category field itself left as supplied (not an output field).
- BN-0880 | brand | "Bien" | Title brand reads "Bienclair" | Published "Bienclair" as the product/range name in the titles and as a Range row; Brand row kept as the supplied "Bien". Unverified whether Bienclair is a separate brand or a Bien sub-range.
- BN-1796 | brand | "Bien" | Title brand reads "Bientoll" | Same treatment: "Bientoll" used as the range name in titles and a Range row, Brand row kept as "Bien".
- BN-0539 | brand | "Bien" | Title brand reads "Bientoll" | Same treatment as BN-1796.
- BN-1703 | brand | "Bien" | Title brand reads "Bientoll" | Same treatment as BN-1796.
- BN-1604 | source_title | "Alcohol Lotion Spray 99.99% 4lt" (no brand in title) | Brand "Bien" from the source brand field | Brand prefixed to the title from the supplied brand field. The "99.99%" is ambiguous (alcohol strength vs a kill-rate claim), so it is carried verbatim in the name only and NOT published as a specification row.
- BN-AUTO-AEROSOL-MACHINE | source_title | "Auto Aerosol Dispenser" (no brand, no model) | Brand "Bien" from the source brand field | Brand prefixed from the supplied brand field. No model code, capacity, power source or dimensions available, so those rows are omitted.
- BN-AUTO-SPRAY-DISPENSER | source_title | "Dispenser Automatic with Sensor for Spray / Gel" (no brand, no model) | Brand "Bien" from the source brand field | Brand prefixed and word order tidied. No model code, capacity, power source or dimensions available, so those rows are omitted.
- BN-1581 | source_title | "BleachGel" | "Bleach Gel" | Spacing fix only; the stated 3% is published as "Stated strength" because the source does not say what the 3% refers to.
- BN-1598 | source_title | "BleachGel" | "Bleach Gel" | Spacing fix only; 3% published as "Stated strength" for the same reason.
- BN-1178 | source_title | "Chlorine 3%" | published as "Stated strength: 3%" | The source does not identify the active (sodium hypochlorite content vs available chlorine), so the figure is published as stated strength without an active-ingredient claim.
- BN-0263 | source_title | "Concentrated Plates Washing Liquid" | "Concentrated Dishwashing Liquid" | Awkward wording tidied to the supplied product_type; no change of meaning.
- BN-1383 | source_title | "Concentrated Plates Washing Liquid" | "Concentrated Dishwashing Liquid" | Same tidy as BN-0263.
- BN-0416 | source_title | "0.75L" | "750 ml" | Volume expressed in millilitres for consistency; same value.
- BN-1017 | source_title | "0.4L" | "400 ml" | Volume expressed in millilitres for consistency; same value.
- Multiple (BN-*) | source_title | "4 lt" / "4lt" | "4 L" | Litre abbreviation normalised across all affected Bien lines; no value changed.


## Batch t3-b056 (tier 3)

# Source-data discrepancies — batch t3-b056

- HC-1061-S | manufacturer_sku | 061-S | 1061-S | Every other record in this batch has manufacturer_sku equal to the SKU with the `HC-` prefix removed (HC-1201B/1201B, HC-1621/1621, HC-1071/1071). Treated the missing leading `1` as a typo and published `1061-S` as the manufacturer code.
- HC-1201B | source_title | `150'` | 150 sheets per box | Read the trailing apostrophe as a count marker (the same shorthand used in "20's" and "80's" elsewhere in this batch) and published it as 150 sheets per box.
- HC-1161B | source_title | `33x33` (no unit) | 33 x 33 cm | Unit not stated in this title; taken from the identical white variant HC-1161, whose title reads "33 x 33 cm". Spacing also normalised.
- HC-1161B | source_title | `2ply` | 2-ply | Casing/spacing tidied only.
- HC-1721 | product_type / category | "Liquid Soap" (Hand & Body Hygiene > Liquid Soaps) | Liquid soap dispenser | The source title describes a wall-mounted refillable dispenser, not soap. Content written as a dispenser; the supplied category and product_type were left unchanged as they are not output fields.
- SHO-HB298A14-PO3 | ean | 4716873849146 | identical to the single-bottle SKU SHO-HB298A14 | A 3-pack should not share the single-unit EAN. Published the supplied EAN unchanged as instructed; flagging for the data owner.
- SHO-HB298A14 / SHO-HB298A14-PO3 | brand | "Hobot" | HOBOT | Brand casing corrected silently in the content to match the form used in the source title.
- HC-1102 vs HC-1105 | source_title | "Elite Professional White Napkins 1-Ply 28x28 cm ..." / "Elite White Napkins 1-Ply 28x28 cm ..." | two distinct SKUs, near-identical descriptions | The only stated difference is the "Professional" range word. Kept that distinction in the content; possible duplicate listing worth checking.
- HC-1841 | source_title | `20's x30` | 30 packs of 20 wipes | Read as 30 packs of 20; total of 600 wipes stated as arithmetic from the source figures only.
- HC-1503 / HC-1506 | source_title | "260m" / "180m" | published as "Length" without qualifying per-roll or per-pack | The titles do not say whether the metreage is per roll or per pack, so the row is labelled neutrally rather than guessing.
- HC-1623L | manufacturer_sku | null | not supplied | No manufacturer code or EAN available; identifier rows omitted rather than inferred from the sibling HC-1623.
- Batch-wide | manufacturer_sku / ean | null on 24 of 40 records | not supplied | Identifier rows were omitted from those tables rather than filled. Ply, sheet count, dimensions, wattage-equivalent headline specs and material were only published where the source title states them; no defaults were assumed (e.g. no ply stated for HC-1492, HC-1121, HC-1623, HC-1623L, so no ply row).


## Batch t3-b057 (tier 3)

# Discrepancy notes — t3-b057

Tier 3: source-only, no web research. All entries below are inconsistencies visible within the
supplied source data itself (title vs. sku vs. brand vs. ean), not research findings.

- ATH-NES-CLAS-200G-PO2 | brand | Nescafe | Nescafé | Corrected brand spelling to the accented official form in all customer-facing text; source record left untouched.
- ATH-NES-CLAS-DECAF-200G | brand | Nescafe | Nescafé | Corrected brand spelling to the accented official form in all customer-facing text.
- ATH-NES-CLAS-2.7KG | brand | Nescafe | Nescafé | Corrected brand spelling to the accented official form in all customer-facing text.
- ATH-NES-CLAS-200G | brand | Nescafe | Nescafé | Corrected brand spelling to the accented official form in all customer-facing text.
- VE-10010002 | brand | Nescafe | Nescafé | Corrected brand spelling to the accented official form in all customer-facing text.
- ATH-NES-CLAS-700G | brand | Nescafe | Nescafé | Corrected brand spelling to the accented official form in all customer-facing text.
- ATH-NES-COLOMBIA-100G | brand | Nescafe | Nescafé | Corrected brand spelling to the accented official form in all customer-facing text.
- ATH-NES-CLAS-2.7KG | sku vs source_title | sku says 2.7KG, title says 2.75 Kg | 2.75 kg | Published the title figure (2.75 kg); sku left exactly as supplied. Weight not independently verifiable without research.
- ATH-NES-CLAS-200G-PO2 | ean | 5201219046154 (on the 2-pack) | same EAN also supplied for the single 200 g unit VE-10010002 | Published the supplied EAN unchanged on both, per brief. Flagged: a multipack normally carries its own EAN, so one of the two records is likely wrong.
- ATH-NES-CLAS-200G | ean | null | not established | Left the EAN row out of the table. This SKU is the same described product as VE-10010002, which does carry an EAN.
- PAP-211337 | source_title | "5301 Nickelodeon Paw Patrol Bath Bomb, Chase, 165g" | "Nickelodeon Paw Patrol Chase Bath Bomb, 165g" | Removed the stray leading "5301" — it is the tail of the supplied EAN (5903957305301), not part of the product name.
- ATH-NOUNOU-LIGHTx50 | pack quantity | sku says x50, source_title says x10 | 10 | Published pack of 10 from the title; sku left exactly as supplied. The two disagree and cannot be resolved from source alone.
- ATH-NOUNOU-LIGHTx50 | source_title | "Evapore" | "Evaporated" | Corrected an apparent typo for the product descriptor "evaporated milk".
- PAP-5527 | brand | "SO..." | "SO...?" | Used the fuller brand form that appears in the source title itself.
- PAP-5527 | product form | not stated | not established | The source gives only variant and volume; no product form (spray, mist, wash, etc.) stated, so none was written. Table and features carry variant and volume only.
- ATH-SKEWERS-11PACK | source_title | "w\ Wooden Handles" | "with Wooden Handles" | Expanded the mangled abbreviation.
- ATH-SKEWERS-11PACK | source_title | "for the bLUE Cypriot BBQ" | uninterpretable token | Kept "Cypriot BBQ" and dropped the token "bLUE" — its meaning (colour, brand or typo) cannot be determined from source. Flagged rather than guessed.
- PAP-171597 | source_title | "Fresh Home Mountain Air Fragrance" | "Fresh Home Mountain Air" | Dropped the trailing word "Fragrance" as a descriptor, keeping range and fragrance name; recorded in the table as Range = Fresh Home, Fragrance = Mountain Air.
- CSOL-PCU12DW-BLACK | brand | null | none established | No brand stated anywhere in the source; the Brand row was omitted rather than guessed.
- CSOL-PCU4-BLACK | brand | null | none established | No brand stated in source; Brand row omitted. Wall construction also unstated (only the 12oz and 8oz records say double wall), so no wall type was published.
- CSOL-PCU8DW-KRAFT | brand | null | none established | No brand stated in source; Brand row omitted.
- TRA-A3M80 | brand | null | Multioffice | Brand taken from the source title, where "Multioffice" appears as the product name.
- TRA-A3M80 | paper weight | "80gr" | "80 gsm" | Corrected the unit: paper substance is grams per square metre, not grams.
- ATH-A4-PAPER | brand | null | not established | "Brilliant" in the title may be a brand or a descriptor; recorded as product Name in the table rather than asserted as a brand.
- IT41404 | source data | title gives size and sheet count only | no brand, weight or colour | Table limited to size and sheet count; no paper weight or colour published.
- ATH-ALCOHOL-1LT | alcohol strength | not stated | not established | No percentage published. Trade buyers will need the strength confirmed before listing.
- Antibacterial-Surface-Cleaner-750ml | brand | null | none established | No brand in source; Brand row omitted.
- HADJ-BRO-67488 | brand | null | Broil King | Brand taken from the source title. Source title was ALL CAPS; casing normalised.
- HADJ-BRO-876983 | brand | null | Broil King | Brand taken from the source title. ALL CAPS normalised and the ™ symbol dropped from the Baron name for display.
- BRO-60009 | brand | null | Broil King | Brand taken from the source title; ALL CAPS normalised.
- AMZ-DE-B0D5CSR6B1 | brand | null | none established | No brand in source title; Brand row omitted. Capacity, style and removable bag published from the title only.
- CHM-2501202 | dimensions | "45cm X 100cm" | published as supplied | Published exactly as given, but flagged: a baking paper roll with a cutter is more usually 45 cm x 100 m, so the second figure may be a unit error in the source. Not corrected — no research permitted at this tier.
- Beige-Bags-49x55 | pack quantity | not stated | not established | Size and colour published; no pack/roll quantity, gauge or material published.
- Blue-Bags-75x80 | pack quantity | not stated | not established | Size and colour published; no pack/roll quantity, gauge or material published.
- CHM-AGAPAP305 | material | not stated | not established | Length, colour and pack quantity published; stirrer material (plastic, wood) not stated in source, so omitted.
- ATH-BORBONE-CLASSIC-COFFEE-BEANS-1KG | brand | null | Borbone | Brand taken from the source title.
- ATH-BORBONE-CLASSIC-COFFEE-BEANS-1KG | manufacturer_sku | "BORBONE-CLASSIC-COFFEE-BEANS-1KG" | not a manufacturer code | Not published. It is the internal sku with the vendor prefix stripped, so publishing it would expose the sku; no Manufacturer code row emitted.
- ATP-BOSCH-00312453 | brand | null | Bosch | Brand and manufacturer code 00312453 taken from the source title.
- ATH-LAIKO-GOLD200-PO3 | brand | "Laiko Kafekoptio" | published as supplied | Kept as supplied in the table; the title uses the short form "Laiko" that the source title itself uses. The spelling of "Kafekoptio" could not be checked at this tier.
- ALL 40 SKUs | long_description | source titles only, no research permitted | "" | Left empty throughout. At this tier every attribute the titles encode is a specification and belongs in the table; writing two prose sections would have meant either restating the table or inventing content.


## Batch t3-b058 (tier 3)

# Source-data discrepancies — t3-b058

- SB-LC3259XLBKP | source_title model code | `Brother LC3219XL BK` | `LC3259XL` | Title model code conflicts with the internal code and with both sibling records (LC3259XL Cyan, LC3259XL Magenta); treated as a source typo and published as LC3259XL.
- SB-LC3213VALBP | source_title `400P` | `400P` | `400 pages` | Read `400P` as the 400-page yield and published it as a page-yield spec row; not independently confirmed (Tier 3, no research).
- ATP-GAS-HOSE-50M | length (sku vs title) | sku implies `50M`, title says `40m` | `40 m` | sku left untouched; content published as 40 m from the source title. Length should be confirmed with the supplier — the two source signals disagree.
- LAG-095015 | brand | `Chef Sommelier` (in title, brand field null) | `Chef & Sommelier` | Brand spelling corrected silently in content.
- IT30236 | brand | `Delonghi` | `De'Longhi` | Brand casing/apostrophe corrected silently in content.
- IT28324 | brand | `Delonghi` | `De'Longhi` | Brand casing/apostrophe corrected silently in content.
- CSOL-ROI-5641-KRAFT | source_title spelling | `Paper Bοx` (Greek omicron U+03BF) | `Paper Box` | Character corrected silently in content.
- CSOL-CUT3:1VV-CLEAR | source_title notation | `3:1` | `3-in-1` | Normalised to match the sibling wooden set (`3-IN-1`); assumed to denote the same 3-in-1 configuration.
- ATH-FOUKOU-BIG-SET | manufacturer_sku | `N/A` | (none) | Placeholder value, not a real code; no manufacturer-code row published. EAN published as supplied.
- XXM-ELECTRIC-MOTOR | manufacturer_sku | `XXM-ELECTRIC-MOTOR` | (none) | Value is identical to the internal sku, so it is not a manufacturer code; omitted from all output text per the no-sku-in-text rule. EAN published as supplied.
- SH-0246519 | dimensions unit | `165x38x76` | `165 x 38 x 76` (unit absent) | No unit given in source; published unitless rather than assuming cm. Needs supplier confirmation.
- AMZ-DE-B07KB4WBPC | label size unit | `26 x 12 Size` | `26 x 12` (unit absent) | No unit given in source; published unitless rather than assuming mm.
- MEGP-3030268 | roll width unit | `1.5 X 150 m` | `1.5 m` width, `150 m` length | Unit `m` read as applying to both figures in the source title.
- HADJ-BRO-64003 | brand field | `null` | `Broil King` | Brand taken from the source title and published.
- BRO-876653 | brand field | `null` | `Broil King` | Brand taken from the source title and published.
- SB-LC3213VALBP | brand field | `null` | `Brother` | Brand taken from the source title and published.
- SB-LC3259XLBKP | brand field | `null` | `Brother` | Brand taken from the source title and published.
- SB-LC3259XLCP | brand field | `null` | `Brother` | Brand taken from the source title and published.
- SB-LC3259XLMP | brand field | `null` | `Brother` | Brand taken from the source title and published.
- AMZ-DE-B09KNQL782 | brand field | `null` | `Campingaz` | Brand taken from the source title and published.
- COMPU-PG540XL | brand field | `null` | `Canon` | Brand taken from the source title and published.
- LAG-095015 | brand field | `null` | `Chef & Sommelier` | Brand taken from the source title and published.
- ATP-EPLB144XL | brand field | `null` | `DMP` | Brand taken from the source title and published.
- IT30236 | brand field | `null` | `De'Longhi` | Brand taken from the source title and published.
- IT28324 | brand field | `null` | `De'Longhi` | Brand taken from the source title and published.
- AMZ-DE-B07KB4WBPC | brand field | `null` | `Ferlabel` | Brand taken from the source title and published.
- 3G-088-015-04-001/0 | brand field | `null` | `Fissler` | Brand taken from the source title and published.
- CSOL-FC04-1012 / CHM-AGPAP040 | duplicate specification | both `4oz espresso / Cyprus coffee paper cup, x50` | (unchanged) | Two records from different vendor prefixes describe an identically specified item; titles differentiated by wording only. Worth checking whether these are genuinely distinct lines.


## Batch t3-b059 (tier 3)

# Source-data discrepancies — t3-b059

- COMPU-CF226XC | source_title | "HP 26A Black Compatible LaserJet Toner Cartridge, CF226X" | HP CF226X | Source title is self-contradictory: 26A and CF226X are different cartridges (26A = CF226A, standard yield; CF226X = the high-yield code). Kept the explicit model code CF226X and dropped the conflicting "26A" designation rather than assert either yield. Needs supplier confirmation of which cartridge is actually stocked.
- COMPU-EPSON103B | brand | "EPSON" (all caps, brand field null) | Epson | Brand field was empty; brand taken from the title and set to the manufacturer's own casing, "Epson".
- AMZ-DE-B07F6BLKVT | brand | "ISOTRONIC®" (all caps with symbol, brand field null) | Isotronic | Brand field was empty; brand taken from the title, registered-trademark symbol and all-caps styling removed for the listing text.
- AMZ-DE-B0FQQVSL7F | source_title | 'SAE 16" Inlet and SAE 12" Outlet' | SAE 16 inlet / SAE 12 outlet | The inch marks are a source error: SAE 16 and SAE 12 are SAE port dash sizes, not 16-inch and 12-inch ports. Published as SAE 16 / SAE 12 with no unit.
- NMK-001037 | source_title | "KALOC L600" (all caps) | Kaloc L600 | Brand casing normalised to Kaloc; brand field was empty and has been populated from the title.
- NMK-000955 | brand | brand field null, "Kaloc" only in title | Kaloc | Brand populated from the title. Screen range 32''-55'' rewritten as 32-55 inch.
- ML-11201280 | brand | brand field null, "Miele" only in title | Miele | Brand and manufacturer code 11201280 taken from the title; both published.
- MT-6C3Z1NE | brand | brand field null, "HP" only in title | HP | Brand populated from the title; supplied manufacturer_sku 6C3Z1NE published as the manufacturer code.
- MT-2Z8P4AA | manufacturer_sku | null | not published | The string 2Z8P4AA appears only inside the internal `sku`, so it has not been used anywhere in the text; the listing carries no manufacturer code.
- ATH-MICROFIBER-CLOTHES-4PCS, ATH-MICROFIBER-CLOTH-MYREON | source_title | "Microfiber" | "Microfibre" | US spelling normalised to UK spelling for a UK trade store. "Clothes" in the SKU is a typo for "cloths"; SKU left untouched, listing text uses "cloths".
- CSOL-ICPC8-TANI | source_title | "Ice Cream Paper Cup 8oz, Colour x50" | Coloured | "Colour" read as the coloured/printed variant (the sibling SKU is explicitly White). No specific colour is stated in the source, so none has been published — only "Coloured".
- CSOL-DL92-FATIM, CSOL-DLL-PP/SOMO(O) | source_title | "(O)" marker | omitted | The "(O)" suffix is unexplained in the source. It most likely marks the with-hole variant, given the sibling "NO HOLE" SKU, but that is not stated, so the marker has been dropped rather than interpreted. Worth confirming with the supplier.
- CSOL-DLL-PP/SOMO(O), CSOL-DLL-PP/NO/SOMO | material | "PP" appears only in the internal SKU | not published | Material not stated in either source title, so no material row was published, unlike the two salad-bowl lids where "PP" is in the title.
- CW-NAVIGATOR80GA3-R | source_title | "80g" | 80 gsm | Copy-paper weight expressed as grammage; published as 80 gsm.
- Green-Bags-85x110, Green-Bags-48x52 | pack quantity | absent | left empty | No pack or roll quantity is stated in either source title, so no packaging row was published. Both are sold by size only in the source data.
- ATH-GLOVES-100PCS | source_title | "Gloves Assortment 100pcs" | left as assortment | No material, size or grade is stated (nitrile/vinyl/latex, powdered or not, sizes in the assortment). Nothing has been inferred; the table carries only type and pack quantity.
- ATH-DK-TOTAL-ACTION-400ML | source_title | "Insecticide Odorless 400ml" | Odourless insecticide, 400 ml | US spelling normalised. Format (aerosol, trigger spray, concentrate) and target pests are not stated in the source, so neither has been published. The SKU implies a "Total Action" product name, but that is internal and unverified, so it was not used.
- CSOL-NOODL26-ROUND | source_title | "Noodle Box Round 26cm" | published as size 26 cm | The source does not say whether 26 cm is a diameter, a height or a capacity-equivalent label, so the row is labelled "Size" rather than "Diameter". Material is not stated and was not published.
- CHM-FLPP | source_title | "Lid Flat PP 95mm" | published as lid size 95 mm | Almost certainly a diameter, but the source does not say so; the row is labelled "Lid size" to avoid asserting it.
- Microfibre-Mop, Mopping-Bucket | source_title | bare two-word titles | left minimal | No brand, size, capacity, colour or head type is given. Titles could not be brought into the 50-80 character target without inventing attributes, and long_description has been left empty for both.
- All 40 records | ean | null | left empty | No EANs were supplied for any product in this batch, so no identifier rows carry an EAN.
- Tier 3 constraint | — | — | — | No web research was performed on this batch. Every published fact comes from the supplied title, brand, category and product_type fields. long_description is empty for 37 of 40 products because the source titles do not support two honest sections.


## Batch t3-b060 (tier 3)

# Discrepancy notes — t3-b060 (40 products)

Tier 3: source-only, no web research. No product in this batch supplied a brand, EAN or
manufacturer code (one exception, noted below), so no manufacturer confirmation was possible
and all content is derived from the source title, category and product type alone.

## Source-data discrepancies and corrections

- CSOL-PBA9.5*18GRPR | dimensions | title "7x18" vs internal code "9.5*18" | unresolved — the two disagree | published the title value (7 x 18 cm); the code is internal and could not be verified. Needs supplier confirmation before the size is relied on.
- CSOL-RCB1527 | source_title | "Aluminum" | "Aluminium" | corrected spelling to UK English in all content.
- CHM-PS35 | source_title | "Desert Cup" | "Dessert Cup" | corrected obvious typo in all content.
- CSOL-GPI955-GREAT | source_title | "Pet Square Container" | "PET Square Container" | corrected casing of the material name (PET) in all content.
- CSOL-PP500-PRATICO | source_title | "PRATICO" (all caps, trailing) | "Pratico" | casing corrected and moved to the front of the title. Recorded in the table as "Range", not "Brand" — the source brand field is null and it could not be confirmed as a manufacturer name.
- ATH-ECO-TAYG-WASTE-BIN-100L | brand | null (internal code contains the token "TAYG") | not published | brand left empty; a token inside the internal code is not a confirmed brand, and no research was permitted to verify it.
- CSOL-SW12SO-BLACK | colour | internal code contains "BLACK"; the title states no colour | not published | no colour row or claim published; the title is the only publishable source.
- CSOL-PBH281729-M | size code | internal code contains "-M"; the title states no size letter | not published | no size row, unlike CSOL-PBH261231-S whose title does state "S".
- Pink-Bags-42x50 | product_type | title says only "Pink Bags" | "Pink Bin Bags" | used the supplied category/product type (Bin Bags & Refuse Sacks / Bin Bag) to name the item.

## Assumptions made explicit (units not stated in source)

- All paper bag / carrier bag dimensions | unit | unstated in these titles | cm | cm applied, on the evidence of sibling records in the same batch that do state the unit ("16.8*9.7*6cm", "9''-23cm", "42x50cm"). Flag if any supplier uses mm.
- CP-PAPER-ROLL-80X63-44M | roll size | "80x63", unit unstated | mm | published as "80 x 63 mm" (standard thermal-roll width x diameter notation). "44m" was stated in metres in the source.

## Duplicate / overlapping records (not errors, flagged for the catalogue)

- CHM-008884 and CHM-PAPERFS | source_title | both "Paper Freddo Straws x500" | identical | two SKUs with identical specifications; content is therefore identical. Possible duplicate listing.
- CHM-AHCAR170 and CSOL-PBH281729-M | source_title | "Paper Bags with Handles (28x17x29) x250" and "Paper Bags with Handles 28x17x29 x250" | same specification, different vendor codes | content is therefore near-identical. Possible duplicate listing.

## Fields deliberately left empty

- long_description | all 40 products | "" | these are bare-title commodity items with no brand, model or datasheet. Two honest sections could not be written without either inventing specifications or restating the specification table in prose, both of which the brief prohibits.
- Brand, EAN and manufacturer code rows | 39 of 40 products | omitted from the specification tables — the source supplies null for all three. CSOL-PET18-FATIM is the only product with a manufacturer_sku ("PET18-FATIM"); it is published in the title and in an Identifiers row.
- product_title length | many products fall below the 50–80 character target (shortest 24 characters) | with no brand and no model code, the target could not be reached without adding words the source does not support. Accuracy was kept over length.
- CSOL-PBH261231-S and CP-PAPER-ROLL-80X63-44M | pack quantity | absent from the source titles | no Packaging row published.


## Batch t3-b061 (tier 3)

- CHM-AACUT330 | source_title | "Spoon Desert x100" | "Dessert Spoons" | Corrected the obvious spelling error ("Desert" to "Dessert") in all customer-facing text; no facts added.
- PHIL-030029/P94 | source_title | "Stretch Film For Palettes 23m" | "Pallet Stretch Film 23m" | Corrected "Palettes" to "Pallets"; film length, colour and application published as supplied.
- COMPU-COPYROLL-9600-SINGLE | source_title | "610mm X 50mm 60G" | length not established | 610mm width and 60gsm published; the "50mm" second dimension is implausible as a roll length (almost certainly 50m) but is not confirmable at this tier, so no length row was written.
- CSOL-WFRP17-1, CSOL-WFRP23-1 | source_title | "Wood Fiber" | "Wood Fibre" | UK spelling normalised for the storefront; material otherwise unchanged.
- CSOL-SS5220-1/1COLOR | source_title | "COLOR" (all caps) | "Coloured" | Casing fixed. The source names no specific colour, so the table records only "Coloured" rather than naming one.
- CSOL-RUSS5200-1/1BLACK, CSOL-RUSS4180-1/1BLACK, CSOL-RUSS7220-1/1BLACK | source_title | "BLACK" (all caps) | "Black" | Casing fixed only.
- CSOL-SO416H | source_title | "Rectangle Clear Cont. Pet 375cc" | "Rectangular Clear PET Container 375cc" | Expanded the abbreviation and corrected the casing of the material code PET.
- CHM-CUT3FKNR | product_type / category | "Disposable Cutlery" | title states "Reusable" | Source category and title conflict. Followed the title and described the item as reusable; the category value was left untouched and no disposable/single-use claim was made.
- CHM-CUT3FKNR | specifications | "3-IN-1 Set" | components not stated | The source does not name the three pieces in the set, so no contents row and no "What's in the box" section were written.
- CHM-20212 | source_title | "Professional Espresso Cleaner 900g" | "Professional Espresso Machine Cleaner" | Added the "machine" qualifier supported by the supplied category (Descalers & Cleaning Tablets). Product form (powder, tablet or liquid) is not stated in the source, so it is not published.
- CSOL-PBASOS-C | source_title | "(21.5x12x30)" | "21.5 x 12 x 30cm" | Dimensions are given without units; cm applied in line with the rest of the feed. Dimension order (W x D x H) is not stated, so the row is labelled "Size" only.
- CSOL-PBASOSvv251734 | source_title | "(25x17x34)" | "25 x 17 x 34cm" | As above.
- CSOL-PBASOSvv251734 | sku | "CSOL-PBASOSvv251734" | stray "vv" before the size digits | Left exactly as supplied; the sku is never altered and never appears in text.
- CSOL-SAU120SO | source_title | "x10" | pack quantity not verifiable | A pack of 10 is unusually small against the comparable sauce cups in this batch (x50, x90). Published exactly as supplied; flagged here for the data owner to confirm.
- CSOL-PLUGIN-STR12-BLACK | colour | "BLACK" present in the internal sku only | not published | The source title states no colour. Because the internal sku must never appear in customer text and its colour token is unconfirmed, no colour was published.
- CSOL-T42KRAFT-1*10KG, CSOL-T8KRAFT-1*10KG | source_title | "with Aluminium" | form of aluminium not stated | The source does not say whether the aluminium is a lining, a lid or a laminate, so the material is recorded plainly as "Kraft paper with aluminium". The "1*10KG" element of the internal code was not published.
- CSOL-DP375/CSOL-DPLID, CHM-AGPAP950/AGPAP951, CHM-AGPAP952/AGPAP953 | sku | composite codes joining a base item and its lid | no manufacturer code published | These are internal composite references, not manufacturer part numbers, so no Manufacturer code row was written.
- ATP-SRG-GAS-REGULATOR | brand | null | "SRG" | Brand field is empty but the source title carries the name SRG; published as the brand. No pressure, outlet, thread or gas-type data is stated in the source, so none is published.
- MPM-2FCSP064 | brand | null | "Swatch" | Brand taken from the source title. No model name, collection, case size, movement or strap material is stated, so the listing carries only what the title supports.
- VAS-VARIOUS-CAPSULES | source_title | "Various Nespresso Capsules" | contents not established | The source does not say whether these are Nespresso-branded or Nespresso-compatible capsules, nor which blends, roast levels or quantities are included. Published as an assorted Nespresso capsule selection with no variety, roast or count claims.
- CHM-PAPERDOML | specifications | "Safety Paper Dome Lid" | cup diameter not stated | No cup size or rim diameter is given, so no compatibility row was written.
- Sponge-Cloth-Large, ATH-SPONGES-PACK, ATH-TOILET-BRUSH, Transparent-Bags-25x38 | specifications | pack quantity absent from source | not established | Quantity per pack is not stated for these lines; no pack quantity row was written and no count was implied in the text.
- CSOL-PL9/30-GPI | source_title | "Plates 9\"" | "9 inch" | Imperial size published as supplied; no metric conversion added, and no material is stated in the source so no material row was written.
- All SKUs except LAG-6.0963.1 | ean | null | not established | No EAN supplied and no research permitted at this tier; EAN rows omitted rather than guessed.
- All SKUs except LAG-6.0963.1 and CSOL-RUSS4180-1/1BLACK | manufacturer_sku | null | not established | No manufacturer code supplied; identifier rows omitted.
- All SKUs except AMZ-DE-B0DJ9SYLMJ | long_description | bare commodity titles | "" | These titles support only the attributes already carried by the table, features and short description. Long descriptions returned empty rather than padded with unverifiable prose. The Spigen case is the one line whose source title states enough distinct facts (kickstand, MagSafe compatibility, protection rating) to support two honest sections.
- All SKUs | long_description | "What's in the box" | omitted | No source line confirms accessories or multi-part contents, so the section was omitted throughout.


## Batch t3-b062 (tier 3)

- CSOL-WCUT3(100) | source_title | "Wooden Cutlery Set 3-IN-1 Set x100" | "Wooden Cutlery Set 3-in-1" | Removed the duplicated word "Set" and corrected casing of "3-IN-1"; no facts added or dropped.
- CHM-CUT3W | source_title | "Wooden Cutlery 3-IN-1 Set x100" | "Wooden Cutlery 3-in-1 Set" | Corrected casing of "3-IN-1" only.
- CSOL-WSTR14-1/1(200) | brand / ean / manufacturer_sku | null | not established | No brand, EAN or manufacturer code supplied and no research permitted at this tier; identifier rows omitted from the table rather than guessed.
- CHM-CUT3W | brand / ean / manufacturer_sku | null | not established | As above; identifier rows omitted.
- CSOL-WCUT3(100) | brand / ean / manufacturer_sku | null | not established | As above; identifier rows omitted.
- CSOL-WSP14(100) | brand / ean / manufacturer_sku | null | not established | As above; identifier rows omitted.
- CHM-AACUT510 | brand / ean / manufacturer_sku | null | not established | As above; identifier rows omitted.
- CHM-CUT3W, CSOL-WCUT3(100) | specifications | "3-IN-1 Set" | contents not stated | Source does not name the three components of the set, so no contents row was written and no "What's in the box" section was used.
- CSOL-WSTR14-1/1(200) | specifications | "Wrapped" | wrapping format not stated | Source does not say whether stirrers are individually or bulk wrapped; recorded simply as "Wrapped".
- All five SKUs | long_description | bare commodity titles | "" | Titles support only the attributes already in the table and features; returned empty rather than padding with unverifiable prose.


## Batch t4-b063 (tier 4)

- Logistic-Services | source_title | "MASQ Logisitc Services" | "MASQ Logistic Services" | corrected the misspelling of "Logistic" in the title; sku left unchanged
- EL-LCS-CSVA-W | source_title | "Sony" | "Sony LCS-CSVA-W" | source title is a bare brand name with no product description; used brand plus the supplied manufacturer_sku as the only defensible title. No research performed (Tier 4), so what the item is remains unconfirmed
- EQP-Service-Repair | source_title | "Equipment Service/Repair" | "Equipment Service & Repair" | punctuation tidied only; no facts added or removed
- Shipping-Outbound | ebay_title | "Shipping Cost (Outbound)" | "Shipping Cost Outbound" | brackets dropped in the eBay title per the minimal-punctuation rule; product_title keeps the source form
- Delivery-Installation, EQP-Service-Repair, Shipping-Outbound, Various-Equipment, VGN-STICKERS | brand | null | (none) | no brand supplied and none inferred; titles written from source_title alone
- All 7 | ean, manufacturer_sku | null (except EL-LCS-CSVA-W manufacturer_sku) | (none) | no identifiers available, so specifications left empty as required for non-merchandise lines
