import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Barcode,
  Camera,
  CheckCircle2,
  CreditCard,
  Minus,
  Plus,
  Printer,
  RotateCcw,
  Search,
  ShoppingBag,
  Trash2,
  X,
} from 'lucide-react';
import { AppSettings, BootstrapData, Product, SaleInvoice, SerialRecord, User } from '../types';
import { apiFetch } from '../utils/api';
import { formatCurrency, formatDate, playScanBeep } from '../utils/format';
import { CameraScannerModal } from '../components/QrComponents';

interface CartItem {
  product: Product;
  quantity: number;
  unitPrice: number;
  discount: number;
  selectedSerials: SerialRecord[];
}

interface PosViewProps {
  bootstrap: BootstrapData;
  currentUser: User;
  settings: AppSettings;
  onDataChanged: () => void;
  onOpenInvoice: (saleId: number) => void;
}

export const PosView: React.FC<PosViewProps> = ({
  bootstrap,
  currentUser,
  settings,
  onDataChanged,
  onOpenInvoice,
}) => {
  const [subTab, setSubTab] = useState<'billing' | 'invoices'>('billing');
  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<SaleInvoice[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  // Cart & Checkout state
  const [cart, setCart] = useState<CartItem[]>([]);
  const [editingSaleId, setEditingSaleId] = useState<number | null>(null);
  const [customerId, setCustomerId] = useState<string>(String(bootstrap.customers[0]?.id || 1));
  const [locationId, setLocationId] = useState<string>(
    String(bootstrap.locations.find((l) => l.is_default)?.id || bootstrap.locations[0]?.id || 1)
  );
  const [invoiceDiscount, setInvoiceDiscount] = useState<number>(0);
  const [taxRate, setTaxRate] = useState<number>(Number(settings.tax_rate || 0));
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'bank' | 'credit'>('cash');
  const [paidAmount, setPaidAmount] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Serial picker modal
  const [serialModalProduct, setSerialModalProduct] = useState<Product | null>(null);
  const [availableSerials, setAvailableSerials] = useState<SerialRecord[]>([]);
  const [serialSearch, setSerialSearch] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);

  // Return modal, void confirm & delete confirm
  const [returnSaleId, setReturnSaleId] = useState<number | null>(null);
  const [returnSaleDetail, setReturnSaleDetail] = useState<any>(null);
  const [returnQuantities, setReturnQuantities] = useState<Record<number, number>>({});
  const [voidTarget, setVoidTarget] = useState<SaleInvoice | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SaleInvoice | null>(null);

  const searchRef = useRef<HTMLInputElement | null>(null);
  const currency = settings.currency || 'PKR';

  const loadData = async () => {
    const [prods, saleList] = await Promise.all([
      apiFetch<Product[]>('/api/products'),
      apiFetch<SaleInvoice[]>('/api/sales'),
    ]);
    setProducts(prods);
    setSales(saleList);
  };

  useEffect(() => {
    loadData();
  }, []);

  // Keyboard shortcuts: F2 focus search, F9 complete sale
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === 'F9' && subTab === 'billing' && cart.length > 0 && !submitting) {
        e.preventDefault();
        handleCheckout();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const subtotal = useMemo(
    () => cart.reduce((sum, item) => sum + Math.max(0, item.unitPrice * item.quantity - item.discount), 0),
    [cart]
  );
  const taxable = Math.max(0, subtotal - invoiceDiscount);
  const taxAmount = Number(((taxable * Math.max(0, taxRate)) / 100).toFixed(2));
  const grandTotal = Math.max(0, Number((taxable + taxAmount).toFixed(2)));

  useEffect(() => {
    if (paymentMethod === 'credit') {
      setPaidAmount('0');
    } else {
      setPaidAmount(String(grandTotal));
    }
  }, [grandTotal, paymentMethod]);

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return products.filter((p) => {
      if (categoryFilter !== 'all' && String(p.category_id) !== categoryFilter) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.model && p.model.toLowerCase().includes(q)) ||
        (p.barcode && p.barcode.toLowerCase().includes(q)) ||
        p.qr_code.toLowerCase().includes(q)
      );
    });
  }, [products, searchQuery, categoryFilter]);

  const openSerialSelector = async (product: Product) => {
    setSerialModalProduct(product);
    setSerialSearch('');
    const detail = await apiFetch<{ availableSerials: SerialRecord[] }>(`/api/products/${product.id}`);
    setAvailableSerials(detail.availableSerials);
  };

  const addProductToCart = async (product: Product, preselectedSerial?: SerialRecord) => {
    setAlert(null);
    const allowNegative = settings.allow_negative_stock === 'true';
    if (product.quantity <= 0 && !allowNegative && !editingSaleId) {
      setAlert({ type: 'error', text: `"${product.name}" is out of stock.` });
      playScanBeep(false);
      return;
    }

    if (product.serial_tracking === 1) {
      if (preselectedSerial) {
        if (preselectedSerial.status !== 'available') {
          setAlert({
            type: 'error',
            text: `Serial "${preselectedSerial.serial_number}" cannot be sold (status: ${preselectedSerial.status}).`,
          });
          playScanBeep(false);
          return;
        }
        setCart((prev) => {
          const existing = prev.find((c) => c.product.id === product.id);
          if (existing) {
            if (existing.selectedSerials.some((s) => s.id === preselectedSerial.id)) return prev;
            const nextSerials = [...existing.selectedSerials, preselectedSerial];
            return prev.map((c) =>
              c.product.id === product.id ? { ...c, quantity: nextSerials.length, selectedSerials: nextSerials } : c
            );
          }
          return [
            ...prev,
            { product, quantity: 1, unitPrice: product.sale_price, discount: 0, selectedSerials: [preselectedSerial] },
          ];
        });
        playScanBeep(true);
      } else {
        await openSerialSelector(product);
      }
      return;
    }

    setCart((prev) => {
      const existing = prev.find((c) => c.product.id === product.id);
      if (existing) {
        return prev.map((c) => (c.product.id === product.id ? { ...c, quantity: c.quantity + 1 } : c));
      }
      return [...prev, { product, quantity: 1, unitPrice: product.sale_price, discount: 0, selectedSerials: [] }];
    });
    playScanBeep(true);
  };

  const handleBarcodeOrSerialScan = async (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;
    try {
      const res = await apiFetch<{
        matchType: 'product' | 'serial' | 'none';
        product: Product | null;
        serialRecord: SerialRecord | null;
      }>(`/api/lookup?code=${encodeURIComponent(trimmed)}`);

      if (res.matchType === 'serial' && res.product && res.serialRecord) {
        await addProductToCart(res.product, res.serialRecord);
        setSearchQuery('');
      } else if (res.matchType === 'product' && res.product) {
        await addProductToCart(res.product);
        setSearchQuery('');
      }
    } catch {
      // let normal search display filtered results
    }
  };

  const toggleSerialInCart = (product: Product, sn: SerialRecord) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.product.id === product.id);
      if (!existing) {
        return [...prev, { product, quantity: 1, unitPrice: product.sale_price, discount: 0, selectedSerials: [sn] }];
      }
      const already = existing.selectedSerials.some((s) => s.id === sn.id);
      const nextSerials = already
        ? existing.selectedSerials.filter((s) => s.id !== sn.id)
        : [...existing.selectedSerials, sn];
      if (nextSerials.length === 0) {
        return prev.filter((c) => c.product.id !== product.id);
      }
      return prev.map((c) =>
        c.product.id === product.id ? { ...c, quantity: nextSerials.length, selectedSerials: nextSerials } : c
      );
    });
  };

  const handleCheckout = async () => {
    if (cart.length === 0) return;
    for (const item of cart) {
      if (item.product.serial_tracking === 1 && item.selectedSerials.length !== item.quantity) {
        setAlert({
          type: 'error',
          text: `Please select ${item.quantity} serial number(s) for "${item.product.name}".`,
        });
        return;
      }
    }

    setSubmitting(true);
    setAlert(null);
    try {
      const payload = {
        customer_id: Number(customerId),
        location_id: Number(locationId),
        user_id: currentUser.id,
        discount: invoiceDiscount,
        tax_rate: taxRate,
        payment_method: paymentMethod,
        paid_amount: paidAmount === '' ? grandTotal : Number(paidAmount),
        notes,
        items: cart.map((c) => ({
          product_id: c.product.id,
          quantity: c.quantity,
          unit_price: c.unitPrice,
          discount: c.discount,
          serial_ids: c.selectedSerials.map((s) => s.id),
        })),
      };

      const saved = editingSaleId
        ? await apiFetch<{ id: number; invoice_no: string }>(`/api/sales/${editingSaleId}`, {
            method: 'PUT',
            body: JSON.stringify(payload),
          })
        : await apiFetch<{ id: number; invoice_no: string }>('/api/sales', {
            method: 'POST',
            body: JSON.stringify(payload),
          });

      playScanBeep(true);
      setCart([]);
      setInvoiceDiscount(0);
      setNotes('');
      setEditingSaleId(null);
      await loadData();
      onDataChanged();
      setAlert({ type: 'success', text: `Invoice ${saved.invoice_no} saved successfully.` });
      onOpenInvoice(saved.id);
    } catch (err) {
      playScanBeep(false);
      setAlert({ type: 'error', text: err instanceof Error ? err.message : 'Checkout failed' });
    } finally {
      setSubmitting(false);
    }
  };

  const startEditInvoice = async (saleId: number) => {
    const detail = await apiFetch<any>(`/api/sales/${saleId}`);
    const s: SaleInvoice = detail.sale;
    setEditingSaleId(s.id);
    setCustomerId(String(s.customer_id || 1));
    setLocationId(String(s.location_id || 1));
    setInvoiceDiscount(s.discount || 0);
    setPaymentMethod((s.payment_method as 'cash') || 'cash');
    setPaidAmount(String(s.paid_amount));
    setNotes(s.notes || '');

    const loadedCart: CartItem[] = [];
    for (const it of detail.items) {
      const prod = products.find((p) => p.id === it.product_id);
      if (prod) {
        loadedCart.push({
          product: prod,
          quantity: it.quantity,
          unitPrice: it.unit_price,
          discount: it.discount || 0,
          selectedSerials: it.serials || [],
        });
      }
    }
    setCart(loadedCart);
    setSubTab('billing');
    setAlert({ type: 'success', text: `Loaded ${s.invoice_no} for editing. Saving will reverse & recalculate stock.` });
  };

  const openReturnModal = async (saleId: number) => {
    setReturnSaleId(saleId);
    const detail = await apiFetch<any>(`/api/sales/${saleId}`);
    setReturnSaleDetail(detail);
    const initQty: Record<number, number> = {};
    for (const it of detail.items) {
      initQty[it.id] = 0;
    }
    setReturnQuantities(initQty);
  };

  const submitCustomerReturn = async () => {
    if (!returnSaleId || !returnSaleDetail) return;
    const items = returnSaleDetail.items
      .filter((it: any) => (returnQuantities[it.id] || 0) > 0)
      .map((it: any) => ({
        sale_item_id: it.id,
        quantity: returnQuantities[it.id],
        serial_ids: (it.serials || []).slice(0, returnQuantities[it.id]).map((s: any) => s.id),
        restock_as_available: true,
      }));
    if (items.length === 0) return;
    await apiFetch(`/api/sales/${returnSaleId}/return`, {
      method: 'POST',
      body: JSON.stringify({ items, user_id: currentUser.id }),
    });
    setReturnSaleId(null);
    setReturnSaleDetail(null);
    await loadData();
    onDataChanged();
  };

  const confirmVoidInvoice = async () => {
    if (!voidTarget) return;
    try {
      await apiFetch(`/api/sales/${voidTarget.id}/void`, { method: 'POST' });
      setVoidTarget(null);
      await loadData();
      onDataChanged();
      setAlert({ type: 'success', text: `Invoice ${voidTarget.invoice_no} voided and stock restored.` });
    } catch (err) {
      setAlert({ type: 'error', text: err instanceof Error ? err.message : 'Failed to void invoice' });
      setVoidTarget(null);
    }
  };

  const confirmDeleteInvoice = async () => {
    if (!deleteTarget) return;
    try {
      const invoiceNo = deleteTarget.invoice_no;
      await apiFetch(`/api/sales/${deleteTarget.id}`, { method: 'DELETE' });
      setDeleteTarget(null);
      await loadData();
      onDataChanged();
      setAlert({ type: 'success', text: `Invoice ${invoiceNo} deleted and stock/serials restored.` });
    } catch (err) {
      setAlert({ type: 'error', text: err instanceof Error ? err.message : 'Failed to delete invoice' });
      setDeleteTarget(null);
    }
  };

  const currentCartSerialIds = new Set(
    serialModalProduct
      ? cart.find((c) => c.product.id === serialModalProduct.id)?.selectedSerials.map((s) => s.id) || []
      : []
  );

  return (
    <div className="space-y-4">
      {/* Sub-navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-lg bg-slate-200/70 p-1">
          <button
            type="button"
            onClick={() => setSubTab('billing')}
            className={`rounded-md px-4 py-1.5 text-xs font-semibold transition-colors ${
              subTab === 'billing' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Counter POS Billing {editingSaleId ? `(Editing #${editingSaleId})` : ''}
          </button>
          <button
            type="button"
            onClick={() => setSubTab('invoices')}
            className={`rounded-md px-4 py-1.5 text-xs font-semibold transition-colors ${
              subTab === 'invoices' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Sales Invoices &amp; Returns ({sales.length})
          </button>
        </div>

        {subTab === 'billing' && (
          <div className="text-xs text-slate-500">
            Shortcuts: <kbd className="rounded border border-slate-300 bg-white px-1.5 py-0.5 font-mono">F2</kbd> Search ·{' '}
            <kbd className="rounded border border-slate-300 bg-white px-1.5 py-0.5 font-mono">F9</kbd> Checkout
          </div>
        )}
      </div>

      {alert && (
        <div
          className={`flex items-center justify-between rounded-lg border p-3 text-sm ${
            alert.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-red-200 bg-red-50 text-red-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {alert.type === 'success' ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
            <span>{alert.text}</span>
          </div>
          <button type="button" onClick={() => setAlert(null)} className="text-xs underline">
            Dismiss
          </button>
        </div>
      )}

      {subTab === 'billing' ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          {/* Left Product Catalog Picker */}
          <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 lg:col-span-7">
            <div className="flex flex-wrap gap-2">
              <div className="relative flex-1 min-w-[220px]">
                <Search className="absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
                <input
                  ref={searchRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleBarcodeOrSerialScan(searchQuery);
                    }
                  }}
                  placeholder="Scan QR / Barcode / Serial or search hardware..."
                  className="w-full rounded-lg border border-slate-300 py-2 pr-3 pl-9 text-sm focus:border-blue-600 focus:outline-none"
                />
              </div>
              <button
                type="button"
                onClick={() => setCameraOpen(true)}
                className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <Camera className="h-4 w-4" />
                Scan
              </button>
            </div>

            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setCategoryFilter('all')}
                className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                  categoryFilter === 'all' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                All Categories
              </button>
              {bootstrap.categories.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setCategoryFilter(String(cat.id))}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                    categoryFilter === String(cat.id)
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {cat.name}
                </button>
              ))}
            </div>

            <div className="grid max-h-[560px] grid-cols-1 gap-2.5 overflow-y-auto pr-1 sm:grid-cols-2">
              {filteredProducts.map((p) => {
                const out = p.quantity <= 0;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => addProductToCart(p)}
                    className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 text-left transition-colors hover:border-blue-500 hover:bg-blue-50/40"
                  >
                    {p.image_url ? (
                      <img
                        src={p.image_url}
                        alt={p.name}
                        referrerPolicy="no-referrer"
                        className="h-12 w-12 shrink-0 rounded border border-slate-200 object-cover"
                      />
                    ) : (
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded border border-slate-200 bg-slate-50 text-slate-400">
                        <ShoppingBag className="h-5 w-5" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-slate-900">{p.name}</div>
                      <div className="truncate font-mono text-[11px] text-slate-500">
                        {p.sku} {p.serial_tracking ? '· Serial Tracked' : ''}
                      </div>
                      <div className="mt-1 flex items-center justify-between">
                        <span className="font-mono text-xs font-bold text-blue-700 tabular-nums">
                          {formatCurrency(p.sale_price, currency)}
                        </span>
                        <span
                          className={`font-mono text-xs font-medium tabular-nums ${
                            out ? 'text-red-600' : p.quantity <= p.min_stock ? 'text-amber-600' : 'text-emerald-700'
                          }`}
                        >
                          Stock: {p.quantity}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right Active POS Cart */}
          <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 lg:col-span-5">
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600">Customer</label>
                  <select
                    value={customerId}
                    onChange={(e) => setCustomerId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                  >
                    {bootstrap.customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600">Dispatch Location</label>
                  <select
                    value={locationId}
                    onChange={(e) => setLocationId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                  >
                    {bootstrap.locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Cart Items */}
              <div className="max-h-72 space-y-2 overflow-y-auto border-y border-slate-200 py-3">
                {cart.length === 0 ? (
                  <div className="py-10 text-center text-xs text-slate-400">
                    Cart is empty. Click a product or scan a QR / barcode / serial number.
                  </div>
                ) : (
                  cart.map((item) => (
                    <div key={item.product.id} className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate font-semibold text-slate-900">{item.product.name}</div>
                          <div className="font-mono text-[11px] text-slate-500">{item.product.sku}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setCart((prev) => prev.filter((c) => c.product.id !== item.product.id))}
                          className="text-slate-400 hover:text-red-600"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          {item.product.serial_tracking === 1 ? (
                            <button
                              type="button"
                              onClick={() => openSerialSelector(item.product)}
                              className="flex items-center gap-1 rounded border border-blue-300 bg-white px-2 py-1 font-mono text-[11px] font-medium text-blue-700 hover:bg-blue-50"
                            >
                              <Barcode className="h-3.5 w-3.5" />
                              Serials ({item.selectedSerials.length})
                            </button>
                          ) : (
                            <div className="flex items-center rounded border border-slate-300 bg-white">
                              <button
                                type="button"
                                onClick={() =>
                                  setCart((prev) =>
                                    prev.map((c) =>
                                      c.product.id === item.product.id
                                        ? { ...c, quantity: Math.max(1, c.quantity - 1) }
                                        : c
                                    )
                                  )
                                }
                                className="px-1.5 py-1 hover:bg-slate-100"
                              >
                                <Minus className="h-3 w-3" />
                              </button>
                              <span className="px-2 font-mono font-semibold tabular-nums">{item.quantity}</span>
                              <button
                                type="button"
                                onClick={() =>
                                  setCart((prev) =>
                                    prev.map((c) =>
                                      c.product.id === item.product.id ? { ...c, quantity: c.quantity + 1 } : c
                                    )
                                  )
                                }
                                className="px-1.5 py-1 hover:bg-slate-100"
                              >
                                <Plus className="h-3 w-3" />
                              </button>
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={0}
                            value={item.unitPrice}
                            onChange={(e) =>
                              setCart((prev) =>
                                prev.map((c) =>
                                  c.product.id === item.product.id
                                    ? { ...c, unitPrice: Number(e.target.value) || 0 }
                                    : c
                                )
                              )
                            }
                            className="w-24 rounded border border-slate-300 bg-white px-2 py-1 text-right font-mono tabular-nums"
                          />
                          <span className="w-24 text-right font-mono font-bold text-slate-900 tabular-nums">
                            {formatCurrency(item.unitPrice * item.quantity - item.discount, currency)}
                          </span>
                        </div>
                      </div>

                      {item.selectedSerials.length > 0 && (
                        <div className="mt-1.5 font-mono text-[10px] text-slate-600">
                          S/N: {item.selectedSerials.map((s) => s.serial_number).join(', ')}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>

              {/* Totals & Payment */}
              <div className="space-y-2.5 text-xs">
                <div className="flex justify-between text-slate-600">
                  <span>Subtotal</span>
                  <span className="font-mono font-semibold tabular-nums">{formatCurrency(subtotal, currency)}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-600">Invoice Discount ({currency})</span>
                  <input
                    type="number"
                    min={0}
                    value={invoiceDiscount}
                    onChange={(e) => setInvoiceDiscount(Math.max(0, Number(e.target.value) || 0))}
                    className="w-28 rounded border border-slate-300 px-2 py-1 text-right font-mono tabular-nums"
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-600">Tax (%)</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step="0.5"
                    value={taxRate}
                    onChange={(e) => setTaxRate(Math.max(0, Number(e.target.value) || 0))}
                    className="w-28 rounded border border-slate-300 px-2 py-1 text-right font-mono tabular-nums"
                  />
                </div>
                <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-bold text-slate-900">
                  <span>Grand Total</span>
                  <span className="font-mono tabular-nums">{formatCurrency(grandTotal, currency)}</span>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-1">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600">Payment Method</label>
                    <select
                      value={paymentMethod}
                      onChange={(e) => setPaymentMethod(e.target.value as 'cash' | 'card' | 'bank' | 'credit')}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                    >
                      <option value="cash">Cash</option>
                      <option value="card">Card / POS Machine</option>
                      <option value="bank">Bank Transfer</option>
                      <option value="credit">Credit (Pay Later)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600">Paid Amount ({currency})</label>
                    <input
                      type="number"
                      min={0}
                      max={grandTotal}
                      value={paidAmount}
                      onChange={(e) => setPaidAmount(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono text-xs tabular-nums"
                    />
                  </div>
                </div>

                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional invoice notes..."
                  className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
                />
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              {editingSaleId && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingSaleId(null);
                    setCart([]);
                  }}
                  className="rounded-lg border border-slate-300 px-3 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancel Edit
                </button>
              )}
              <button
                type="button"
                disabled={cart.length === 0 || submitting}
                onClick={handleCheckout}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                <CreditCard className="h-4 w-4" />
                {submitting ? 'Processing...' : editingSaleId ? 'Update Invoice & Stock' : 'Complete Sale & Print (F9)'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* Invoices & Returns Ledger */
        <div className="rounded-xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                  <th className="px-4 py-3">Invoice #</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-right">Paid</th>
                  <th className="px-4 py-3">Payment / Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {sales.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-900">{s.invoice_no}</td>
                    <td className="px-4 py-3 text-xs text-slate-600">{formatDate(s.sale_date, true)}</td>
                    <td className="px-4 py-3 text-sm text-slate-800">{s.customer_name}</td>
                    <td className="px-4 py-3 text-right font-mono text-sm font-semibold text-slate-900 tabular-nums">
                      {formatCurrency(s.total, currency)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-slate-600 tabular-nums">
                      {formatCurrency(s.paid_amount, currency)}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <span
                        className={`font-medium ${
                          s.status === 'cancelled'
                            ? 'text-red-700'
                            : s.payment_status === 'paid'
                            ? 'text-emerald-700'
                            : 'text-amber-700'
                        }`}
                      >
                        {s.status.toUpperCase()} · {s.payment_status.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => onOpenInvoice(s.id)}
                          className="flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        >
                          <Printer className="h-3 w-3" /> Print
                        </button>
                        {s.status === 'completed' && (
                          <>
                            <button
                              type="button"
                              onClick={() => startEditInvoice(s.id)}
                              className="rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => openReturnModal(s.id)}
                              className="flex items-center gap-1 rounded border border-amber-300 px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-50"
                            >
                              <RotateCcw className="h-3 w-3" /> Return
                            </button>
                            <button
                              type="button"
                              onClick={() => setVoidTarget(s)}
                              className="rounded border border-amber-200 px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-50"
                            >
                              Void
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(s)}
                          title="Delete Invoice"
                          className="flex items-center gap-1 rounded border border-red-200 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                        >
                          <Trash2 className="h-3 w-3" /> Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Serial Number Selection Modal */}
      {serialModalProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Select Serial Numbers</h3>
                <p className="text-xs text-slate-500">{serialModalProduct.name} · Only available units shown</p>
              </div>
              <button
                type="button"
                onClick={() => setSerialModalProduct(null)}
                className="rounded-lg p-1 text-slate-400 hover:text-slate-900"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3 overflow-y-auto p-5">
              <input
                type="text"
                value={serialSearch}
                onChange={(e) => setSerialSearch(e.target.value)}
                placeholder="Filter or scan serial number..."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs focus:border-blue-600 focus:outline-none"
                autoFocus
              />
              <div className="space-y-1.5">
                {availableSerials
                  .filter((sn) => sn.serial_number.toLowerCase().includes(serialSearch.toLowerCase()))
                  .map((sn) => {
                    const checked = currentCartSerialIds.has(sn.id);
                    return (
                      <label
                        key={sn.id}
                        className={`flex cursor-pointer items-center justify-between rounded-lg border p-2.5 text-xs ${
                          checked ? 'border-blue-600 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleSerialInCart(serialModalProduct, sn)}
                          />
                          <span className="font-mono font-semibold text-slate-900">{sn.serial_number}</span>
                        </div>
                        <span className="text-slate-500">{sn.location_name || 'Main Counter'}</span>
                      </label>
                    );
                  })}
                {availableSerials.length === 0 && (
                  <div className="py-6 text-center text-xs text-red-600">
                    No available serial numbers in stock for this item.
                  </div>
                )}
              </div>
            </div>
            <div className="flex justify-end border-t border-slate-200 px-5 py-3">
              <button
                type="button"
                onClick={() => setSerialModalProduct(null)}
                className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700"
              >
                Done ({currentCartSerialIds.size} selected)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Customer Return Modal */}
      {returnSaleDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="border-b border-slate-200 px-5 py-4">
              <h3 className="text-base font-semibold text-slate-900">
                Customer Return — {returnSaleDetail.sale.invoice_no}
              </h3>
              <p className="text-xs text-slate-500">Returned units are restored to inventory and logged in stock history.</p>
            </div>
            <div className="space-y-3 p-5">
              {returnSaleDetail.items.map((it: any) => {
                const maxRet = it.quantity - (it.returned_qty || 0);
                return (
                  <div key={it.id} className="flex items-center justify-between rounded-lg border border-slate-200 p-3 text-xs">
                    <div>
                      <div className="font-semibold text-slate-900">{it.product_name}</div>
                      <div className="text-slate-500">Sold: {it.quantity} · Returnable: {maxRet}</div>
                    </div>
                    <input
                      type="number"
                      min={0}
                      max={maxRet}
                      value={returnQuantities[it.id] || 0}
                      onChange={(e) =>
                        setReturnQuantities((prev) => ({
                          ...prev,
                          [it.id]: Math.min(maxRet, Math.max(0, Number(e.target.value) || 0)),
                        }))
                      }
                      className="w-20 rounded border border-slate-300 px-2 py-1 text-right font-mono"
                    />
                  </div>
                );
              })}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setReturnSaleId(null);
                    setReturnSaleDetail(null);
                  }}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submitCustomerReturn}
                  className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-700"
                >
                  Process Customer Return
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Void Confirmation Dialog */}
      {voidTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
            <h3 className="text-base font-bold text-slate-900">Void Invoice {voidTarget.invoice_no}?</h3>
            <p className="mt-2 text-xs leading-relaxed text-slate-600">
              Voiding marks this invoice as cancelled, restores sold stock &amp; releases serial numbers back to available inventory, while preserving the audit &amp; financial trail.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setVoidTarget(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700"
              >
                Keep Invoice
              </button>
              <button
                type="button"
                onClick={confirmVoidInvoice}
                className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-700"
              >
                Confirm Void
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Permanent Delete Confirmation Dialog */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
            <h3 className="text-base font-bold text-slate-900">Delete Invoice {deleteTarget.invoice_no}?</h3>
            <p className="mt-2 text-xs leading-relaxed text-slate-600">
              {deleteTarget.status === 'completed'
                ? 'Deleting this invoice will restore sold quantities to inventory, release any sold serial numbers back to available stock, remove linked payment entries, and permanently remove the invoice.'
                : 'This will permanently remove the invoice and its linked payment records from sales history.'}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeleteInvoice}
                className="rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700"
              >
                Delete Invoice
              </button>
            </div>
          </div>
        </div>
      )}

      <CameraScannerModal
        isOpen={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onScan={(code) => handleBarcodeOrSerialScan(code)}
      />
    </div>
  );
};
