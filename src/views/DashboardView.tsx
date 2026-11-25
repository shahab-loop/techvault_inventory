import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Package,
  Plus,
  ShoppingCart,
  TrendingUp,
} from 'lucide-react';
import { AppSettings, AppView, Product } from '../types';
import { apiFetch } from '../utils/api';
import { formatCurrency, formatDate } from '../utils/format';

interface DashboardResponse {
  summary: {
    total_products: number;
    total_quantity: number;
    total_purchase_value: number;
    total_sale_value: number;
    out_of_stock_count: number;
    low_stock_count: number;
    today_sales: number;
    today_sale_count: number;
    today_purchases: number;
    today_purchase_count: number;
    today_expenses?: number;
    today_profit: number;
    total_receivables?: number;
    total_payables?: number;
  };
  lowStockProducts: Product[];
  recentTransactions: Array<{
    tx_type: 'sale' | 'purchase';
    id: number;
    invoice_no: string;
    tx_date: string;
    total: number;
    paid_amount: number;
    payment_status: string;
    status: string;
    party_name: string;
  }>;
  topSelling: Array<{
    id: number;
    name: string;
    sku: string;
    current_stock: number;
    units_sold: number;
    revenue: number;
    profit: number;
  }>;
  dailyChart: Array<{
    date: string;
    label: string;
    sales: number;
    profit: number;
    purchases: number;
  }>;
  categoryValuation: Array<{
    category: string;
    product_count: number;
    stock_qty: number;
    purchase_value: number;
    sale_value: number;
  }>;
}

