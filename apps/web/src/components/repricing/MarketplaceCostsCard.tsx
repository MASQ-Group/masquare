import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Layers } from 'lucide-react';
import { integrationsApi, repricingApi, type RepricingMarketplaceCosts } from '../../lib/api';

/** The API keys these rows by Amazon's marketplace id; the UI works in ISO codes. */
const MARKETPLACE_ISO: Record<string, string> = {
  ATVPDKIKX0DER: 'US', A2EUQ1WTGCTBG2: 'CA', A1AM78C64UM0Y8: 'MX', A2Q3Y263D00KWC: 'BR',
  A1F83G8C2ARO7P: 'UK', A28R8C7NBKEWEA: 'IE', A1PA6795UKMFR9: 'DE', A13V1IB3VIYZZH: 'FR',
  APJ6JRA9NG5V4: 'IT', A1RKKUPIHCS9HS: 'ES', A1805IZSGTT6HS: 'NL', AMEN7PMS3EDWL: 'BE',
  A2NODRKZP88ZB9: 'SE', A1C3SOZRARQ6R3: 'PL', A33AVAJ2PDY3EV: 'TR', ARBP9OOSHTCHU: 'EG',
  A17E79C6D8DWNP: 'SA', A2VIGQ35RCS4UG: 'AE', A21TJRUUN4KGV: 'IN', AE08WJ6YKNBMC: 'ZA',
  A1VC38T7YXB528: 'JP', A39IBJ37TRP1C6: 'AU', A19VAU5U5O7RUS: 'SG',
};

/**
 * Which loaded costs a marketplace actually incurs.
 *
 * Off everywhere by default. Storage exists only where stock sits at Amazon and advertising only
 * where we advertise, so treating either as a missing input on a marketplace that never incurs it
 * blocks a low-margin strategy on a floor that is already complete.
 */
export function MarketplaceCostsCard() {
  const qc = useQueryClient();
  const { data: costs = [] } = useQuery({ queryKey: ['repricing-marketplace-costs'], queryFn: repricingApi.marketplaceCosts });
  const { data: integrations = [] } = useQuery({ queryKey: ['integrations'], queryFn: integrationsApi.list });
  const markets = [...new Set(
    integrations.filter((i: any) => i.channelType === 'amazon' && i.marketplace).map((i: any) => i.marketplace as string),
  )].sort();

  const save = useMutation({
    mutationFn: repricingApi.setMarketplaceCosts,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['repricing-marketplace-costs'] }),
  });

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-n-100 px-4 py-2.5">
        <Layers size={15} className="text-n-500" />
        <span className="text-[13px] font-semibold text-n-800">Which costs each marketplace incurs</span>
        <span className="text-[11.5px] text-n-400">
          Off unless a cost is real there. Turning one on makes it required: SKUs without a value refuse an
          aggressive strategy until it is set, and floors need recomputing.
        </span>
      </div>

      <div className="flex flex-col divide-y divide-n-100">
        {markets.length === 0 && <div className="px-4 py-3 text-[12.5px] text-n-500">No Amazon marketplaces connected.</div>}
        {markets.map((m) => (
          <MarketRow
            key={`${m}:${costs.find((c) => MARKETPLACE_ISO[c.marketplaceId] === m)?.storageApplies}:${costs.find((c) => MARKETPLACE_ISO[c.marketplaceId] === m)?.adsApply}`}
            marketplace={m}
            current={costs.find((c) => MARKETPLACE_ISO[c.marketplaceId] === m)}
            saving={save.isPending}
            onSave={(patch) => save.mutate({ marketplace: m, ...patch })}
          />
        ))}
      </div>
    </div>
  );
}

function MarketRow({
  marketplace, current, saving, onSave,
}: {
  marketplace: string;
  current?: RepricingMarketplaceCosts;
  saving: boolean;
  onSave: (patch: { storageApplies: boolean; adsApply: boolean; defaultStoragePerUnitCents: number | null; defaultAdCostPerUnitCents: number | null }) => void;
}) {
  const [storage, setStorage] = useState(current?.storageApplies ?? false);
  const [ads, setAds] = useState(current?.adsApply ?? false);
  const [storageVal, setStorageVal] = useState(current?.defaultStoragePerUnitCents != null ? String(current.defaultStoragePerUnitCents / 100) : '');
  const [adsVal, setAdsVal] = useState(current?.defaultAdCostPerUnitCents != null ? String(current.defaultAdCostPerUnitCents / 100) : '');

  const cents = (v: string) => (v.trim() === '' ? null : Math.round(Number(v.replace(',', '.')) * 100));
  const dirty =
    storage !== (current?.storageApplies ?? false) ||
    ads !== (current?.adsApply ?? false) ||
    cents(storageVal) !== (current?.defaultStoragePerUnitCents ?? null) ||
    cents(adsVal) !== (current?.defaultAdCostPerUnitCents ?? null);

  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-[12.5px]">
      <span className="mono w-[46px] shrink-0 font-semibold text-n-800">{marketplace}</span>

      <label className="flex cursor-pointer items-center gap-1.5">
        <input type="checkbox" className="h-3.5 w-3.5 accent-[var(--teal-500)]" checked={storage} onChange={(e) => setStorage(e.target.checked)} />
        <span className="text-n-700">Storage</span>
      </label>
      {storage && (
        <input
          className="input mono h-8 w-[110px] text-right text-[12px]"
          inputMode="decimal"
          placeholder="per unit"
          value={storageVal}
          onChange={(e) => setStorageVal(e.target.value)}
        />
      )}

      <label className="flex cursor-pointer items-center gap-1.5">
        <input type="checkbox" className="h-3.5 w-3.5 accent-[var(--teal-500)]" checked={ads} onChange={(e) => setAds(e.target.checked)} />
        <span className="text-n-700">Advertising</span>
      </label>
      {ads && (
        <input
          className="input mono h-8 w-[110px] text-right text-[12px]"
          inputMode="decimal"
          placeholder="per unit"
          value={adsVal}
          onChange={(e) => setAdsVal(e.target.value)}
        />
      )}

      {!storage && !ads && <span className="text-[11.5px] text-n-400">Neither applies here</span>}

      {storage && (
        <span className="text-[11px] text-n-400">Storage counts on FBA listings only</span>
      )}

      <button
        onClick={() => onSave({ storageApplies: storage, adsApply: ads, defaultStoragePerUnitCents: cents(storageVal), defaultAdCostPerUnitCents: cents(adsVal) })}
        disabled={!dirty || saving}
        className="ml-auto inline-flex h-7 items-center rounded-md border border-n-200 bg-n-0 px-2.5 text-[12px] font-semibold text-n-700 hover:border-n-300 disabled:opacity-40"
      >
        Save
      </button>
    </div>
  );
}
