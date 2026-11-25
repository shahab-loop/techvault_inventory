import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  Eye,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { AppSettings, BootstrapData, Product, PurchaseInvoice, User } from '../types';
import { apiFetch } from '../utils/api';
import { formatCurrency, formatDate, playScanBeep } from '../utils/format';
import { CameraScannerModal } from '../components/QrComponents';

interface PurchaseDraftItem {
  product: Product;
  quantity: number;
  unitCost: number;
  serialNumbers: string[];
}

interface PurchasesViewProps {
  bootstrap: BootstrapData;
  currentUser: User;
  settings: AppSettings;
  onDataChanged: () => void;
}

export const PurchasesView: React.FC<PurchasesViewProps> = ({
  bootstrap,
  currentUser,
  settings,
  onDataChanged,
}) => {
  const [tab, setTab] = useState<'new' | 'list'>('list');
  const [products, setProducts] = useState<Product[]>([]);
  const [purchases, setPurchases] = useState<PurchaseInvoice[]>([]);
  const [supplierId, setSupplierId] = useState<string>(String(bootstrap.suppliers[0]?.id || ''));
  const [locationId, setLocationId] = useState<string>(
    String(bootstrap.locations.find((l) => l.is_default)?.id || bootstrap.locations[0]?.id || 1)
  );
  const [scanInput, setScanInput] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [items, setItems] = useState<PurchaseDraftItem[]>([]);
  const [discount, setDiscount] = useState(0);
  const [paidAmount, setPaidAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [detailData, setDetailData] = useState<any>(null);
  const [returnQuantities, setReturnQuantities] = useState<Record<number, number>>({});

  const currency = settings.currency || 'PKR';

  const loadData = async () => {
    const [prods, purs] = await Promise.all([
      apiFetch<Product[]>('/api/products'),
      apiFetch<PurchaseInvoice[]>('/api/purchases'),
    ]);
    setProducts(prods);
    setPurchases(purs);
  };

  useEffect(() => {
    loadData();
  }, []);

  const subtotal = items.reduce((sum, it) => sum + it.quantity * it.unitCost, 0);
  const total = Math.max(0, subtotal - discount);

  const addProductRow = (prod: Product) => {
    setItems((prev) => {
      if (prev.some((i) => i.product.id === prod.id)) return prev;
      return [
        ...prev,
        {
          product: prod,
          quantity: 1,
          unitCost: prod.purchase_price,
          serialNumbers: prod.serial_tracking === 1 ? [''] : [],
        },
      ];
    });
  };

  const handleScanCode = async (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;
    try {
      const res = await apiFetch<{ matchType: string; product: Product | null }>(
        `/api/lookup?code=${encodeURIComponent(trimmed)}`
      );
      if (res.product) {
        addProductRow(res.product);
        setScanInput('');
        playScanBeep(true);
      } else {
        playScanBeep(false);
        setMessage({ type: 'error', text: `No product matched code "${trimmed}".` });
      }
    } catch {
      playScanBeep(false);
    }
  };

  const handleSubmitPurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supplierId || items.length === 0) {
      setMessage({ type: 'error', text: 'Select a supplier and add at least one product.' });
      return;
    }
    setSubmitting(true);
    setMessage(null);
    try {
      const created = await apiFetch<{ invoice_no: string }>('/api/purchases', {
        method: 'POST',
        body: JSON.stringify({
          supplier_id: Number(supplierId),
          location_id: Number(locationId),
          user_id: currentUser.id,
          discount,
          paid_amount: paidAmount === '' ? total : Number(paidAmount),
          notes,
          items: items.map((it) => ({
            product_id: it.product.id,
            quantity: it.quantity,
            unit_cost: it.unitCost,
            serial_numbers: it.serialNumbers.map((s) => s.trim()).filter(Boolean),
          })),
        }),
      });
      setItems([]);
      setDiscount(0);
      setPaidAmount('');
      setNotes('');
      await loadData();
      onDataChanged();
      setTab('list');
      setMessage({ type: 'success', text: `Purchase ${created.invoice_no} recorded and stock updated.` });
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Purchase failed' });
    } finally {
      setSubmitting(false);
    }
  };

  const openDetail = async (id: number) => {
    const res = await apiFetch<any>(`/api/purchases/${id}`);
    setDetailData(res);
    const map: Record<number, number> = {};
    for (const it of res.items) map[it.id] = 0;
    setReturnQuantities(map);
  };

  const handleReturnToSupplier = async () => {
    if (!detailData) return;
    const returnItems = detailData.items
      .filter((it: any) => (returnQuantities[it.id] || 0) > 0)
      .map((it: any) => ({ purchase_item_id: it.id, quantity: returnQuantities[it.id] }));
    if (returnItems.length === 0) return;

    try {
      await apiFetch(`/api/purchases/${detailData.purchase.id}/return`, {
        method: 'POST',
        body: JSON.stringify({ items: returnItems, user_id: currentUser.id }),
      });
      setDetailData(null);
      await loadData();
      onDataChanged();
      setMessage({ type: 'success', text: 'Supplier return processed and stock adjusted.' });
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Supplier return failed' });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-lg bg-slate-200/70 p-1">
          <button
            type="button"
            onClick={() => setTab('list')}
            className={`rounded-md px-4 py-1.5 text-xs font-semibold ${
              tab === 'list' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            Purchase Invoices ({purchases.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('new')}
            className={`flex items-center gap-1 rounded-md px-4 py-1.5 text-xs font-semibold ${
              tab === 'new' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            <Plus className="h-3.5 w-3.5" /> New Purchase Batch
          </button>
        </div>
      </div>

      {message && (
        <div
          className={`flex items-center gap-2 rounded-lg border p-3 text-sm ${
            message.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-red-200 bg-red-50 text-red-800'
          }`}
        >
          {message.type === 'success' ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          <span>{message.text}</span>
        </div>
      )}

      {tab === 'new' ? (
        <form onSubmit={handleSubmitPurchase} className="space-y-5 rounded-xl border border-slate-200 bg-white p-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700">Supplier *</label>
              <select
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                {bootstrap.suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700">Receiving Location</label>
              <select
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                {bootstrap.locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700">Scan QR / Barcode or Pick Product</label>
              <div className="mt-1 flex gap-1.5">
                <input
                  type="text"
                  value={scanInput}
                  onChange={(e) => setScanInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleScanCode(scanInput);
                    }
                  }}
                  placeholder="Scan QR / SKU..."
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={() => setCameraOpen(true)}
                  className="rounded-lg border border-slate-300 px-2.5 py-2 text-slate-600 hover:bg-slate-50"
                >
                  <Camera className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <select
              onChange={(e) => {
                const found = products.find((p) => p.id === Number(e.target.value));
                if (found) addProductRow(found);
                e.target.value = '';
              }}
              defaultValue=""
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="" disabled>
                + Add product from catalog...
              </option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.sku}) — Current Cost: {formatCurrency(p.purchase_price, currency)}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-3">
            {items.map((it, idx) => (
              <div key={it.product.id} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{it.product.name}</div>
                    <div className="font-mono text-xs text-slate-500">
                      {it.product.sku} · {it.product.serial_tracking ? 'Serial Tracked' : 'Bulk'}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div>
                      <label className="block text-[10px] font-semibold text-slate-500">Qty</label>
                      <input
                        type="number"
                        min={1}
                        value={it.quantity}
                        onChange={(e) => {
                          const qty = Math.max(1, Math.floor(Number(e.target.value) || 1));
                          setItems((prev) =>
                            prev.map((row, rIdx) =>
                              rIdx === idx
                                ? {
                                    ...row,
                                    quantity: qty,
                                    serialNumbers:
                                      row.product.serial_tracking === 1
                                        ? Array.from({ length: qty }, (_, i) => row.serialNumbers[i] || '')
                                        : [],
                                  }
                                : row
                            )
                          );
                        }}
                        className="w-20 rounded border border-slate-300 bg-white px-2 py-1 font-mono text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-slate-500">Unit Cost ({currency})</label>
                      <input
                        type="number"
                        min={0}
                        value={it.unitCost}
                        onChange={(e) => {
                          const cost = Math.max(0, Number(e.target.value) || 0);
                          setItems((prev) => prev.map((row, rIdx) => (rIdx === idx ? { ...row, unitCost: cost } : row)));
                        }}
                        className="w-28 rounded border border-slate-300 bg-white px-2 py-1 font-mono text-xs"
                      />
                    </div>
                    <div className="w-28 text-right font-mono text-sm font-bold text-slate-900 tabular-nums">
                      {formatCurrency(it.quantity * it.unitCost, currency)}
                    </div>
                    <button
                      type="button"
                      onClick={() => setItems((prev) => prev.filter((_, rIdx) => rIdx !== idx))}
                      className="text-slate-400 hover:text-red-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {it.product.serial_tracking === 1 && (
                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {it.serialNumbers.map((sn, snIdx) => (
                      <input
                        key={snIdx}
                        type="text"
                        required
                        value={sn}
                        onChange={(e) => {
                          const val = e.target.value;
                          setItems((prev) =>
                            prev.map((row, rIdx) =>
                              rIdx === idx
                                ? {
                                    ...row,
                                    serialNumbers: row.serialNumbers.map((s, sI) => (sI === snIdx ? val : s)),
                                  }
                                : row
                            )
                          );
                        }}
                        placeholder={`Serial #${snIdx + 1}`}
                        className="rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs"
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-4 border-t border-slate-200 pt-4 sm:grid-cols-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700">Discount ({currency})</label>
              <input
                type="number"
                min={0}
                value={discount}
                onChange={(e) => setDiscount(Math.max(0, Number(e.target.value) || 0))}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700">Paid Now ({currency})</label>
              <input
                type="number"
                min={0}
                max={total}
                value={paidAmount}
                onChange={(e) => setPaidAmount(e.target.value)}
                placeholder={String(total)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700">Notes</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Supplier invoice ref or shipping note..."
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-slate-200 pt-4">
            <div className="font-mono text-lg font-bold text-slate-900 tabular-nums">
              Total Payable: {formatCurrency(total, currency)}
            </div>
            <button
              type="submit"
              disabled={items.length === 0 || submitting}
              className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? 'Saving Purchase...' : 'Save Purchase & Update Stock'}
            </button>
          </div>
        </form>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                  <th className="px-4 py-3">Purchase #</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Supplier</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-right">Paid</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {purchases.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-900">{p.invoice_no}</td>
                    <td className="px-4 py-3 text-xs text-slate-600">{formatDate(p.purchase_date, true)}</td>
                    <td className="px-4 py-3 text-sm text-slate-800">{p.supplier_name}</td>
                    <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums">
                      {formatCurrency(p.total, currency)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-slate-600 tabular-nums">
                      {formatCurrency(p.paid_amount, currency)}
                    </td>
                    <td className="px-4 py-3 text-xs font-medium">
                      <span className={p.payment_status === 'paid' ? 'text-emerald-700' : 'text-amber-700'}>
                        {p.status.toUpperCase()} · {p.payment_status.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => openDetail(p.id)}
                        className="inline-flex items-center gap-1 rounded border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                      >
                        <Eye className="h-3.5 w-3.5" /> Inspect / Return
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {detailData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="border-b border-slate-200 px-5 py-4">
              <h3 className="text-base font-semibold text-slate-900">
                Purchase {detailData.purchase.invoice_no} — {detailData.purchase.supplier_name}
              </h3>
              <p className="text-xs text-slate-500">
                Total: {formatCurrency(detailData.purchase.total, currency)} · Paid:{' '}
                {formatCurrency(detailData.purchase.paid_amount, currency)}
              </p>
            </div>
            <div className="space-y-3 p-5">
              {detailData.items.map((it: any) => {
                const rem = it.quantity - (it.returned_qty || 0);
                return (
                  <div key={it.id} className="flex items-center justify-between rounded-lg border border-slate-200 p-3 text-xs">
                    <div>
                      <div className="font-semibold text-slate-900">{it.product_name}</div>
                      <div className="font-mono text-slate-500">
                        Qty: {it.quantity} · Cost: {formatCurrency(it.unit_cost, currency)} · Returnable: {rem}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-500">Return Qty:</span>
                      <input
                        type="number"
                        min={0}
                        max={rem}
                        value={returnQuantities[it.id] || 0}
                        onChange={(e) =>
                          setReturnQuantities((prev) => ({
                            ...prev,
                            [it.id]: Math.min(rem, Math.max(0, Number(e.target.value) || 0)),
                          }))
                        }
                        className="w-16 rounded border border-slate-300 px-2 py-1 text-right font-mono"
                      />
                    </div>
                  </div>
                );
              })}

              <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
                <button
                  type="button"
                  onClick={() => setDetailData(null)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={handleReturnToSupplier}
                  className="flex items-center gap-1 rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-700"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Return Selected to Supplier
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <CameraScannerModal isOpen={cameraOpen} onClose={() => setCameraOpen(false)} onScan={handleScanCode} />
    </div>
  );
};
