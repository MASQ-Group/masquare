# MASQUARE product content — checkpoint

**Status: 1,086 of 1,174 products complete and validated. 88 outstanding.**

Stopped on request mid-run. Everything below is finished work, safe to review. Nothing here is
provisional except where marked.

## Files

| File | What it is |
| :--- | :--- |
| `masquare-product-content.json` | The deliverable. 1,086 products, six fields each, keyed on `sku`. |
| `outstanding-skus.json` | The 88 SKUs still to write. |
| `source-data-discrepancies.md` | ~220 KB of source-data problems found while researching. Read this. |
| `content-generation-brief.md` | The controlling spec every batch was written against. |
| `validate-content.py` | The mechanical validator. Run it against any batch before import. |

## What is outstanding

88 products across 6 batches: `t1-b030` … `t1-b035`. All tier 1 (full research), all in the back
half of the alphabet by brand — Ufesa, Victorinox, Wahl, Whirlpool, Wilson, Wood's and the remaining
TP-Link and TCL lines.

To resume: the batch inputs and prompts are regenerable from the catalogue CSV and the tier rules in
the brief. Each outstanding batch is 15 products (13 for `t1-b035`).

## Quality position

- **Zero validation errors** across all 1,086. No SKU leakage, no over-length fields, no disallowed
  HTML, no placeholder rows, no sources in output.
- Averages: 9.0 specification rows, 3.7 key features per product.
- 547 of 1,086 have an empty `long_description`. That is the designed outcome for commodity lines
  where the title is the whole specification — not a gap to backfill.

## The one thing that degraded

Roughly batches 8 through 23 of tier 1 hit the session's web-search budget and fell back to fetching
manufacturer sites directly. That still confirmed a lot, and the agents correctly left fields empty
rather than guessing — the failure mode stayed safe. But those batches got less research than the tier
intended, so their spec tables are thinner than they should be.

Affected: `t1-b008` … `t1-b023`, and `t2-b046`, `t2-b048`, `t2-b050`, `t2-b052`. Around 250 products.
Worth a re-run with a fresh search budget if you want those tables fuller. The content that is there
is correct; there is simply less of it.

## Before importing

1. Run `validate-content.py` against the final merged file.
2. Read `source-data-discrepancies.md`. It contains real feed problems — duplicate EANs across
   different products, EANs that fail their check digit, model codes that contradict the title,
   `manufacturer_sku` fields containing the internal vendor SKU. These are catalogue data issues,
   not content issues, and they will cause problems in the platform whatever you do about the copy.
3. Supplied EANs were published unchanged throughout, even where a manufacturer datasheet disagreed.
   That was the instruction; the disagreements are all logged.