interface DashboardViewProps {
  settings: AppSettings;
  refreshTick: number;
  onNavigate: (view: AppView, productId?: number) => void;
  onOpenInvoice: (saleId: number) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  settings,
  refreshTick,
  onNavigate,
  onOpenInvoice,
}) => {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const currency = settings.currency || 'PKR';

  const loadDashboard = (silent = false) => {
    if (!silent && !data) setLoading(true);
    apiFetch<DashboardResponse>('/api/dashboard')
      .then((res) => {
        setData(res);
        setError('');
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadDashboard(Boolean(data));
  }, [refreshTick]);

  useEffect(() => {
    const onFocus = () => loadDashboard(true);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') loadDashboard(true);
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    const timer = window.setInterval(() => loadDashboard(true), 10000);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(timer);
    };
  }, []);

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg border border-slate-200 bg-white p-4" />
          ))}
        </div>
        <div className="h-72 animate-pulse rounded-lg border border-slate-200 bg-white" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-700">
        Failed to load dashboard metrics: {error}
      </div>
    );
  }

  if (!data) return null;

  const { summary, lowStockProducts, recentTransactions, topSelling, dailyChart, categoryValuation } = data;
  const maxChartVal = Math.max(1, ...dailyChart.map((d) => Math.max(d.sales, d.purchases)));

  return (
    <div className="space-y-6">
      {/* Primary KPI Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">Today&apos;s Sales</div>
          <div className="mt-1.5 font-mono text-2xl font-bold text-slate-900 tabular-nums">
            {formatCurrency(summary.today_sales, currency)}
          </div>
          <div className="mt-1 text-xs text-slate-500 tabular-nums">
            {summary.today_sale_count} invoice(s) issued today
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">Today&apos;s Gross Profit</div>
          <div className="mt-1.5 font-mono text-2xl font-bold text-emerald-700 tabular-nums">
            {formatCurrency(summary.today_profit, currency)}
          </div>
          <div className="mt-1 text-xs text-slate-500 tabular-nums">
            Today&apos;s expenses: {formatCurrency(summary.today_expenses || 0, currency)}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">Today&apos;s Purchases</div>
          <div className="mt-1.5 font-mono text-2xl font-bold text-slate-900 tabular-nums">
            {formatCurrency(summary.today_purchases, currency)}
          </div>
          <div className="mt-1 text-xs text-slate-500 tabular-nums">
            {summary.today_purchase_count} batch(es) · Payables: {formatCurrency(summary.total_payables || 0, currency)}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">Stock Alerts</div>
          <div className="mt-1.5 flex items-baseline gap-3">
            <span className="font-mono text-2xl font-bold text-amber-700 tabular-nums">
              {summary.low_stock_count} Low
            </span>
            <span className="text-slate-300">/</span>
            <span className="font-mono text-2xl font-bold text-red-700 tabular-nums">
              {summary.out_of_stock_count} Out
            </span>
          </div>
          <div className="mt-1 text-xs text-slate-500">Requires immediate replenishment</div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">Total Catalog SKUs</div>
          <div className="mt-1.5 font-mono text-xl font-bold text-slate-900 tabular-nums">
            {summary.total_products} Products
          </div>
          <div className="mt-1 text-xs text-slate-500 tabular-nums">
            {summary.total_quantity} total units in stock
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">Total Stock Quantity</div>
          <div className="mt-1.5 font-mono text-xl font-bold text-slate-900 tabular-nums">
            {summary.total_quantity.toLocaleString()} Units
          </div>
          <div className="mt-1 text-xs text-slate-500">Across all shop locations</div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">Inventory Cost Valuation</div>
          <div className="mt-1.5 font-mono text-xl font-bold text-slate-900 tabular-nums">
            {formatCurrency(summary.total_purchase_value, currency)}
          </div>
          <div className="mt-1 text-xs text-slate-500">At current purchase cost</div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">Estimated Retail Value</div>
          <div className="mt-1.5 font-mono text-xl font-bold text-blue-700 tabular-nums">
            {formatCurrency(summary.total_sale_value, currency)}
          </div>
          <div className="mt-1 text-xs text-slate-500 tabular-nums">
            Est. margin: {formatCurrency(summary.total_sale_value - summary.total_purchase_value, currency)}
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-5 lg:col-span-2">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-slate-900">7-Day Sales, Purchases &amp; Profit</h2>
              <p className="text-xs text-slate-500">Daily counter cashflow overview from local SQLite records</p>
            </div>
            <div className="flex items-center gap-4 text-xs text-slate-600">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-sm bg-blue-600" /> Sales
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-600" /> Profit
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-sm bg-slate-300" /> Purchases
              </span>
            </div>
          </div>

          <div className="grid h-56 grid-cols-7 items-end gap-3 border-b border-slate-200 pt-4 pb-2">
            {dailyChart.map((day) => {
              const saleH = Math.max(4, Math.round((day.sales / maxChartVal) * 165));
              const profitH = Math.max(4, Math.round((Math.max(0, day.profit) / maxChartVal) * 165));
              const purH = Math.max(4, Math.round((day.purchases / maxChartVal) * 165));
              return (
                <div key={day.date} className="group flex flex-col items-center justify-end gap-1.5">
                  <div className="flex h-44 items-end gap-1">
                    <div
                      title={`Sales: ${formatCurrency(day.sales, currency)}`}
                      style={{ height: `${day.sales > 0 ? saleH : 3}px` }}
                      className="w-3 rounded-t bg-blue-600 transition-opacity group-hover:opacity-85"
                    />
                    <div
                      title={`Profit: ${formatCurrency(day.profit, currency)}`}
                      style={{ height: `${day.profit > 0 ? profitH : 3}px` }}
                      className="w-3 rounded-t bg-emerald-600 transition-opacity group-hover:opacity-85"
                    />
                    <div
                      title={`Purchases: ${formatCurrency(day.purchases, currency)}`}
                      style={{ height: `${day.purchases > 0 ? purH : 3}px` }}
                      className="w-3 rounded-t bg-slate-300 transition-opacity group-hover:opacity-85"
                    />
                  </div>
                  <span className="text-[11px] font-medium text-slate-600 whitespace-nowrap">{day.label}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Category Stock Value Breakdown */}
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="mb-4">
            <h2 className="text-base font-semibold text-slate-900">Stock Valuation by Category</h2>
            <p className="text-xs text-slate-500">Estimated retail value distribution</p>
          </div>
          <div className="space-y-3">
            {categoryValuation.slice(0, 6).map((cat) => {
              const totalRetail = Math.max(1, summary.total_sale_value);
              const pct = Math.min(100, Math.round((cat.sale_value / totalRetail) * 100));
              return (
                <div key={cat.category} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="truncate font-medium text-slate-800">{cat.category}</span>
                    <span className="font-mono text-slate-700 tabular-nums">
                      {formatCurrency(cat.sale_value, currency)}
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded bg-slate-100">
                    <div className="h-full rounded bg-blue-600" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="text-[11px] text-slate-500 tabular-nums">
                    {cat.product_count} SKUs · {cat.stock_qty} units
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Bottom Tables: Low Stock Alerts + Top Selling + Recent Transactions */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* Low / Out of Stock Table */}
        <div className="rounded-lg border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <h2 className="text-base font-semibold text-slate-900">Low &amp; Out-of-Stock Alerts</h2>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('quick-stock')}
              className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
            >
              <Plus className="h-3.5 w-3.5" /> Quick Restock
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                  <th className="px-4 py-2.5">Product / SKU</th>
                  <th className="px-4 py-2.5 text-right">Stock</th>
                  <th className="px-4 py-2.5 text-right">Min</th>
                  <th className="px-4 py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {lowStockProducts.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-xs text-slate-500">
                      All products are above their minimum stock threshold.
                    </td>
                  </tr>
                ) : (
                  lowStockProducts.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-slate-900">{p.name}</div>
                        <div className="font-mono text-xs text-slate-500">{p.sku}</div>
                      </td>
                      <td
                        className={`px-4 py-2.5 text-right font-mono font-semibold tabular-nums ${
                          p.quantity === 0 ? 'text-red-700' : 'text-amber-700'
                        }`}
                      >
                        {p.quantity === 0 ? '0 (Out)' : p.quantity}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-slate-600 tabular-nums">{p.min_stock}</td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => onNavigate('quick-stock', p.id)}
                          className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        >
                          Add Stock
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Top Selling & Recent Activity */}
        <div className="space-y-6">
          <div className="rounded-lg border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-emerald-600" />
                <h2 className="text-base font-semibold text-slate-900">Top-Selling Hardware</h2>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('reports')}
                className="text-xs font-medium text-blue-600 hover:text-blue-700"
              >
                Full Report
              </button>
            </div>
            <div className="divide-y divide-slate-200">
              {topSelling.length === 0 ? (
                <div className="px-5 py-6 text-center text-xs text-slate-500">No sales recorded yet.</div>
              ) : (
                topSelling.map((item) => (
                  <div key={item.id} className="flex items-center justify-between px-5 py-3 text-sm">
                    <div className="min-w-0 pr-4">
                      <div className="truncate font-medium text-slate-900">{item.name}</div>
                      <div className="font-mono text-xs text-slate-500">
                        {item.sku} · {item.current_stock} left in stock
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-mono font-semibold text-slate-900 tabular-nums">
                        {item.units_sold} sold · {formatCurrency(item.revenue, currency)}
                      </div>
                      <div className="font-mono text-xs text-emerald-700 tabular-nums">
                        Profit: {formatCurrency(item.profit, currency)}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div className="flex items-center gap-2">
                <ShoppingCart className="h-4 w-4 text-blue-600" />
                <h2 className="text-base font-semibold text-slate-900">Recent Transactions</h2>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('pos')}
                className="text-xs font-medium text-blue-600 hover:text-blue-700"
              >
                Open POS
              </button>
            </div>
            <div className="divide-y divide-slate-200">
              {recentTransactions.slice(0, 6).map((tx) => (
                <div key={`${tx.tx_type}-${tx.id}`} className="flex items-center justify-between px-5 py-3 text-sm">
                  <div className="flex items-center gap-3 min-w-0">
                    {tx.tx_type === 'sale' ? (
                      <ArrowUpRight className="h-4 w-4 shrink-0 text-emerald-600" />
                    ) : (
                      <ArrowDownLeft className="h-4 w-4 shrink-0 text-blue-600" />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-slate-900">{tx.invoice_no}</span>
                        <span className="text-xs text-slate-500">· {tx.party_name}</span>
                      </div>
                      <div className="text-xs text-slate-500">
                        {formatDate(tx.tx_date, true)} · {tx.payment_status.toUpperCase()}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="font-mono font-semibold text-slate-900 tabular-nums">
                      {formatCurrency(tx.total, currency)}
                    </span>
                    {tx.tx_type === 'sale' && (
                      <button
                        type="button"
                        onClick={() => onOpenInvoice(tx.id)}
                        className="rounded border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                      >
                        Receipt
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {recentTransactions.length === 0 && (
                <div className="flex flex-col items-center gap-2 py-8 text-xs text-slate-500">
                  <Package className="h-5 w-5 text-slate-400" />
                  <span>No transactions recorded yet.</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
