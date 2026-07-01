import { useState } from 'react';
import { GeneralTab } from '../components/settings/GeneralTab';
import { VendorsSection } from '../components/settings/VendorsSection';
import { BrandsSection, ProductTypesSection, FulfilmentTypesSection } from '../components/settings/SimpleSections';
import { CategoriesSection } from '../components/settings/CategoriesSection';
import { AttributesSection } from '../components/settings/AttributesSection';

type TopTab = 'general' | 'products';

const PRODUCT_SECTIONS = [
  { key: 'vendors', label: 'Vendors', Component: VendorsSection },
  { key: 'brands', label: 'Brands', Component: BrandsSection },
  { key: 'product-types', label: 'Product Types', Component: ProductTypesSection },
  { key: 'fulfilment-types', label: 'Fulfilment Types', Component: FulfilmentTypesSection },
  { key: 'categories', label: 'Categories', Component: CategoriesSection },
  { key: 'attributes', label: 'Attributes', Component: AttributesSection },
] as const;

export function SettingsPage() {
  const [top, setTop] = useState<TopTab>('products');
  const [section, setSection] = useState<string>('vendors');

  const ActiveSection = PRODUCT_SECTIONS.find((s) => s.key === section)?.Component ?? VendorsSection;

  return (
    <div className="w-full">
      <div className="mb-5">
        <div className="eyebrow mb-1.5">Administration</div>
        <h1 className="text-[24px] font-semibold tracking-tight text-n-900">Global settings</h1>
        <p className="mt-1 text-[13.5px] text-n-500">Platform format defaults and the shared product reference library.</p>
      </div>

      {/* Top tabs */}
      <div className="mb-6 flex gap-1 border-b border-n-200">
        {([['general', 'General'], ['products', 'Products']] as [TopTab, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTop(key)}
            className={`relative px-4 py-2.5 text-[14px] font-medium transition-colors ${
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

      {top === 'products' && (
        <div className="flex gap-6 max-[900px]:flex-col">
          {/* Section nav */}
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
