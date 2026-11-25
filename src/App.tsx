import React, { useEffect, useState } from 'react';
import {
  BarChart3,
  Barcode,
  ClipboardList,
  LayoutDashboard,
  Menu,
  Package,
  Plus,
  QrCode,
  Settings,
  ShoppingCart,
  Truck,
  Users,
  X,
} from 'lucide-react';
import { AppView, BootstrapData, User } from './types';
import { apiFetch } from './utils/api';
import { InvoiceModal } from './components/InvoiceModal';
import { DashboardView } from './views/DashboardView';
import { QuickStockEntryView } from './views/QuickStockEntryView';
import { PosView } from './views/PosView';
import { ProductsView } from './views/ProductsView';
import { PurchasesView } from './views/PurchasesView';
import { SerialsView } from './views/SerialsView';
import { HistoryAndSmartView } from './views/HistoryAndSmartView';
import { PartiesView } from './views/PartiesView';
import { ReportsView } from './views/ReportsView';
import { SettingsBackupView } from './views/SettingsBackupView';

const NAV_ITEMS: Array<{ id: AppView; label: string; icon: React.FC<{ className?: string }> }> = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'quick-stock', label: 'Quick Stock Entry', icon: QrCode },
  { id: 'pos', label: 'Sales & POS', icon: ShoppingCart },
  { id: 'products', label: 'Products', icon: Package },
  { id: 'purchases', label: 'Purchases', icon: Truck },
  { id: 'serials', label: 'Serial Numbers', icon: Barcode },
  { id: 'history', label: 'History & Forecast', icon: ClipboardList },
  { id: 'parties', label: 'Customers & Suppliers', icon: Users },
  { id: 'reports', label: 'Reports & P&L', icon: BarChart3 },
  { id: 'settings', label: 'Settings & Backup', icon: Settings },
];

