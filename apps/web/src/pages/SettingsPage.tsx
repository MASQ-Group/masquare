import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/common/PageHeader';
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
import { ComplianceSection } from '../components/settings/ComplianceSection';

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
  { key: 'compliance', label: 'Compliance Values', Component: ComplianceSection },
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
      <PageHeader
        module="Setup"
        title="Global settings"
        info="Platform format defaults and the shared reference libraries."
        tabs={TOP_TABS.map(([key, label]) => ({ key, label }))}
        activeTab={top}
        onTabChange={(k) => setTop(k as TopTab)}
      />

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
