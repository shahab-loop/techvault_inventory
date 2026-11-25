import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  Edit3,
  History,
  Package,
  Plus,
  Printer,
  QrCode,
  Search,
  Tags,
  Trash2,
  X,
} from 'lucide-react';
import { AppSettings, BootstrapData, Product, StockMovement, User } from '../types';
import { apiFetch } from '../utils/api';
import { formatCurrency, formatDate } from '../utils/format';
import { PrintableQrLabel, QrCodeImage, QrLabelPrintModal } from '../components/QrComponents';

interface ProductsViewProps {
  bootstrap: BootstrapData;
  currentUser: User;
  settings: AppSettings;
  onDataChanged: () => void;
  onQuickAddStock: (productId: number) => void;
}

export const ProductsView: React.FC<ProductsViewProps> = ({
  bootstrap,
  currentUser,
  settings,
  onDataChanged,
  onQuickAddStock,
}) => {
  const [products, setProducts] = useState<Product[]>([]);
  const [query, setQuery] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [stockFilter, setStockFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Product Form Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState({
    name: '',
    brand_id: '',
    category_id: '',
    model: '',
    sku: '',
    barcode: '',
    purchase_price: '0',
    sale_price: '0',
    wholesale_price: '0',
    quantity: '0',
    min_stock: '5',
    warranty_months: '12',
    serial_tracking: true,
    image_url: '',
    description: '',
    serial_numbers_text: '',
  });

  // Categories & Brands Manager Modal
  const [taxoModalOpen, setTaxoModalOpen] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newBrandName, setNewBrandName] = useState('');

  // History Drawer Modal
  const [historyProduct, setHistoryProduct] = useState<{
    product: Product;
    movements: StockMovement[];
  } | null>(null);

  // Print QR & Delete Confirmation
  const [printLabels, setPrintLabels] = useState<PrintableQrLabel[] | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);

  const currency = settings.currency || 'PKR';

  const loadProducts = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set('q', query.trim());
      if (catFilter) params.set('categoryId', catFilter);
      if (stockFilter) params.set('stockStatus', stockFilter);
      const list = await apiFetch<Product[]>(`/api/products?${params.toString()}`);
      setProducts(list);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load products');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProducts();
  }, [query, catFilter, stockFilter]);

  const openCreateModal = () => {
    setEditing(null);
    setForm({
      name: '',
      brand_id: String(bootstrap.brands[0]?.id || ''),
      category_id: String(bootstrap.categories[0]?.id || ''),
      model: '',
      sku: '',
      barcode: '',
      purchase_price: '0',
      sale_price: '0',
      wholesale_price: '0',
      quantity: '0',
      min_stock: settings.low_stock_default || '5',
      warranty_months: '12',
      serial_tracking: true,
      image_url: '',
      description: '',
      serial_numbers_text: '',
    });
    setModalOpen(true);
  };

  const openEditModal = (p: Product) => {
    setEditing(p);
    setForm({
      name: p.name,
      brand_id: String(p.brand_id || ''),
      category_id: String(p.category_id || ''),
      model: p.model || '',
      sku: p.sku,
      barcode: p.barcode || '',
      purchase_price: String(p.purchase_price),
      sale_price: String(p.sale_price),
      wholesale_price: String(p.wholesale_price),
      quantity: String(p.quantity),
      min_stock: String(p.min_stock),
      warranty_months: String(p.warranty_months),
      serial_tracking: p.serial_tracking === 1,
      image_url: p.image_url || '',
      description: p.description || '',
      serial_numbers_text: '',
    });
    setModalOpen(true);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setForm((f) => ({ ...f, image_url: reader.result as string }));
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      if (editing) {
        await apiFetch(`/api/products/${editing.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            ...form,
            brand_id: form.brand_id ? Number(form.brand_id) : null,
            category_id: form.category_id ? Number(form.category_id) : null,
            purchase_price: Number(form.purchase_price),
            sale_price: Number(form.sale_price),
            wholesale_price: Number(form.wholesale_price),
            min_stock: Number(form.min_stock),
            warranty_months: Number(form.warranty_months),
          }),
        });
      } else {
        const serials = form.serial_numbers_text
          .split(/[\n,]+/)
          .map((s) => s.trim())
          .filter(Boolean);
        await apiFetch('/api/products', {
          method: 'POST',
          body: JSON.stringify({
            ...form,
            brand_id: form.brand_id ? Number(form.brand_id) : null,
            category_id: form.category_id ? Number(form.category_id) : null,
            purchase_price: Number(form.purchase_price),
            sale_price: Number(form.sale_price),
            wholesale_price: Number(form.wholesale_price),
            quantity: Number(form.quantity),
            min_stock: Number(form.min_stock),
            warranty_months: Number(form.warranty_months),
            serial_numbers: serials,
            user_id: currentUser.id,
          }),
        });
      }
      setModalOpen(false);
      await loadProducts();
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    }
  };

  const handleDeleteProduct = async () => {
    if (!deleteTarget) return;
    try {
      await apiFetch(`/api/products/${deleteTarget.id}?force=true`, { method: 'DELETE' });
      setDeleteTarget(null);
      setError('');
      await loadProducts();
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
      setDeleteTarget(null);
    }
  };

  const openHistory = async (p: Product) => {
    const res = await apiFetch<{ product: Product; movements: StockMovement[] }>(`/api/products/${p.id}`);
    setHistoryProduct({ product: res.product, movements: res.movements });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[260px]">
            <Search className="absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, model, SKU, barcode, serial..."
              className="w-full rounded-lg border border-slate-300 bg-white py-2 pr-3 pl-9 text-sm focus:border-blue-600 focus:outline-none"
            />
          </div>
          <select
            value={catFilter}
            onChange={(e) => setCatFilter(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">All Categories</option>
            {bootstrap.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            value={stockFilter}
            onChange={(e) => setStockFilter(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">All Stock States</option>
            <option value="in">Healthy Stock</option>
            <option value="low">Low Stock</option>
            <option value="out">Out of Stock</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setTaxoModalOpen(true)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <Tags className="h-4 w-4" />
            Categories &amp; Brands
          </button>
          <button
            type="button"
            onClick={openCreateModal}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            Add Product
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                <th className="px-4 py-3">Product &amp; Model</th>
                <th className="px-4 py-3">SKU / QR Code</th>
                <th className="px-4 py-3">Category / Brand</th>
                <th className="px-4 py-3 text-right">Cost</th>
                <th className="px-4 py-3 text-right">Sale Price</th>
                <th className="px-4 py-3 text-right">Stock</th>
                <th className="px-4 py-3">Tracking</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-xs text-slate-500">
                    Loading hardware catalog...
                  </td>
                </tr>
              ) : products.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-xs text-slate-500">
                    No matching products found.
                  </td>
                </tr>
              ) : (
                products.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {p.image_url ? (
                          <img
                            src={p.image_url}
                            alt={p.name}
                            referrerPolicy="no-referrer"
                            className="h-10 w-10 shrink-0 rounded border border-slate-200 object-cover"
                          />
                        ) : (
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-slate-200 bg-slate-50 text-slate-400">
                            <Package className="h-4 w-4" />
                          </div>
                        )}
                        <div>
                          <div className="font-semibold text-slate-900">{p.name}</div>
                          <div className="text-xs text-slate-500">{p.model || 'Standard Model'}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-mono text-xs font-semibold text-slate-900">{p.sku}</div>
                      <div className="font-mono text-[11px] text-slate-500">{p.qr_code}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      <div>{p.category_name || '—'}</div>
                      <div className="text-slate-400">{p.brand_name || '—'}</div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-slate-700 tabular-nums">
                      {formatCurrency(p.purchase_price, currency)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs font-semibold text-slate-900 tabular-nums">
                      {formatCurrency(p.sale_price, currency)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span
                        className={`font-mono text-sm font-bold tabular-nums ${
                          p.quantity === 0
                            ? 'text-red-700'
                            : p.quantity <= p.min_stock
                            ? 'text-amber-700'
                            : 'text-emerald-700'
                        }`}
                      >
                        {p.quantity}
                      </span>
                      <div className="text-[11px] text-slate-400">Min: {p.min_stock}</div>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <span className={p.serial_tracking ? 'font-medium text-blue-700' : 'text-slate-500'}>
                        {p.serial_tracking ? 'Serial Tracked' : 'Bulk Qty'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => onQuickAddStock(p.id)}
                          className="rounded border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
                        >
                          +Stock
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setPrintLabels([
                              {
                                title: p.name,
                                subtitle: `${p.sku}${p.model ? ` · ${p.model}` : ''}`,
                                code: p.qr_code,
                                priceText: formatCurrency(p.sale_price, currency),
                                badgeText: 'PRODUCT QR',
                              },
                            ])
                          }
                          title="Print Product QR"
                          className="rounded border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100"
                        >
                          <QrCode className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openHistory(p)}
                          title="View Product History"
                          className="rounded border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100"
                        >
                          <History className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditModal(p)}
                          title="Edit Product"
                          className="rounded border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(p)}
                          title="Delete Product"
                          className="rounded border border-slate-200 p-1.5 text-red-600 hover:bg-red-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
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

      {/* Add / Edit Product Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h3 className="text-base font-semibold text-slate-900">
                {editing ? `Edit Product — ${editing.sku}` : 'Add New Product'}
              </h3>
              <button type="button" onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-slate-900">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveProduct} className="space-y-4 overflow-y-auto p-5">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700">Product Name *</label>
                  <input
                    type="text"
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Category</label>
                  <select
                    value={form.category_id}
                    onChange={(e) => setForm({ ...form, category_id: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">-- None --</option>
                    {bootstrap.categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Brand</label>
                  <select
                    value={form.brand_id}
                    onChange={(e) => setForm({ ...form, brand_id: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">-- None --</option>
                    {bootstrap.brands.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Model Number</label>
                  <input
                    type="text"
                    value={form.model}
                    onChange={(e) => setForm({ ...form, model: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">SKU (Unique) *</label>
                  <input
                    type="text"
                    required
                    value={form.sku}
                    onChange={(e) => setForm({ ...form, sku: e.target.value.toUpperCase() })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Barcode (EAN/UPC)</label>
                  <input
                    type="text"
                    value={form.barcode}
                    onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Warranty (Months)</label>
                  <input
                    type="number"
                    min={0}
                    value={form.warranty_months}
                    onChange={(e) => setForm({ ...form, warranty_months: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Purchase Price ({currency})</label>
                  <input
                    type="number"
                    min={0}
                    value={form.purchase_price}
                    onChange={(e) => setForm({ ...form, purchase_price: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Sale Price ({currency})</label>
                  <input
                    type="number"
                    min={0}
                    value={form.sale_price}
                    onChange={(e) => setForm({ ...form, sale_price: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Wholesale Price ({currency})</label>
                  <input
                    type="number"
                    min={0}
                    value={form.wholesale_price}
                    onChange={(e) => setForm({ ...form, wholesale_price: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Minimum Stock Alert</label>
                  <input
                    type="number"
                    min={0}
                    value={form.min_stock}
                    onChange={(e) => setForm({ ...form, min_stock: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
                  />
                </div>

                {!editing && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">Initial Quantity</label>
                    <input
                      type="number"
                      min={0}
                      value={form.quantity}
                      onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-slate-700">Product Image (Local Upload)</label>
                  <input type="file" accept="image/*" onChange={handleImageUpload} className="mt-1 block w-full text-xs" />
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs font-semibold text-slate-800">
                <input
                  type="checkbox"
                  checked={form.serial_tracking}
                  onChange={(e) => setForm({ ...form, serial_tracking: e.target.checked })}
                />
                Enable individual unit serial number tracking
              </label>

              {!editing && form.serial_tracking && Number(form.quantity) > 0 && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Initial Serial Numbers (one per line or comma-separated, {form.quantity} required)
                  </label>
                  <textarea
                    rows={3}
                    value={form.serial_numbers_text}
                    onChange={(e) => setForm({ ...form, serial_numbers_text: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 p-2 font-mono text-xs"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700">Description / Specs</label>
                <textarea
                  rows={2}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm"
                />
              </div>

              <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                >
                  {editing ? 'Save Changes' : 'Create Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Categories & Brands Manager */}
      {taxoModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="w-full max-w-xl rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h3 className="text-base font-semibold text-slate-900">Manage Categories &amp; Brands</h3>
              <button type="button" onClick={() => setTaxoModalOpen(false)} className="text-slate-400 hover:text-slate-900">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="grid grid-cols-1 gap-6 p-5 sm:grid-cols-2">
              <div>
                <h4 className="text-xs font-bold text-slate-700">Categories</h4>
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!newCatName.trim()) return;
                    await apiFetch('/api/categories', { method: 'POST', body: JSON.stringify({ name: newCatName }) });
                    setNewCatName('');
                    onDataChanged();
                  }}
                  className="mt-2 flex gap-1.5"
                >
                  <input
                    type="text"
                    value={newCatName}
                    onChange={(e) => setNewCatName(e.target.value)}
                    placeholder="New category..."
                    className="flex-1 rounded border border-slate-300 px-2.5 py-1.5 text-xs"
                  />
                  <button type="submit" className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white">
                    Add
                  </button>
                </form>
                <div className="mt-3 max-h-52 space-y-1 overflow-y-auto">
                  {bootstrap.categories.map((c) => (
                    <div key={c.id} className="flex items-center justify-between rounded border border-slate-200 px-2.5 py-1.5 text-xs">
                      <span>{c.name}</span>
                      <button
                        type="button"
                        onClick={async () => {
                          await apiFetch(`/api/categories/${c.id}`, { method: 'DELETE' });
                          onDataChanged();
                        }}
                        className="text-slate-400 hover:text-red-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="text-xs font-bold text-slate-700">Brands</h4>
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!newBrandName.trim()) return;
                    await apiFetch('/api/brands', { method: 'POST', body: JSON.stringify({ name: newBrandName }) });
                    setNewBrandName('');
                    onDataChanged();
                  }}
                  className="mt-2 flex gap-1.5"
                >
                  <input
                    type="text"
                    value={newBrandName}
                    onChange={(e) => setNewBrandName(e.target.value)}
                    placeholder="New brand..."
                    className="flex-1 rounded border border-slate-300 px-2.5 py-1.5 text-xs"
                  />
                  <button type="submit" className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white">
                    Add
                  </button>
                </form>
                <div className="mt-3 max-h-52 space-y-1 overflow-y-auto">
                  {bootstrap.brands.map((b) => (
                    <div key={b.id} className="flex items-center justify-between rounded border border-slate-200 px-2.5 py-1.5 text-xs">
                      <span>{b.name}</span>
                      <button
                        type="button"
                        onClick={async () => {
                          await apiFetch(`/api/brands/${b.id}`, { method: 'DELETE' });
                          onDataChanged();
                        }}
                        className="text-slate-400 hover:text-red-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Product History Drawer Modal */}
      {historyProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div className="flex items-center gap-3">
                <QrCodeImage value={historyProduct.product.qr_code} size={48} />
                <div>
                  <h3 className="text-base font-semibold text-slate-900">{historyProduct.product.name}</h3>
                  <div className="font-mono text-xs text-slate-500">
                    {historyProduct.product.sku} · Stock: {historyProduct.product.quantity}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setPrintLabels([
                      {
                        title: historyProduct.product.name,
                        subtitle: historyProduct.product.sku,
                        code: historyProduct.product.qr_code,
                        priceText: formatCurrency(historyProduct.product.sale_price, currency),
                        badgeText: 'PRODUCT QR',
                      },
                    ])
                  }
                  className="flex items-center gap-1 rounded border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700"
                >
                  <Printer className="h-3.5 w-3.5" /> Print QR
                </button>
                <button
                  type="button"
                  onClick={() => setHistoryProduct(null)}
                  className="text-slate-400 hover:text-slate-900"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            <div className="overflow-y-auto p-5">
              <h4 className="mb-2 text-xs font-bold text-slate-700">Stock Movement Ledger</h4>
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2">Date</th>
                    <th className="py-2">Type</th>
                    <th className="py-2 text-right">Prev</th>
                    <th className="py-2 text-right">Change</th>
                    <th className="py-2 text-right">New</th>
                    <th className="py-2">Ref / Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {historyProduct.movements.map((m) => (
                    <tr key={m.id}>
                      <td className="py-2 text-slate-600">{formatDate(m.created_at, true)}</td>
                      <td className="py-2 font-medium text-slate-800">{m.movement_type}</td>
                      <td className="py-2 text-right font-mono tabular-nums">{m.previous_qty}</td>
                      <td
                        className={`py-2 text-right font-mono font-semibold tabular-nums ${
                          m.change_qty >= 0 ? 'text-emerald-700' : 'text-red-700'
                        }`}
                      >
                        {m.change_qty >= 0 ? `+${m.change_qty}` : m.change_qty}
                      </td>
                      <td className="py-2 text-right font-mono font-semibold tabular-nums">{m.new_qty}</td>
                      <td className="py-2 text-slate-600">{m.reference_no || m.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm Dialog */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
            <h3 className="text-base font-bold text-slate-900">Delete {deleteTarget.name}?</h3>
            <p className="mt-2 text-xs leading-relaxed text-slate-600">
              {deleteTarget.quantity > 0
                ? `This product currently has ${deleteTarget.quantity} unit(s) in stock. Confirming will permanently delete this product along with its stock movements, serial numbers, and any linked invoice line items.`
                : 'Confirming will permanently remove this product and any linked serial numbers or stock history from the database.'}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteProduct}
                className="rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700"
              >
                Delete Product
              </button>
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