export default function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null);
  const [currentUserId, setCurrentUserId] = useState<number>(1);
  const [activeView, setActiveView] = useState<AppView>('dashboard');
  const [preselectedProductId, setPreselectedProductId] = useState<number | null>(null);
  const [invoiceModalSaleId, setInvoiceModalSaleId] = useState<number | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [loadError, setLoadError] = useState('');

  const loadBootstrap = async () => {
    try {
      const data = await apiFetch<BootstrapData>('/api/bootstrap');
      setBootstrap(data);
      setLoadError('');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to connect to local SQLite backend');
    }
  };

  useEffect(() => {
    loadBootstrap();
  }, []);

  const handleDataChanged = () => {
    setRefreshTick((t) => t + 1);
    loadBootstrap();
  };

  const navigateTo = (view: AppView, productId?: number) => {
    setPreselectedProductId(productId ?? null);
    setActiveView(view);
    setMobileMenuOpen(false);
  };

  if (loadError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md rounded-xl border border-red-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-lg font-bold text-slate-900">Database Connection Error</h1>
          <p className="mt-2 text-sm text-slate-600">{loadError}</p>
          <button
            type="button"
            onClick={loadBootstrap}
            className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  if (!bootstrap) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="text-sm font-medium text-slate-500">Loading TechVault SQLite Workspace...</div>
      </div>
    );
  }

  const currentUser: User =
    bootstrap.users.find((u) => u.id === currentUserId) ||
    bootstrap.users[0] || { id: 1, name: 'Admin', role: 'Admin', active: 1, created_at: '' };

  const activeNav = NAV_ITEMS.find((n) => n.id === activeView) || NAV_ITEMS[0];

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      {/* Desktop Sidebar */}
      <aside className="no-print hidden w-64 shrink-0 flex-col justify-between bg-slate-900 text-slate-100 lg:flex">
        <div>
          <div className="border-b border-slate-800 px-5 py-5">
            <div className="font-display text-base font-bold tracking-tight text-white truncate">
              {bootstrap.settings.shop_name || 'TechVault Hardware'}
            </div>
            <div className="mt-0.5 text-xs text-slate-400">Offline Inventory &amp; POS</div>
          </div>

          <nav className="space-y-1 p-3">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeView === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigateTo(item.id)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Local Staff Operator Switcher */}
        <div className="border-t border-slate-800 p-4">
          <label className="block text-[11px] font-medium text-slate-400">Active Staff Operator</label>
          <select
            value={currentUser.id}
            onChange={(e) => setCurrentUserId(Number(e.target.value))}
            className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-100 focus:border-blue-500 focus:outline-none"
          >
            {bootstrap.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.role})
              </option>
            ))}
          </select>
        </div>
      </aside>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="fixed inset-0 bg-slate-900/60" onClick={() => setMobileMenuOpen(false)} />
          <div className="relative flex w-64 flex-col justify-between bg-slate-900 text-slate-100">
            <div>
              <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
                <span className="font-display text-sm font-bold text-white">TechVault POS</span>
                <button type="button" onClick={() => setMobileMenuOpen(false)} className="text-slate-400">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <nav className="space-y-1 p-3">
                {NAV_ITEMS.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => navigateTo(item.id)}
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium ${
                        activeView === item.id ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </nav>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Workspace */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-5 py-3.5">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="rounded-lg border border-slate-200 p-2 text-slate-600 lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <h1 className="truncate font-display text-lg font-bold text-slate-900">{activeNav.label}</h1>
              <div className="text-xs text-slate-500 truncate">
                {bootstrap.settings.shop_name} · Currency: {bootstrap.settings.currency || 'PKR'}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => navigateTo('quick-stock')}
              className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap"
            >
              <Plus className="h-4 w-4 text-blue-600" />
              Quick Stock Entry
            </button>
            <button
              type="button"
              onClick={() => navigateTo('pos')}
              className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700 whitespace-nowrap"
            >
              <ShoppingCart className="h-4 w-4" />
              Open POS
            </button>
          </div>
        </header>

        <main className="flex-1 p-5 lg:p-6" key={activeView}>
          {activeView === 'dashboard' && (
            <DashboardView
              settings={bootstrap.settings}
              refreshTick={refreshTick}
              onNavigate={navigateTo}
              onOpenInvoice={(saleId) => setInvoiceModalSaleId(saleId)}
            />
          )}
          {activeView === 'quick-stock' && (
            <QuickStockEntryView
              bootstrap={bootstrap}
              currentUser={currentUser}
              settings={bootstrap.settings}
              preselectedProductId={preselectedProductId}
              onDataChanged={handleDataChanged}
            />
          )}
          {activeView === 'pos' && (
            <PosView
              bootstrap={bootstrap}
              currentUser={currentUser}
              settings={bootstrap.settings}
              onDataChanged={handleDataChanged}
              onOpenInvoice={(saleId) => setInvoiceModalSaleId(saleId)}
            />
          )}
          {activeView === 'products' && (
            <ProductsView
              bootstrap={bootstrap}
              currentUser={currentUser}
              settings={bootstrap.settings}
              onDataChanged={handleDataChanged}
              onQuickAddStock={(productId) => navigateTo('quick-stock', productId)}
            />
          )}
          {activeView === 'purchases' && (
            <PurchasesView
              bootstrap={bootstrap}
              currentUser={currentUser}
              settings={bootstrap.settings}
              onDataChanged={handleDataChanged}
            />
          )}
          {activeView === 'serials' && (
            <SerialsView
              settings={bootstrap.settings}
              currentUser={currentUser}
              onDataChanged={handleDataChanged}
            />
          )}
          {activeView === 'history' && (
            <HistoryAndSmartView
              bootstrap={bootstrap}
              currentUser={currentUser}
              settings={bootstrap.settings}
              onDataChanged={handleDataChanged}
            />
          )}
          {activeView === 'parties' && (
            <PartiesView
              settings={bootstrap.settings}
              currentUser={currentUser}
              onDataChanged={handleDataChanged}
            />
          )}
          {activeView === 'reports' && (
            <ReportsView settings={bootstrap.settings} currentUser={currentUser} onDataChanged={handleDataChanged} />
          )}
          {activeView === 'settings' && (
            <SettingsBackupView
              settings={bootstrap.settings}
              users={bootstrap.users}
              currentUser={currentUser}
              onSettingsUpdated={handleDataChanged}
            />
          )}
        </main>
      </div>

      <InvoiceModal
        saleId={invoiceModalSaleId}
        settings={bootstrap.settings}
        onClose={() => setInvoiceModalSaleId(null)}
      />
    </div>
  );
}
