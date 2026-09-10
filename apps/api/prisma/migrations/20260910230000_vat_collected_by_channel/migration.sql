-- Whether the MARKETPLACE collected this order's VAT and remits it, rather than us.
--
-- Below the UK's 135 threshold Amazon, eBay and OnBuy charge the buyer the VAT, keep it and pay it
-- over themselves. The order still carries VAT, but none of it is ours to declare — and until now
-- the same amount sat in vat_amount whether we owed it or the channel did.
--
-- Set from what the channel REPORTS (Amazon TaxCollection.Model, eBay ebayCollectAndRemitTaxes),
-- never inferred from the threshold. Existing rows stay false until a sync re-reads them, because
-- false here means "not reported", not "we owe it".
ALTER TABLE "sales_transaction" ADD COLUMN "vat_collected_by_channel" BOOLEAN NOT NULL DEFAULT false;
