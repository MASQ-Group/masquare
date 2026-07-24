import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { AppShell } from './components/AppShell';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { CompaniesPage } from './pages/CompaniesPage';
import { UsersPage } from './pages/UsersPage';
import { ModulesPage } from './pages/ModulesPage';
import { SettingsPage } from './pages/SettingsPage';
import { ProductsPage } from './pages/ProductsPage';
import { SalesTransactionsPage } from './pages/SalesTransactionsPage';
import { SalesTransactionFormPage } from './pages/SalesTransactionFormPage';
import { ShipmentsPage } from './pages/ShipmentsPage';
import { FbaShipmentsPage } from './pages/FbaShipmentsPage';
import { WarehousesPage } from './pages/WarehousesPage';
import { PurchaseOrdersPage } from './pages/PurchaseOrdersPage';
import { PurchaseOrderFormPage } from './pages/PurchaseOrderFormPage';
import { PurchaseOrderDetailPage } from './pages/PurchaseOrderDetailPage';
import { GoodsReceiptsPage } from './pages/GoodsReceiptsPage';
import { ProcurementPage } from './pages/ProcurementPage';
import { IndividualPricingPage } from './pages/IndividualPricingPage';
import { BulkPricingPage } from './pages/BulkPricingPage';
import { VendorReturnsPage } from './pages/VendorReturnsPage';
import { SerialsPage } from './pages/SerialsPage';
import { InventoryPage } from './pages/InventoryPage';
import { AvailabilityPage } from './pages/AvailabilityPage';
import { ChannelListingsPage } from './pages/ChannelListingsPage';
import { ChannelListingDetailPage } from './pages/ChannelListingDetailPage';
import { StockOwedPage } from './pages/StockOwedPage';
import { AnalyticsLayout } from './components/analytics/AnalyticsLayout';
import { AnalyticsOverviewPage } from './pages/analytics/AnalyticsOverviewPage';
import { AnalyticsSalesPage } from './pages/analytics/AnalyticsSalesPage';
import { AnalyticsProfitabilityPage } from './pages/analytics/AnalyticsProfitabilityPage';
import { AnalyticsProductsPage } from './pages/analytics/AnalyticsProductsPage';
import { AnalyticsSkuDetailPage } from './pages/analytics/AnalyticsSkuDetailPage';
import { AnalyticsCountriesPage } from './pages/analytics/AnalyticsCountriesPage';
import { AnalyticsReturnsPage } from './pages/analytics/AnalyticsReturnsPage';
import { ExpensesPage } from './pages/expenses/ExpensesPage';
import { ExpenseCategoriesPage } from './pages/expenses/ExpenseCategoriesPage';
import { ExpenseNamesPage } from './pages/expenses/ExpenseNamesPage';
import { ExpenseTagsPage } from './pages/expenses/ExpenseTagsPage';
import { IntegrationsPage } from './pages/IntegrationsPage';
import { ConfirmProvider } from './components/ConfirmProvider';

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
        <Route path="/fba-shipments" element={<FbaShipmentsPage />} />
        <Route path="/inventory" element={<InventoryPage />} />
        <Route path="/availability" element={<AvailabilityPage />} />
        <Route path="/channel-listings" element={<ChannelListingsPage />} />
        <Route path="/channel-listings/:productId" element={<ChannelListingDetailPage />} />
        <Route path="/stock-owed" element={<StockOwedPage />} />
        <Route path="/warehouses" element={<WarehousesPage />} />
        <Route path="/procurement" element={<ProcurementPage />} />
        <Route path="/pricing/individual" element={<IndividualPricingPage />} />
        <Route path="/pricing/bulk" element={<BulkPricingPage />} />
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
