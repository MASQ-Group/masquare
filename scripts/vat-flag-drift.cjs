/**
 * An independent read of what the VAT-flag repair would change, and why.
 *
 *   REPORT=vat-flag-drift bash scripts/prod-scan.sh
 *
 * The repair reports its own dry-run counts. This recomputes them from the database by a different
 * route — plain queries rather than the repair's own selection — so the two can be compared before
 * anybody rewrites a field a VAT return depends on. Agreement is worth more than either number
 * alone; disagreement is worth finding before the write, not after.
 *
 * Writes nothing.
 */
const { PrismaClient } = require('@prisma/client');
const { channelRemitsTheVat } = require('../apps/api/dist/src/integrations/mappings/tax-collection');

const line = (l, v) => console.log(`  ${String(l).padEnd(50)}${v}`);

(async () => {
  const prisma = new PrismaClient();

  const txs = await prisma.salesTransaction.findMany({
    where: { deletedAt: null, salesChannelId: { not: null } },
    select: {
      transactionRef: true, source: true, taxType: true, vatCollectedByChannel: true,
      company: { select: { officialName: true } },
      destinationCountry: { select: { isoCode: true } },
      salesChannel: {
        select: {
          name: true, vatThresholdEnabled: true, vatThresholdAmount: true,
          nativeCountry: { select: { isoCode: true } },
        },
      },
      items: { where: { deletedAt: null }, select: { netSalesAmount: true, vatAmount: true } },
    },
  });

  let onbuyFlag = 0;
  let onbuyFlagNoVat = 0;
  let scopeClear = 0;
  let amazonCandidates = 0;
  const byCompany = {};
  const samples = [];

  for (const t of txs) {
    const ch = t.salesChannel;
    const net = t.items.reduce((s, i) => s + (i.netSalesAmount ?? 0), 0);
    const vat = t.items.reduce((s, i) => s + (i.vatAmount ?? 0), 0);
    const scope = {
      channelConnector: t.source,
      channelHomeIso: ch?.nativeCountry?.isoCode ?? null,
      destinationIso: t.destinationCountry?.isoCode ?? null,
      taxType: t.taxType,
      belowChannelThreshold: !!ch?.vatThresholdEnabled
        && ch?.vatThresholdAmount != null
        && net <= Number(ch.vatThresholdAmount),
    };

    if (t.source === 'onbuy') {
      const want = channelRemitsTheVat({ ...scope, reportedByChannel: false });
      if (want && !t.vatCollectedByChannel) {
        // Mirrors the repair: an order with no VAT recorded has nothing for anyone to have
        // collected, so it is counted separately rather than folded into the flips.
        if (vat > 0) onbuyFlag += 1;
        else onbuyFlagNoVat += 1;
        const k = t.company?.officialName ?? 'Unknown';
        byCompany[k] = (byCompany[k] ?? 0) + 1;
        if (samples.length < 8) {
          samples.push(`${t.transactionRef.padEnd(12)} ${ch?.name} net ${net.toFixed(2)} vat ${vat.toFixed(2)}`);
        }
      }
      if (!want && t.vatCollectedByChannel) scopeClear += 1;
      continue;
    }

    if (t.vatCollectedByChannel && !channelRemitsTheVat({ ...scope, reportedByChannel: true })) {
      scopeClear += 1;
    }

    /**
     * What the Amazon half would ask about: a UK channel, a UK destination, VAT, currently false and
     * carrying some VAT to argue over. How many flip depends on Amazon's answer, not on this.
     */
    if (t.source === 'amazon' && !t.vatCollectedByChannel && vat > 0
      && scope.channelHomeIso === 'GB' && scope.destinationIso === 'GB'
      && (t.taxType ?? 'vat') === 'vat') {
      amazonCandidates += 1;
    }
  }

  line('orders examined', txs.length);
  console.log('');
  line('OnBuy: would be flagged (no call needed)', onbuyFlag);
  line('OnBuy: left alone, no VAT recorded', onbuyFlagNoVat);
  line('any channel: flags the scope now rejects', scopeClear);
  line('Amazon: candidates needing a call each', amazonCandidates);

  console.log('\n  OnBuy flips by company:');
  for (const [k, n] of Object.entries(byCompany).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(5)}  ${k}`);
  }

  console.log('\n  a few of them:');
  for (const s of samples) console.log(`    ${s}`);

  await prisma.$disconnect();
})().catch(async (e) => { console.error(e?.message ?? e); process.exit(1); });
