import React, { useEffect, useState } from 'react';
import { ArrowLeftRight, ClipboardList, Plus, TrendingUp, Warehouse, X } from 'lucide-react';
import { AppSettings, BootstrapData, Product, SerialRecord, StockMovement, User } from '../types';
import { apiFetch } from '../utils/api';
import { formatCurrency, formatDate } from '../utils/format';

interface HistoryAndSmartViewProps {
  bootstrap: BootstrapData;
  currentUser: User;
  settings: AppSettings;
  onDataChanged: () => void;
}

export const HistoryAndSmartView: React.FC<HistoryAndSmartViewProps> = ({
  bootstrap,
  currentUser,
  settings,
  onDataChanged,
}) => {
  const [tab, setTab] = useState<'movements' | 'forecast' | 'locations'>('movements');
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [forecast, setForecast] = useState<any[]>([]);
  const [transfers, setTransfers] = useState<any[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [typeFilter, setTypeFilter] = useState('all');
  const [searchQ, setSearchQ] = useState('');

  // Adjustment modal
  const [adjOpen, setAdjOpen] = useState(false);
  const [adjForm, setAdjForm] = useState({
    product_id: '',
    location_id: String(bootstrap.locations[0]?.id || 1),
    movement_type: 'adjustment',
    quantity_change: '-1',
    notes: '',
  });
  const [adjError, setAdjError] = useState('');

  // Transfer form
  const [trfForm, setTrfForm] = useState({
    product_id: '',
    from_location_id: String(bootstrap.locations[0]?.id || 1),
    to_location_id: String(bootstrap.locations[1]?.id || bootstrap.locations[0]?.id || 1),
    quantity: '1',
    notes: '',
  });
  const [trfSerials, setTrfSerials] = useState<SerialRecord[]>([]);
  const [selectedTrfSerialIds, setSelectedTrfSerialIds] = useState<number[]>([]);
  const [trfMessage, setTrfMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Add Location modal
  const [newLocName, setNewLocName] = useState('');
  const [newLocCode, setNewLocCode] = useState('');

  const currency = settings.currency || 'PKR';

  const loadAll = async () => {
    const params = new URLSearchParams();
    if (typeFilter !== 'all') params.set('type', typeFilter);
    if (searchQ.trim()) params.set('q', searchQ.trim());

    const [movs, fc, trfs, prods] = await Promise.all([
      apiFetch<StockMovement[]>(`/api/movements?${params.toString()}`),
      apiFetch<any[]>('/api/analytics/forecasting'),
      apiFetch<any[]>('/api/transfers'),
      apiFetch<Product[]>('/api/products'),
    ]);
    setMovements(movs);
    setForecast(fc);
    setTransfers(trfs);
    setProducts(prods);
    if (!adjForm.product_id && prods[0]) {
      setAdjForm((f) => ({ ...f, product_id: String(prods[0].id) }));
    }
    if (!trfForm.product_id && prods[0]) {
      setTrfForm((f) => ({ ...f, product_id: String(prods[0].id) }));
    }
  };

  useEffect(() => {
    loadAll();
  }, [typeFilter, searchQ]);

  useEffect(() => {
    if (!trfForm.product_id) return;
    apiFetch<SerialRecord[]>(`/api/serials?productId=${trfForm.product_id}&status=available`).then((list) => {
      setTrfSerials(list.filter((s) => String(s.location_id) === trfForm.from_location_id));
      setSelectedTrfSerialIds([]);
    });
  }, [trfForm.product_id, trfForm.from_location_id]);

  const submitAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdjError('');
    try {
      await apiFetch('/api/stock/adjust', {
        method: 'POST',
        body: JSON.stringify({
          product_id: Number(adjForm.product_id),
          location_id: Number(adjForm.location_id),
          movement_type: adjForm.movement_type,
          quantity_change: Number(adjForm.quantity_change),
          notes: adjForm.notes,
          user_id: currentUser.id,
        }),
      });
      setAdjOpen(false);
      await loadAll();
      onDataChanged();
    } catch (err) {
      setAdjError(err instanceof Error ? err.message : 'Adjustment failed');
    }
  };

  const submitTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    setTrfMessage(null);
    try {
      await apiFetch('/api/transfers', {
        method: 'POST',
        body: JSON.stringify({
          product_id: Number(trfForm.product_id),
          from_location_id: Number(trfForm.from_location_id),
          to_location_id: Number(trfForm.to_location_id),
          quantity: Number(trfForm.quantity),
          serial_ids: selectedTrfSerialIds,
          notes: trfForm.notes,
          user_id: currentUser.id,
        }),
      });
      setTrfMessage({ type: 'success', text: 'Stock transfer completed successfully.' });
      await loadAll();
      onDataChanged();
    } catch (err) {
      setTrfMessage({ type: 'error', text: err instanceof Error ? err.message : 'Transfer failed' });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-lg bg-slate-200/70 p-1">
          <button
            type="button"
            onClick={() => setTab('movements')}
            className={`flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-semibold ${
              tab === 'movements' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            <ClipboardList className="h-3.5 w-3.5" /> Movement History
          </button>
          <button
            type="button"
            onClick={() => setTab('forecast')}
            className={`flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-semibold ${
              tab === 'forecast' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            <TrendingUp className="h-3.5 w-3.5" /> Smart Forecasting &amp; Reorder
          </button>
          <button
            type="button"
            onClick={() => setTab('locations')}
            className={`flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-semibold ${
              tab === 'locations' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            <Warehouse className="h-3.5 w-3.5" /> Multi-Location &amp; Transfers
          </button>
        </div>

        {tab === 'movements' && (
          <button
            type="button"
            onClick={() => setAdjOpen(true)}
            className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800"
          >
            <Plus className="h-3.5 w-3.5" /> Log Stock Adjustment / Damage
          </button>
        )}
      </div>

      {tab === 'movements' && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder="Search product, SKU, invoice ref, or notes..."
              className="min-w-[240px] flex-1 max-w-sm rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            />
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="all">All Movement Types</option>
              <option value="initial">Initial Stock</option>
              <option value="purchase">Purchase</option>
              <option value="manual_add">Manual / Quick Add</option>
              <option value="sale">Sale</option>
              <option value="customer_return">Customer Return</option>
              <option value="supplier_return">Supplier Return</option>
              <option value="adjustment">Adjustment</option>
              <option value="damaged">Damaged</option>
              <option value="lost">Lost</option>
              <option value="transfer_in">Transfer In</option>
              <option value="transfer_out">Transfer Out</option>
            </select>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                    <th className="px-4 py-3">Date &amp; Time</th>
                    <th className="px-4 py-3">Product</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3 text-right">Prev</th>
                    <th className="px-4 py-3 text-right">Change</th>
                    <th className="px-4 py-3 text-right">New Qty</th>
                    <th className="px-4 py-3">User / Location</th>
                    <th className="px-4 py-3">Reference / Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {movements.map((m) => (
                    <tr key={m.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 text-xs text-slate-600">{formatDate(m.created_at, true)}</td>
                      <td className="px-4 py-2.5">
                        <div className="text-xs font-semibold text-slate-900">{m.product_name}</div>
                        <div className="font-mono text-[11px] text-slate-500">{m.product_sku}</div>
                      </td>
                      <td className="px-4 py-2.5 text-xs font-medium text-slate-700">
                        {m.movement_type.replace('_', ' ').toUpperCase()}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums">{m.previous_qty}</td>
                      <td
                        className={`px-4 py-2.5 text-right font-mono text-xs font-bold tabular-nums ${
                          m.change_qty >= 0 ? 'text-emerald-700' : 'text-red-700'
                        }`}
                      >
                        {m.change_qty >= 0 ? `+${m.change_qty}` : m.change_qty}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold text-slate-900 tabular-nums">
                        {m.new_qty}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-600">
                        <div>{m.user_name || 'Staff'}</div>
                        <div className="text-[11px] text-slate-400">{m.location_name || 'Main Counter'}</div>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-600">
                        {m.reference_no && <span className="font-mono font-semibold text-slate-800">{m.reference_no} · </span>}
                        {m.notes}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'forecast' && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-5 py-4">
            <h3 className="text-base font-semibold text-slate-900">Demand Forecasting &amp; Reorder Planner</h3>
            <p className="text-xs text-slate-500">
              Calculated from 30-day sales velocity and minimum stock thresholds
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3 text-right">Current Stock</th>
                  <th className="px-4 py-3 text-right">Sold (30d)</th>
                  <th className="px-4 py-3 text-right">Daily Velocity</th>
                  <th className="px-4 py-3 text-right">Days Cover</th>
                  <th className="px-4 py-3">Urgency</th>
                  <th className="px-4 py-3 text-right">Suggested Reorder</th>
                  <th className="px-4 py-3 text-right">Est. Purchase Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {forecast.map((f) => (
                  <tr key={f.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="text-xs font-semibold text-slate-900">{f.name}</div>
                      <div className="font-mono text-[11px] text-slate-500">{f.sku}</div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs font-bold tabular-nums">{f.quantity}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">{f.units_sold_30d}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">{f.avg_daily_sales}/day</td>
                    <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                      {f.days_remaining >= 999 ? '30+ days' : `${f.days_remaining}d`}
                    </td>
                    <td className="px-4 py-3 text-xs font-semibold">
                      <span
                        className={
                          f.urgency === 'critical'
                            ? 'text-red-700'
                            : f.urgency === 'warning'
                            ? 'text-amber-700'
                            : 'text-emerald-700'
                        }
                      >
                        {f.urgency.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs font-bold text-blue-700 tabular-nums">
                      +{f.suggested_reorder}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-slate-700 tabular-nums">
                      {formatCurrency(f.estimated_reorder_cost, currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'locations' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Stock Transfer Form */}
          <form onSubmit={submitTransfer} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 lg:col-span-5">
            <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
              <ArrowLeftRight className="h-4 w-4 text-blue-600" />
              <h3 className="text-sm font-bold text-slate-900">Transfer Stock Between Locations</h3>
            </div>
            {trfMessage && (
              <div
                className={`rounded-lg border p-2.5 text-xs ${
                  trfMessage.type === 'success'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border-red-200 bg-red-50 text-red-800'
                }`}
              >
                {trfMessage.text}
              </div>
            )}
            <div>
              <label className="block text-xs font-semibold text-slate-700">Product</label>
              <select
                value={trfForm.product_id}
                onChange={(e) => setTrfForm({ ...trfForm, product_id: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.sku})
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700">From Location</label>
                <select
                  value={trfForm.from_location_id}
                  onChange={(e) => setTrfForm({ ...trfForm, from_location_id: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs"
                >
                  {bootstrap.locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700">To Location</label>
                <select
                  value={trfForm.to_location_id}
                  onChange={(e) => setTrfForm({ ...trfForm, to_location_id: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs"
                >
                  {bootstrap.locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {products.find((p) => String(p.id) === trfForm.product_id)?.serial_tracking === 1 ? (
              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  Select Serials to Transfer ({selectedTrfSerialIds.length} selected)
                </label>
                <div className="mt-1 max-h-36 space-y-1 overflow-y-auto rounded border border-slate-200 p-2">
                  {trfSerials.map((sn) => (
                    <label key={sn.id} className="flex items-center gap-2 font-mono text-xs">
                      <input
                        type="checkbox"
                        checked={selectedTrfSerialIds.includes(sn.id)}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...selectedTrfSerialIds, sn.id]
                            : selectedTrfSerialIds.filter((id) => id !== sn.id);
                          setSelectedTrfSerialIds(next);
                          setTrfForm((f) => ({ ...f, quantity: String(Math.max(1, next.length)) }));
                        }}
                      />
                      <span>{sn.serial_number}</span>
                    </label>
                  ))}
                  {trfSerials.length === 0 && (
                    <div className="text-xs text-slate-400">No available serials at source location.</div>
                  )}
                </div>
              </div>
            ) : (
              <div>
                <label className="block text-xs font-semibold text-slate-700">Quantity</label>
                <input
                  type="number"
                  min={1}
                  value={trfForm.quantity}
                  onChange={(e) => setTrfForm({ ...trfForm, quantity: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs"
                />
              </div>
            )}

            <input
              type="text"
              value={trfForm.notes}
              onChange={(e) => setTrfForm({ ...trfForm, notes: e.target.value })}
              placeholder="Transfer reason / shelf note..."
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
            />
            <button
              type="submit"
              className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-700"
            >
              Execute Location Transfer
            </button>

            <div className="border-t border-slate-200 pt-4">
              <div className="text-xs font-bold text-slate-700">Add New Warehouse / Shop Location</div>
              <div className="mt-2 flex gap-2">
                <input
                  type="text"
                  value={newLocName}
                  onChange={(e) => setNewLocName(e.target.value)}
                  placeholder="Location name"
                  className="flex-1 rounded border border-slate-300 px-2.5 py-1.5 text-xs"
                />
                <input
                  type="text"
                  value={newLocCode}
                  onChange={(e) => setNewLocCode(e.target.value)}
                  placeholder="Code (e.g. LOC-B2)"
                  className="w-28 rounded border border-slate-300 px-2.5 py-1.5 font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={async () => {
                    if (!newLocName.trim() || !newLocCode.trim()) return;
                    await apiFetch('/api/locations', {
                      method: 'POST',
                      body: JSON.stringify({ name: newLocName, code: newLocCode }),
                    });
                    setNewLocName('');
                    setNewLocCode('');
                    onDataChanged();
                  }}
                  className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white"
                >
                  Add
                </button>
              </div>
            </div>
          </form>

          {/* Location Stock Matrix & Transfer Log */}
          <div className="space-y-5 lg:col-span-7">
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900">
                Stock Breakdown by Location
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                      <th className="px-4 py-2.5">Product</th>
                      {bootstrap.locations.map((l) => (
                        <th key={l.id} className="px-4 py-2.5 text-right">
                          {l.name}
                        </th>
                      ))}
                      <th className="px-4 py-2.5 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {products.map((p) => (
                      <tr key={p.id}>
                        <td className="px-4 py-2.5 font-medium text-slate-900">{p.name}</td>
                        {bootstrap.locations.map((l) => {
                          const ls = p.location_stocks?.find((s) => s.location_id === l.id);
                          return (
                            <td key={l.id} className="px-4 py-2.5 text-right font-mono tabular-nums">
                              {ls ? ls.quantity : 0}
                            </td>
                          );
                        })}
                        <td className="px-4 py-2.5 text-right font-mono font-bold tabular-nums">{p.quantity}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900">
                Recent Stock Transfers
              </div>
              <div className="divide-y divide-slate-200 text-xs">
                {transfers.length === 0 ? (
                  <div className="p-6 text-center text-slate-400">No inter-location transfers recorded yet.</div>
                ) : (
                  transfers.map((t) => (
                    <div key={t.id} className="flex items-center justify-between px-4 py-3">
                      <div>
                        <div className="font-semibold text-slate-900">
                          <span className="font-mono">{t.transfer_no}</span> · {t.product_name}
                        </div>
                        <div className="text-slate-500">
                          {t.from_location_name} → {t.to_location_name}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono font-bold text-slate-900">{t.quantity} unit(s)</div>
                        <div className="text-slate-400">{formatDate(t.created_at, true)}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Stock Adjustment Modal */}
      {adjOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h3 className="text-base font-semibold text-slate-900">Stock Adjustment / Damaged / Lost</h3>
              <button type="button" onClick={() => setAdjOpen(false)} className="text-slate-400 hover:text-slate-900">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={submitAdjustment} className="space-y-3 p-5 text-xs">
              {adjError && <div className="rounded bg-red-50 p-2 text-red-700">{adjError}</div>}
              <div>
                <label className="block font-semibold text-slate-700">Product</label>
                <select
                  value={adjForm.product_id}
                  onChange={(e) => setAdjForm({ ...adjForm, product_id: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} (Stock: {p.quantity})
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700">Movement Type</label>
                  <select
                    value={adjForm.movement_type}
                    onChange={(e) => setAdjForm({ ...adjForm, movement_type: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                  >
                    <option value="adjustment">Stock Adjustment</option>
                    <option value="damaged">Damaged Stock</option>
                    <option value="lost">Lost / Shrinkage</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700">Quantity Change (+/-)</label>
                  <input
                    type="number"
                    value={adjForm.quantity_change}
                    onChange={(e) => setAdjForm({ ...adjForm, quantity_change: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="block font-semibold text-slate-700">Location</label>
                <select
                  value={adjForm.location_id}
                  onChange={(e) => setAdjForm({ ...adjForm, location_id: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                >
                  {bootstrap.locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700">Audit Notes *</label>
                <input
                  type="text"
                  required
                  value={adjForm.notes}
                  onChange={(e) => setAdjForm({ ...adjForm, notes: e.target.value })}
                  placeholder="Reason for adjustment..."
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setAdjOpen(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 font-medium text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800"
                >
                  Record Movement
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
