-- Amazon's other tax-exclusive markets, matching TAX_ON_TOP in amazon-mapping.ts: the listed
-- price excludes the tax and the marketplace adds it at checkout, so the listed price is our
-- revenue. AU was set in the previous migration; JP is deliberately NOT here -- its price does
-- include the tax, but the seller keeps it, which pricing derives from the 'jct' tax type.
UPDATE "sales_channel" sc
   SET "prices_include_tax" = false
  FROM "country" c
 WHERE sc."native_country_id" = c."id"
   AND c."iso_code" IN ('US', 'CA', 'MX');
