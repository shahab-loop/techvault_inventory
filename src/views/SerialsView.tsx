import React, { useEffect, useState } from 'react';
import { History, Printer, QrCode, Search, ShieldCheck, X } from 'lucide-react';
import { AppSettings, SerialRecord, StockMovement, User } from '../types';
import { apiFetch } from '../utils/api';
import { formatCurrency, formatDate } from '../utils/format';
import { PrintableQrLabel, QrCodeImage, QrLabelPrintModal } from '../components/QrComponents';

interface SerialsViewProps {
  settings: AppSettings;
  currentUser: User;
  onDataChanged: () => void;
}

export const SerialsView: React.FC<SerialsViewProps> = ({ settings, currentUser, onDataChanged }) => {
  const [serials, setSerials] = useState<SerialRecord[]>([]);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  const [historyData, setHistoryData] = useState<{ serial: SerialRecord; movements: StockMovement[] } | null>(null);
  const [printLabels, setPrintLabels] = useState<PrintableQrLabel[] | null>(null);

  const currency = settings.currency || 'PKR';

  const loadSerials = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set('q', query.trim());
      if (statusFilter !== 'all') params.set('status', statusFilter);
      const list = await apiFetch<SerialRecord[]>(`/api/serials?${params.toString()}`);
      setSerials(list);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSerials();
  }, [query, statusFilter]);

  const openHistory = async (id: number) => {
    const res = await apiFetch<{ serial: SerialRecord; movements: StockMovement[] }>(`/api/serials/${id}/history`);
    setHistoryData(res);
  };

  const updateStatus = async (id: number, status: string) => {
    await apiFetch(`/api/serials/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, user_id: currentUser.id }),
    });
    await loadSerials();
    onDataChanged();
    if (historyData?.serial.id === id) {
      await openHistory(id);
    }
  };

  const getWarrantyDisplay = (sn: SerialRecord) => {
    if (!sn.warranty_expiry) return sn.warranty_months ? `${sn.warranty_months}m (starts on sale)` : 'No warranty';
    const expired = new Date(sn.warranty_expiry) < new Date();
    return `${formatDate(sn.warranty_expiry)} (${expired ? 'Expired' : 'Active'})`;
  };

  const filterTabs = [
    { id: 'all', label: 'All Units' },
    { id: 'available', label: 'Available' },
    { id: 'sold', label: 'Sold' },
    { id: 'returned', label: 'Returned' },
    { id: 'under_warranty', label: 'Under Warranty' },
    { id: 'warranty_active', label: 'Active Warranty' },
    { id: 'warranty_expired', label: 'Expired Warranty' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative min-w-[280px] flex-1 max-w-md">
          <Search className="absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search serial number, product, invoice, customer..."
            className="w-full rounded-lg border border-slate-300 bg-white py-2 pr-3 pl-9 text-sm focus:border-blue-600 focus:outline-none"
          />
        </div>

        <button
          type="button"
          disabled={serials.length === 0}
          onClick={() =>
            setPrintLabels(
              serials.slice(0, 40).map((sn) => ({
                title: sn.product_name || 'Hardware Unit',
                subtitle: `S/N: ${sn.serial_number}`,
                code: sn.serial_qr,
                priceText: formatCurrency(sn.product_sale_price || 0, currency),
                badgeText: 'UNIT SERIAL QR',
              }))
            )
          }
          className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <Printer className="h-4 w-4" />
          Print Filtered Labels ({Math.min(40, serials.length)})
        </button>
      </div>

      <div className="flex flex-wrap gap-1 rounded-lg bg-slate-200/70 p-1">
        {filterTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setStatusFilter(t.id)}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
              statusFilter === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                <th className="px-4 py-3">Serial Number</th>
                <th className="px-4 py-3">Product &amp; Model</th>
                <th className="px-4 py-3">Purchase / Supplier</th>
                <th className="px-4 py-3">Sale / Customer / Invoice</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Warranty</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-xs text-slate-500">
                    Loading serial tracking ledger...
                  </td>
                </tr>
              ) : serials.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-xs text-slate-500">
                    No serial numbers match the active filter.
                  </td>
                </tr>
              ) : (
                serials.map((sn) => (
                  <tr key={sn.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="font-mono text-xs font-bold text-slate-900">{sn.serial_number}</div>
                      <div className="font-mono text-[10px] text-slate-500">{sn.location_name || 'Main Counter'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-xs font-semibold text-slate-900">{sn.product_name}</div>
                      <div className="font-mono text-[11px] text-slate-500">{sn.product_model || sn.product_sku}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      <div>{sn.supplier_name || 'Direct Entry'}</div>
                      <div className="font-mono text-[11px] text-slate-500 tabular-nums">
                        {formatDate(sn.purchase_date)} · {formatCurrency(sn.purchase_price, currency)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {sn.sale_invoice_no ? (
                        <>
                          <div className="font-mono font-semibold text-slate-900">{sn.sale_invoice_no}</div>
                          <div>
                            {sn.customer_name} · {formatDate(sn.sale_date)}
                          </div>
                        </>
                      ) : (
                        <span className="text-slate-400">In Stock (Unsold)</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs font-semibold">
                      <span
                        className={
                          sn.status === 'available'
                            ? 'text-emerald-700'
                            : sn.status === 'sold'
                            ? 'text-blue-700'
                            : sn.status === 'under_warranty'
                            ? 'text-amber-700'
                            : 'text-red-700'
                        }
                      >
                        {sn.status.replace('_', ' ').toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">{getWarrantyDisplay(sn)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            setPrintLabels([
                              {
                                title: sn.product_name || 'Hardware Unit',
                                subtitle: `S/N: ${sn.serial_number}`,
                                code: sn.serial_qr,
                                priceText: formatCurrency(sn.product_sale_price || 0, currency),
                                badgeText: 'UNIT SERIAL QR',
                              },
                            ])
                          }
                          title="Print Unit Serial QR"
                          className="rounded border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100"
                        >
                          <QrCode className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openHistory(sn.id)}
                          title="Inspect History & Warranty"
                          className="rounded border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100"
                        >
                          <History className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Serial Lifecycle & Warranty Modal */}
      {historyData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="flex max-h-[88vh] w-full max-w-xl flex-col rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div className="flex items-center gap-3">
                <QrCodeImage value={historyData.serial.serial_qr} size={52} />
                <div>
                  <h3 className="font-mono text-base font-bold text-slate-900">{historyData.serial.serial_number}</h3>
                  <p className="text-xs text-slate-500">{historyData.serial.product_name}</p>
                </div>
              </div>
              <button type="button" onClick={() => setHistoryData(null)} className="text-slate-400 hover:text-slate-900">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 overflow-y-auto p-5 text-xs">
              <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div>
                  <span className="text-slate-500">Purchase Date:</span>{' '}
                  <strong>{formatDate(historyData.serial.purchase_date)}</strong>
                </div>
                <div>
                  <span className="text-slate-500">Purchase Cost:</span>{' '}
                  <strong className="font-mono">{formatCurrency(historyData.serial.purchase_price, currency)}</strong>
                </div>
                <div>
                  <span className="text-slate-500">Supplier:</span>{' '}
                  <strong>{historyData.serial.supplier_name || '—'}</strong>
                </div>
                <div>
                  <span className="text-slate-500">Customer:</span>{' '}
                  <strong>{historyData.serial.customer_name || 'Not sold'}</strong>
                </div>
                <div>
                  <span className="text-slate-500">Invoice:</span>{' '}
                  <strong className="font-mono">{historyData.serial.sale_invoice_no || '—'}</strong>
                </div>
                <div>
                  <span className="text-slate-500">Warranty:</span>{' '}
                  <strong>{getWarrantyDisplay(historyData.serial)}</strong>
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center gap-1.5 font-semibold text-slate-700">
                  <ShieldCheck className="h-4 w-4 text-blue-600" /> Update Unit Status / RMA
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(['available', 'under_warranty', 'returned', 'damaged'] as const).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => updateStatus(historyData.serial.id, st)}
                      className={`rounded border px-3 py-1.5 font-medium capitalize ${
                        historyData.serial.status === st
                          ? 'border-blue-600 bg-blue-600 text-white'
                          : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {st.replace('_', ' ')}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-2 font-semibold text-slate-700">Related Stock Ledger Events</div>
                <div className="divide-y divide-slate-200 rounded-lg border border-slate-200">
                  {historyData.movements.map((m) => (
                    <div key={m.id} className="flex items-center justify-between p-2.5">
                      <div>
                        <div className="font-medium text-slate-900">{m.movement_type}</div>
                        <div className="text-slate-500">{m.notes || m.reference_no}</div>
                      </div>
                      <div className="text-right text-slate-500">{formatDate(m.created_at, true)}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <QrLabelPrintModal
        isOpen={Boolean(printLabels)}
        onClose={() => setPrintLabels(null)}
        labels={printLabels || []}
        shopName={settings.shop_name}
      />
    </div>
  );
};
