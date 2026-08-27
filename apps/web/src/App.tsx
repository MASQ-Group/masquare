import { lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
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
const ModulesPage = lazyPage(() => import('./pages/ModulesPage'), 'ModulesPage');
const SettingsPage = lazyPage(() => import('./pages/SettingsPage'), 'SettingsPage');
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
        <Route path="/products" element={<ProductsPage />} />
        <Route path="/sales-transactions" element={<SalesTransactionsPage />} />
        {/* Literal path before ":id" so /new isn't read as an id. */}
        <Route path="/sales-transactions/new" element={<SalesTransactionFormPage />} />
        <Route path="/sales-transactions/:id/edit" element={<SalesTransactionFormPage />} />
        <Route path="/shipments" element={<ShipmentsPage />} />
        <Route path="/fba-shipments" element={<RequireTradingCompany><FbaShipmentsPage /></RequireTradingCompany>} />
        <Route path="/inventory" element={<InventoryPage />} />
        <Route path="/availability" element={<RequireTradingCompany><AvailabilityPage /></RequireTradingCompany>} />
        <Route path="/channel-listings" element={<RequireTradingCompany><ChannelListingsPage /></RequireTradingCompany>} />
        <Route path="/channel-listings/:productId" element={<RequireTradingCompany><ChannelListingDetailPage /></RequireTradingCompany>} />
        <Route path="/repricing" element={<RequireAdmin><RequireTradingCompany><RepricingPage /></RequireTradingCompany></RequireAdmin>} />
        <Route path="/stock-owed" element={<StockOwedPage />} />
        <Route path="/warehouses" element={<WarehousesPage />} />
        <Route path="/procurement" element={<ProcurementPage />} />
        <Route path="/pricing/individual" element={<IndividualPricingPage />} />
        <Route path="/pricing/bulk" element={<BulkPricingPage />} />
        <Route path="/pricing/vendor-files" element={<VendorImportPage />} />
        <Route path="/purchase-orders" element={<PurchaseOrdersPage />} />
        <Route path="/purchase-orders/new" element={<PurchaseOrderFormPage />} />
        <Route path="/purchase-orders/:id" element={<PurchaseOrderDetailPage />} />
        <Route path="/purchase-orders/:id/edit" element={<PurchaseOrderFormPage />} />
        <Route path="/goods-receipts" element={<GoodsReceiptsPage />} />
        <Route path="/vendor-returns" element={<VendorReturnsPage />} />
        <Route path="/serials" element={<SerialsPage />} />
        <Route path="/analytics" element={<AnalyticsLayout />}>
          <Route index element={<AnalyticsOverviewPage />} />
          <Route path="sales" element={<AnalyticsSalesPage />} />
          <Route path="profitability" element={<AnalyticsProfitabilityPage />} />
          <Route path="products" element={<AnalyticsProductsPage />} />
          {/* Literal 'products' handled above; ':sku' is the drill-down. */}
          <Route path="products/:sku" element={<AnalyticsSkuDetailPage />} />
          <Route path="countries" element={<AnalyticsCountriesPage />} />
          <Route path="returns" element={<AnalyticsReturnsPage />} />
        </Route>
        <Route path="/expenses" element={<ExpensesPage />} />
        <Route path="/expenses/names" element={<ExpenseNamesPage />} />
        <Route path="/expenses/tags" element={<ExpenseTagsPage />} />
        <Route path="/expenses/categories" element={<ExpenseCategoriesPage />} />
        <Route path="/integrations" element={<RequireAdmin><IntegrationsPage /></RequireAdmin>} />
        <Route path="/companies" element={<RequireAdmin><CompaniesPage /></RequireAdmin>} />
        <Route path="/users" element={<RequireAdmin><UsersPage /></RequireAdmin>} />
        <Route path="/modules" element={<RequireAdmin><ModulesPage /></RequireAdmin>} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </ConfirmProvider>
  );
}
