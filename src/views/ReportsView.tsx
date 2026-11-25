import React, { useEffect, useState } from 'react';
import { Download, FileSpreadsheet, Plus, Printer, Trash2 } from 'lucide-react';
import { AppSettings, User } from '../types';
import { apiFetch } from '../utils/api';
import { exportTableToPdf, exportToExcel, formatCurrency, formatDate } from '../utils/format';

interface ReportsViewProps {
  settings: AppSettings;
  currentUser: User;
  onDataChanged?: () => void;
}

type ReportTab = 'pnl' | 'sales' | 'purchases' | 'valuation' | 'balances' | 'expenses';

export const ReportsView: React.FC<ReportsViewProps> = ({ settings, currentUser, onDataChanged }) => {
  const [tab, setTab] = useState<ReportTab>('pnl');
  const [preset, setPreset] = useState<'today' | 'month' | 'year' | 'all'>('all');
  const [startDate, setStartDate] = useState('2020-01-01');
  const [endDate, setEndDate] = useState('2030-12-31');
  const [data, setData] = useState<any>(null);

  const [expForm, setExpForm] = useState({ category: 'Utilities', title: '', amount: '', notes: '' });
  const currency = settings.currency || 'PKR';

  const applyPreset = (p: 'today' | 'month' | 'year' | 'all') => {
    setPreset(p);
    const now = new Date();
    if (p === 'today') {
      const d = now.toISOString().slice(0, 10);
      setStartDate(d);
      setEndDate(d);
    } else if (p === 'month') {
      setStartDate(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`);
      setEndDate(now.toISOString().slice(0, 10));
    } else if (p === 'year') {
      setStartDate(`${now.getFullYear()}-01-01`);
      setEndDate(`${now.getFullYear()}-12-31`);
    } else {
      setStartDate('2020-01-01');
      setEndDate('2030-12-31');
    }
  };

  const loadReports = async () => {
    const res = await apiFetch<any>(`/api/reports/summary?startDate=${startDate}&endDate=${endDate}`);
    setData(res);
  };

  useEffect(() => {
    loadReports();
  }, [startDate, endDate]);

  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!expForm.title || !expForm.amount) return;
    await apiFetch('/api/expenses', {
      method: 'POST',
      body: JSON.stringify({ ...expForm, amount: Number(expForm.amount), user_id: currentUser.id }),
    });
    setExpForm({ category: 'Utilities', title: '', amount: '', notes: '' });
    await loadReports();
    onDataChanged?.();
  };

  const handleExportExcel = () => {
    if (!data) return;
    if (tab === 'sales') {
      exportToExcel(`sales-report-${startDate}`, 'Sales', data.salesRows);
    } else if (tab === 'purchases') {
      exportToExcel(`purchases-report-${startDate}`, 'Purchases', data.purchaseRows);
    } else if (tab === 'valuation') {
      exportToExcel(`stock-valuation-${startDate}`, 'Valuation', data.stockValuation);
    } else if (tab === 'expenses') {
      exportToExcel(`expenses-report-${startDate}`, 'Expenses', data.expenseRows);
    } else if (tab === 'balances') {
      exportToExcel(`customer-balances-${startDate}`, 'Customers', data.customerBalances);
    } else {
      exportToExcel(`product-profit-${startDate}`, 'Product Profit', data.productProfit);
    }
  };

  const handleExportPdf = () => {
    if (!data) return;
    if (tab === 'sales') {
      exportTableToPdf({
        title: 'Sales Report',
        subtitle: `Period: ${startDate} to ${endDate}`,
        shopName: settings.shop_name,
        columns: ['Invoice', 'Date', 'Customer', 'Total', 'Paid', 'Status'],
        rows: data.salesRows.map((s: any) => [
          s.invoice_no,
          formatDate(s.sale_date),
          s.customer_name,
          formatCurrency(s.total, currency),
          formatCurrency(s.paid_amount, currency),
          s.payment_status,
        ]),
        filename: `sales-report-${startDate}.pdf`,
      });
    } else if (tab === 'valuation') {
      exportTableToPdf({
        title: 'Stock Valuation Report',
        subtitle: `Generated: ${new Date().toLocaleDateString()}`,
        shopName: settings.shop_name,
        columns: ['SKU', 'Product', 'Qty', 'Cost Value', 'Retail Value'],
        rows: data.stockValuation.map((v: any) => [
          v.sku,
          v.name,
          v.quantity,
          formatCurrency(v.total_cost_value, currency),
          formatCurrency(v.total_retail_value, currency),
        ]),
        filename: `stock-valuation-${startDate}.pdf`,
      });
    } else {
      exportTableToPdf({
        title: 'Product-Wise Profit & Loss Report',
        subtitle: `Period: ${startDate} to ${endDate}`,
        shopName: settings.shop_name,
        columns: ['SKU', 'Product', 'Units Sold', 'Revenue', 'COGS', 'Gross Profit'],
        rows: data.productProfit.map((p: any) => [
          p.sku,
          p.name,
          p.units_sold,
          formatCurrency(p.revenue, currency),
          formatCurrency(p.cogs, currency),
          formatCurrency(p.gross_profit, currency),
        ]),
        filename: `profit-loss-${startDate}.pdf`,
      });
    }
  };

  if (!data) return <div className="p-8 text-sm text-slate-500">Loading analytics...</div>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          {(['today', 'month', 'year', 'all'] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => applyPreset(p)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold capitalize ${
                preset === p ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {p === 'all' ? 'All Time' : `This ${p}`}
            </button>
          ))}
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="rounded border border-slate-300 px-2.5 py-1 text-xs"
          />
          <span className="text-xs text-slate-400">to</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="rounded border border-slate-300 px-2.5 py-1 text-xs"
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExportExcel}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
            Export Excel
          </button>
          <button
            type="button"
            onClick={handleExportPdf}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Download className="h-4 w-4 text-red-600" />
            Export PDF
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
          >
            <Printer className="h-4 w-4" />
            Print
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 rounded-lg bg-slate-200/70 p-1">
        {[
          { id: 'pnl', label: 'Profit & Loss' },
          { id: 'sales', label: 'Sales Report' },
          { id: 'purchases', label: 'Purchases Report' },
          { id: 'valuation', label: 'Stock Valuation' },
          { id: 'balances', label: 'Customer & Supplier Balances' },
          { id: 'expenses', label: 'Expenses' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id as ReportTab)}
            className={`rounded-md px-3.5 py-1.5 text-xs font-semibold ${
              tab === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'pnl' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="text-xs text-slate-500">Total Sales Revenue</div>
              <div className="mt-1 font-mono text-xl font-bold text-slate-900 tabular-nums">
                {formatCurrency(data.pnl.totalRevenue, currency)}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="text-xs text-slate-500">Cost of Goods Sold (COGS)</div>
              <div className="mt-1 font-mono text-xl font-bold text-slate-700 tabular-nums">
                {formatCurrency(data.pnl.totalCogs, currency)}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="text-xs text-slate-500">Operating Expenses</div>
              <div className="mt-1 font-mono text-xl font-bold text-amber-700 tabular-nums">
                {formatCurrency(data.pnl.totalExpenses, currency)}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="text-xs text-slate-500">Net Profit</div>
              <div
                className={`mt-1 font-mono text-xl font-bold tabular-nums ${
                  data.pnl.netProfit >= 0 ? 'text-emerald-700' : 'text-red-700'
                }`}
              >
                {formatCurrency(data.pnl.netProfit, currency)}
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-5 py-3 text-sm font-semibold text-slate-900">
              Product-Wise Profit Breakdown
            </div>
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                  <th className="px-4 py-2.5">Product</th>
                  <th className="px-4 py-2.5 text-right">Units Sold</th>
                  <th className="px-4 py-2.5 text-right">Revenue</th>
                  <th className="px-4 py-2.5 text-right">COGS</th>
                  <th className="px-4 py-2.5 text-right">Gross Profit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {data.productProfit.map((p: any) => (
                  <tr key={p.id}>
                    <td className="px-4 py-2.5 font-medium text-slate-900">{p.name}</td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums">{p.units_sold}</td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatCurrency(p.revenue, currency)}</td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatCurrency(p.cogs, currency)}</td>
                    <td className="px-4 py-2.5 text-right font-mono font-bold text-emerald-700 tabular-nums">
                      {formatCurrency(p.gross_profit, currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'sales' && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                <th className="px-4 py-3">Invoice</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3 text-right">Paid</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {data.salesRows.map((s: any) => (
                <tr key={s.id}>
                  <td className="px-4 py-2.5 font-mono font-semibold">{s.invoice_no}</td>
                  <td className="px-4 py-2.5">{formatDate(s.sale_date, true)}</td>
                  <td className="px-4 py-2.5">{s.customer_name}</td>
                  <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums">
                    {formatCurrency(s.total, currency)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                    {formatCurrency(s.paid_amount, currency)}
                  </td>
                  <td className="px-4 py-2.5 uppercase">{s.payment_status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'purchases' && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                <th className="px-4 py-3">Purchase #</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Supplier</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3 text-right">Paid</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {data.purchaseRows.map((p: any) => (
                <tr key={p.id}>
                  <td className="px-4 py-2.5 font-mono font-semibold">{p.invoice_no}</td>
                  <td className="px-4 py-2.5">{formatDate(p.purchase_date, true)}</td>
                  <td className="px-4 py-2.5">{p.supplier_name}</td>
                  <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums">
                    {formatCurrency(p.total, currency)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                    {formatCurrency(p.paid_amount, currency)}
                  </td>
                  <td className="px-4 py-2.5 uppercase">{p.payment_status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'valuation' && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                <th className="px-4 py-3">SKU</th>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3 text-right">Qty</th>
                <th className="px-4 py-3 text-right">Unit Cost</th>
                <th className="px-4 py-3 text-right">Cost Value</th>
                <th className="px-4 py-3 text-right">Retail Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {data.stockValuation.map((v: any) => (
                <tr key={v.id}>
                  <td className="px-4 py-2.5 font-mono">{v.sku}</td>
                  <td className="px-4 py-2.5 font-medium text-slate-900">{v.name}</td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums">{v.quantity}</td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                    {formatCurrency(v.purchase_price, currency)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums">
                    {formatCurrency(v.total_cost_value, currency)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono font-semibold text-blue-700 tabular-nums">
                    {formatCurrency(v.total_retail_value, currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'balances' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900">
              Customer Receivables
            </div>
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                  <th className="px-4 py-2.5">Customer</th>
                  <th className="px-4 py-2.5 text-right">Billed</th>
                  <th className="px-4 py-2.5 text-right">Due</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {data.customerBalances.map((c: any) => (
                  <tr key={c.id}>
                    <td className="px-4 py-2.5 font-medium">{c.name}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{formatCurrency(c.total_billed, currency)}</td>
                    <td className="px-4 py-2.5 text-right font-mono font-bold text-amber-700">
                      {formatCurrency(c.balance_due, currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900">
              Supplier Payables
            </div>
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                  <th className="px-4 py-2.5">Supplier</th>
                  <th className="px-4 py-2.5 text-right">Billed</th>
                  <th className="px-4 py-2.5 text-right">Payable</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {data.supplierBalances.map((s: any) => (
                  <tr key={s.id}>
                    <td className="px-4 py-2.5 font-medium">{s.name}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{formatCurrency(s.total_billed, currency)}</td>
                    <td className="px-4 py-2.5 text-right font-mono font-bold text-red-700">
                      {formatCurrency(s.balance_due, currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'expenses' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <form onSubmit={handleAddExpense} className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 lg:col-span-4">
            <h3 className="text-sm font-bold text-slate-900">Log Shop Expense</h3>
            <div>
              <label className="block text-xs font-semibold text-slate-700">Category</label>
              <select
                value={expForm.category}
                onChange={(e) => setExpForm({ ...expForm, category: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
              >
                <option value="Utilities">Utilities / Electricity</option>
                <option value="Rent">Shop Rent</option>
                <option value="Salaries">Staff Salaries</option>
                <option value="Logistics">Courier &amp; Packaging</option>
                <option value="Maintenance">Shop Maintenance</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700">Expense Title *</label>
              <input
                type="text"
                required
                value={expForm.title}
                onChange={(e) => setExpForm({ ...expForm, title: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700">Amount ({currency}) *</label>
              <input
                type="number"
                required
                min={1}
                value={expForm.amount}
                onChange={(e) => setExpForm({ ...expForm, amount: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs"
              />
            </div>
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white"
            >
              <Plus className="h-3.5 w-3.5" /> Record Expense
            </button>
          </form>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white lg:col-span-8">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Description</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-right">Remove</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {data.expenseRows.map((ex: any) => (
                  <tr key={ex.id}>
                    <td className="px-4 py-2.5">{formatDate(ex.expense_date)}</td>
                    <td className="px-4 py-2.5">{ex.category}</td>
                    <td className="px-4 py-2.5 font-medium text-slate-900">{ex.title}</td>
                    <td className="px-4 py-2.5 text-right font-mono font-semibold">{formatCurrency(ex.amount, currency)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={async () => {
                          await apiFetch(`/api/expenses/${ex.id}`, { method: 'DELETE' });
                          await loadReports();
                          onDataChanged?.();
                        }}
                        className="text-slate-400 hover:text-red-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
