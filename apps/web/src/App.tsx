import { lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { useAccess } from './lib/useAccess';
import { AppShell } from './components/AppShell';
import { LoginPage } from './pages/LoginPage';
import { ConfirmProvider } from './components/ConfirmProvider';

// Every page is code-split into its own chunk so the first load only ships the
// shell + login, not all ~40 screens. `lazyPage` adapts our named page exports
// (we don't use default exports) to React.lazy's default-export contract.
// The Suspense boundary lives in AppShell around <Outlet/>, so the sidebar and
// header stay put while a route chunk loads.
const lazyPage = <T extends Record<string, any>>(loader: () => Promise<T>, name: keyof T) =>
  lazy(() => loader().then((m) => ({ default: m[name] })));

const DashboardPage = lazyPage(() => import('./pages/DashboardPage'), 'DashboardPage');
const CompaniesPage = lazyPage(() => import('./pages/CompaniesPage'), 'CompaniesPage');
const UsersPage = lazyPage(() => import('./pages/UsersPage'), 'UsersPage');
const RolesPage = lazyPage(() => import('./pages/RolesPage'), 'RolesPage');
const HelpPage = lazyPage(() => import('./pages/HelpPage'), 'HelpPage');
const ModulesPage = lazyPage(() => import('./pages/ModulesPage'), 'ModulesPage');
const SettingsPage = lazyPage(() => import('./pages/SettingsPage'), 'SettingsPage');
const ActivityPage = lazyPage(() => import('./pages/ActivityPage'), 'ActivityPage');
const ProductsPage = lazyPage(() => import('./pages/ProductsPage'), 'ProductsPage');
const SalesTransactionsPage = lazyPage(() => import('./pages/SalesTransactionsPage'), 'SalesTransactionsPage');
const SalesTransactionFormPage = lazyPage(() => import('./pages/SalesTransactionFormPage'), 'SalesTransactionFormPage');
const ShipmentsPage = lazyPage(() => import('./pages/ShipmentsPage'), 'ShipmentsPage');
const FbaShipmentsPage = lazyPage(() => import('./pages/FbaShipmentsPage'), 'FbaShipmentsPage');
const WarehousesPage = lazyPage(() => import('./pages/WarehousesPage'), 'WarehousesPage');
const PurchaseOrdersPage = lazyPage(() => import('./pages/PurchaseOrdersPage'), 'PurchaseOrdersPage');
const PurchaseOrderFormPage = lazyPage(() => import('./pages/PurchaseOrderFormPage'), 'PurchaseOrderFormPage');
const PurchaseOrderDetailPage = lazyPage(() => import('./pages/PurchaseOrderDetailPage'), 'PurchaseOrderDetailPage');
const GoodsReceiptsPage = lazyPage(() => import('./pages/GoodsReceiptsPage'), 'GoodsReceiptsPage');
const ProcurementPage = lazyPage(() => import('./pages/ProcurementPage'), 'ProcurementPage');
const IndividualPricingPage = lazyPage(() => import('./pages/IndividualPricingPage'), 'IndividualPricingPage');
const VendorImportPage = lazyPage(() => import('./pages/VendorImportPage'), 'VendorImportPage');
const BulkPricingPage = lazyPage(() => import('./pages/BulkPricingPage'), 'BulkPricingPage');
const VendorReturnsPage = lazyPage(() => import('./pages/VendorReturnsPage'), 'VendorReturnsPage');
const SerialsPage = lazyPage(() => import('./pages/SerialsPage'), 'SerialsPage');
const InventoryPage = lazyPage(() => import('./pages/InventoryPage'), 'InventoryPage');
const AvailabilityPage = lazyPage(() => import('./pages/AvailabilityPage'), 'AvailabilityPage');
const ChannelListingsPage = lazyPage(() => import('./pages/ChannelListingsPage'), 'ChannelListingsPage');
const ChannelListingDetailPage = lazyPage(() => import('./pages/ChannelListingDetailPage'), 'ChannelListingDetailPage');
const StoreProductPreviewPage = lazyPage(() => import('./pages/StoreProductPreviewPage'), 'StoreProductPreviewPage');
const StockOwedPage = lazyPage(() => import('./pages/StockOwedPage'), 'StockOwedPage');
const AnalyticsLayout = lazyPage(() => import('./components/analytics/AnalyticsLayout'), 'AnalyticsLayout');
const AnalyticsOverviewPage = lazyPage(() => import('./pages/analytics/AnalyticsOverviewPage'), 'AnalyticsOverviewPage');
const AnalyticsSalesPage = lazyPage(() => import('./pages/analytics/AnalyticsSalesPage'), 'AnalyticsSalesPage');
const AnalyticsProfitabilityPage = lazyPage(() => import('./pages/analytics/AnalyticsProfitabilityPage'), 'AnalyticsProfitabilityPage');
const AnalyticsProductsPage = lazyPage(() => import('./pages/analytics/AnalyticsProductsPage'), 'AnalyticsProductsPage');
const AnalyticsSkuDetailPage = lazyPage(() => import('./pages/analytics/AnalyticsSkuDetailPage'), 'AnalyticsSkuDetailPage');
const AnalyticsCountriesPage = lazyPage(() => import('./pages/analytics/AnalyticsCountriesPage'), 'AnalyticsCountriesPage');
const AnalyticsReturnsPage = lazyPage(() => import('./pages/analytics/AnalyticsReturnsPage'), 'AnalyticsReturnsPage');
const ExpensesPage = lazyPage(() => import('./pages/expenses/ExpensesPage'), 'ExpensesPage');
const ExpenseCategoriesPage = lazyPage(() => import('./pages/expenses/ExpenseCategoriesPage'), 'ExpenseCategoriesPage');
const ExpenseNamesPage = lazyPage(() => import('./pages/expenses/ExpenseNamesPage'), 'ExpenseNamesPage');
const ExpenseTagsPage = lazyPage(() => import('./pages/expenses/ExpenseTagsPage'), 'ExpenseTagsPage');
const IntegrationsPage = lazyPage(() => import('./pages/IntegrationsPage'), 'IntegrationsPage');
const RepricingPage = lazyPage(() => import('./pages/RepricingPage'), 'RepricingPage');

function RequireAuth({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function RequireAdmin({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (!user.isAdmin) return <Navigate to="/" replace />;
  return children;
}

/**
 * Keeps trading pages out of a company connected for order history only.
 *
 * The sidebar already hides these and the API refuses the calls behind them, but a typed URL or a
 * bookmarked tab reaches the route directly — and a page that loads and then fails piecemeal is a
 * worse answer than not opening at all.
 */
/**
 * Keeps someone out of a page they hold no access to.
 *
 * The sidebar already hides the link, but a hidden link is a courtesy and a typed URL ignores it —
 * without this, the page would mount, fire its queries and fill up with 403s, which reads as a
 * broken screen rather than a closed door. Sent to the dashboard instead, which everyone can reach.
 *
 * Not the security boundary: that is the guard on the API, which refuses the same calls regardless
 * of what the browser decides to render.
 */
function RequireArea({ area, children }: { area: string; children: JSX.Element }) {
  const { loading } = useAuth();
  const { can } = useAccess();
  if (loading) return <FullScreenLoader />;
  return can(area) ? children : <Navigate to="/" replace />;
}

function RequireTradingCompany({ children }: { children: JSX.Element }) {
  const { loading, activeCompany } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (activeCompany?.amazonScope === 'orders') return <Navigate to="/" replace />;
  return children;
}

function FullScreenLoader() {
  return (
    <div className="grid h-full place-items-center text-[13px] text-n-500">Loading…</div>
  );
}

export function App() {
  return (
    <ConfirmProvider>
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route path="/" element={<DashboardPage />} />
        <Route path="/products" element={<RequireArea area="products"><ProductsPage /></RequireArea>} />
        <Route path="/sales-transactions" element={<RequireArea area="sales_transactions"><SalesTransactionsPage /></RequireArea>} />
        {/* Literal path before ":id" so /new isn't read as an id. */}
        <Route path="/sales-transactions/new" element={<RequireArea area="sales_transactions"><SalesTransactionFormPage /></RequireArea>} />
        <Route path="/sales-transactions/:id/edit" element={<RequireArea area="sales_transactions"><SalesTransactionFormPage /></RequireArea>} />
        <Route path="/shipments" element={<RequireArea area="shipments"><ShipmentsPage /></RequireArea>} />
        <Route path="/fba-shipments" element={<RequireArea area="shipments"><FbaShipmentsPage /></RequireArea>} />
        <Route path="/inventory" element={<RequireArea area="inventory"><InventoryPage /></RequireArea>} />
        <Route path="/availability" element={<RequireArea area="products"><RequireTradingCompany><AvailabilityPage /></RequireTradingCompany></RequireArea>} />
        <Route path="/channel-listings" element={<RequireArea area="channel_listings"><RequireTradingCompany><ChannelListingsPage /></RequireTradingCompany></RequireArea>} />
        <Route path="/channel-listings/:productId" element={<RequireArea area="channel_listings"><RequireTradingCompany><ChannelListingDetailPage /></RequireTradingCompany></RequireArea>} />
        {/* The B2B storefront product page, previewed inside the platform while the store itself
            — customers, entitlements, agreed prices — is still to be built. */}
        <Route path="/store-preview/product/:productId" element={<RequireArea area="products"><StoreProductPreviewPage /></RequireArea>} />
        <Route path="/repricing" element={<RequireArea area="repricing"><RequireAdmin><RequireTradingCompany><RepricingPage /></RequireTradingCompany></RequireAdmin></RequireArea>} />
        <Route path="/stock-owed" element={<RequireArea area="inventory"><StockOwedPage /></RequireArea>} />
        <Route path="/warehouses" element={<RequireArea area="inventory"><WarehousesPage /></RequireArea>} />
        <Route path="/procurement" element={<RequireArea area="purchasing"><ProcurementPage /></RequireArea>} />
        <Route path="/pricing/individual" element={<RequireArea area="pricing"><IndividualPricingPage /></RequireArea>} />
        <Route path="/pricing/bulk" element={<RequireArea area="pricing"><BulkPricingPage /></RequireArea>} />
        <Route path="/pricing/vendor-files" element={<RequireArea area="pricing"><VendorImportPage /></RequireArea>} />
        <Route path="/purchase-orders" element={<RequireArea area="purchasing"><PurchaseOrdersPage /></RequireArea>} />
        <Route path="/purchase-orders/new" element={<RequireArea area="purchasing"><PurchaseOrderFormPage /></RequireArea>} />
        <Route path="/purchase-orders/:id" element={<RequireArea area="purchasing"><PurchaseOrderDetailPage /></RequireArea>} />
        <Route path="/purchase-orders/:id/edit" element={<RequireArea area="purchasing"><PurchaseOrderFormPage /></RequireArea>} />
        <Route path="/goods-receipts" element={<RequireArea area="receiving"><GoodsReceiptsPage /></RequireArea>} />
        <Route path="/vendor-returns" element={<RequireArea area="receiving"><VendorReturnsPage /></RequireArea>} />
        <Route path="/serials" element={<RequireArea area="inventory"><SerialsPage /></RequireArea>} />
        <Route path="/analytics" element={<RequireArea area="analytics"><AnalyticsLayout /></RequireArea>}>
          <Route index element={<AnalyticsOverviewPage />} />
          <Route path="sales" element={<AnalyticsSalesPage />} />
          <Route path="profitability" element={<AnalyticsProfitabilityPage />} />
          <Route path="products" element={<AnalyticsProductsPage />} />
          {/* Literal 'products' handled above; ':sku' is the drill-down. */}
          <Route path="products/:sku" element={<AnalyticsSkuDetailPage />} />
          <Route path="countries" element={<AnalyticsCountriesPage />} />
          <Route path="returns" element={<AnalyticsReturnsPage />} />
        </Route>
        <Route path="/expenses" element={<RequireArea area="expenses"><ExpensesPage /></RequireArea>} />
        <Route path="/expenses/names" element={<RequireArea area="expenses"><ExpenseNamesPage /></RequireArea>} />
        <Route path="/expenses/tags" element={<RequireArea area="expenses"><ExpenseTagsPage /></RequireArea>} />
        <Route path="/expenses/categories" element={<RequireArea area="expenses"><ExpenseCategoriesPage /></RequireArea>} />
        <Route path="/integrations" element={<RequireArea area="integrations"><RequireAdmin><IntegrationsPage /></RequireAdmin></RequireArea>} />
        <Route path="/companies" element={<RequireAdmin><CompaniesPage /></RequireAdmin>} />
        <Route path="/users" element={<RequireAdmin><UsersPage /></RequireAdmin>} />
        <Route path="/roles" element={<RequireAdmin><RolesPage /></RequireAdmin>} />
        <Route path="/modules" element={<RequireAdmin><ModulesPage /></RequireAdmin>} />
        <Route path="/activity" element={<RequireArea area="activity"><ActivityPage /></RequireArea>} />
        <Route path="/settings" element={<RequireArea area="global_settings"><SettingsPage /></RequireArea>} />
        {/* Deliberately ungated: someone who cannot reach a screen still benefits from knowing
            what it does, and the help is the thing you reach for when something is refused. */}
        <Route path="/help/*" element={<HelpPage />} />
        <Route path="/help" element={<HelpPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </ConfirmProvider>
  );
}
