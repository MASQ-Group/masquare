import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { GeneralTab } from '../components/settings/GeneralTab';
import { CountriesTab } from '../components/settings/CountriesTab';
import { SalesChannelsTab } from '../components/settings/SalesChannelsTab';
import { ShippingServicesTab } from '../components/settings/ShippingServicesTab';
import { ProfitTiersTab } from '../components/settings/ProfitTiersTab';
import { CustomsFxTab } from '../components/settings/CustomsFxTab';
import { VendorsSection } from '../components/settings/VendorsSection';
import { BrandsSection, ProductTypesSection, FulfilmentTypesSection } from '../components/settings/SimpleSections';
import { CategoriesSection } from '../components/settings/CategoriesSection';
import { AttributesSection } from '../components/settings/AttributesSection';
import { VatClassesSection } from '../components/settings/VatClassesSection';
import { ProductClassesSection } from '../components/settings/ProductClassesSection';

type TopTab = 'general' | 'countries' | 'products' | 'sales-channels' | 'shipping-services' | 'profit-tiers' | 'customs-fx';

const TOP_TABS: [TopTab, string][] = [
  ['general', 'General'],
  ['countries', 'Countries'],
  ['products', 'Products'],
  ['sales-channels', 'Sales Channels'],
  ['shipping-services', 'Shipping Services'],
  ['profit-tiers', 'Profit Tiers'],
  ['customs-fx', 'Customs FX (CY)'],
];

const PRODUCT_SECTIONS = [
  { key: 'vendors', label: 'Vendors', Component: VendorsSection },
  { key: 'brands', label: 'Brands', Component: BrandsSection },
  { key: 'product-classes', label: 'Product Classes', Component: ProductClassesSection },
  { key: 'product-types', label: 'Product Types', Component: ProductTypesSection },
  { key: 'fulfilment-types', label: 'Fulfilment Types', Component: FulfilmentTypesSection },
  { key: 'categories', label: 'Categories', Component: CategoriesSection },
  { key: 'attributes', label: 'Attributes', Component: AttributesSection },
  { key: 'vat-classes', label: 'VAT Classes', Component: VatClassesSection },
] as const;

const isTopTab = (v: string | null): v is TopTab => TOP_TABS.some(([key]) => key === v);

export function SettingsPage() {
  const [searchParams] = useSearchParams();
  const urlTab = searchParams.get('tab');
  const [top, setTop] = useState<TopTab>(isTopTab(urlTab) ? urlTab : 'products');
  const [section, setSection] = useState<string>('vendors');
  // Deep link from the global search: /settings?tab=… selects (and re-selects) the tab.
  useEffect(() => { if (isTopTab(urlTab)) setTop(urlTab); }, [urlTab]);

  const ActiveSection = PRODUCT_SECTIONS.find((s) => s.key === section)?.Component ?? VendorsSection;

  return (
    <div className="w-full">
      <div className="mb-5">
        <div className="eyebrow mb-1.5">Administration</div>
        <h1 className="text-[24px] font-semibold tracking-tight text-n-900">Global settings</h1>
        <p className="mt-1 text-[13.5px] text-n-500">Platform format defaults and the shared reference libraries.</p>
      </div>

      {/* Top tabs */}
      <div className="mb-6 flex gap-1 overflow-x-auto border-b border-n-200">
        {TOP_TABS.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTop(key)}
            className={`relative whitespace-nowrap px-4 py-2.5 text-[14px] font-medium transition-colors ${
              top === key
                ? 'text-teal-700 after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-teal-500'
                : 'text-n-500 hover:text-n-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {top === 'general' && <GeneralTab />}
      {top === 'countries' && <CountriesTab />}
      {top === 'sales-channels' && <SalesChannelsTab />}
      {top === 'shipping-services' && <ShippingServicesTab />}
      {top === 'profit-tiers' && <ProfitTiersTab />}
      {top === 'customs-fx' && <CustomsFxTab />}

      {top === 'products' && (
        <div className="flex gap-6 max-[900px]:flex-col">
          <nav className="flex w-52 flex-shrink-0 flex-col gap-0.5 max-[900px]:w-full max-[900px]:flex-row max-[900px]:overflow-x-auto">
            {PRODUCT_SECTIONS.map((s) => (
              <button
                key={s.key}
                onClick={() => setSection(s.key)}
                className={`whitespace-nowrap rounded-md px-3 py-2 text-left text-[13.5px] font-medium transition-colors ${
                  section === s.key ? 'bg-teal-50 text-teal-700' : 'text-n-600 hover:bg-n-100'
                }`}
              >
                {s.label}
              </button>
            ))}
          </nav>
          <div className="min-w-0 flex-1">
            <ActiveSection />
          </div>
        </div>
      )}
    </div>
  );
}
