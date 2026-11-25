import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Barcode,
  Camera,
  CheckCircle2,
  PackagePlus,
  Printer,
  QrCode,
  ScanLine,
  Search,
  Trash2,
} from 'lucide-react';
import { AppSettings, BootstrapData, Product, SerialRecord, User } from '../types';
import { apiFetch } from '../utils/api';
import { formatCurrency, playScanBeep } from '../utils/format';
import { CameraScannerModal, PrintableQrLabel, QrCodeImage, QrLabelPrintModal } from '../components/QrComponents';

interface QuickStockEntryViewProps {
  bootstrap: BootstrapData;
  currentUser: User;
  settings: AppSettings;
  preselectedProductId?: number | null;
  onDataChanged: () => void;
}

type EntryTab = 'qr_scan' | 'serial_entry' | 'name_search';

export const QuickStockEntryView: React.FC<QuickStockEntryViewProps> = ({
  bootstrap,
  currentUser,
  settings,
  preselectedProductId,
  onDataChanged,
}) => {
  const [activeTab, setActiveTab] = useState<EntryTab>('qr_scan');
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  // Shared unsaved stock entry form state (preserved across tab switches!)
  const [quantityToAdd, setQuantityToAdd] = useState<number>(1);
  const [purchasePrice, setPurchasePrice] = useState<string>('');
  const [salePrice, setSalePrice] = useState<string>('');
  const [supplierId, setSupplierId] = useState<string>(String(bootstrap.suppliers[0]?.id || ''));
  const [locationId, setLocationId] = useState<string>(
    String(bootstrap.locations.find((l) => l.is_default)?.id || bootstrap.locations[0]?.id || '')
  );
  const [entryDate, setEntryDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState<string>('');
  const [serialInputs, setSerialInputs] = useState<string[]>(['']);
  const [serialQuickBuffer, setSerialQuickBuffer] = useState<string>('');

  // Method A (QR / Barcode) state
  const [scanCodeInput, setScanCodeInput] = useState<string>('');
  const [continuousMode, setContinuousMode] = useState<boolean>(true);
  const [cameraOpen, setCameraOpen] = useState<boolean>(false);
  const [unknownCodePrompt, setUnknownCodePrompt] = useState<string | null>(null);
  const scanInputRef = useRef<HTMLInputElement | null>(null);

  // Method B (Serial Number) state
  const [serialLookupInput, setSerialLookupInput] = useState<string>('');
  const [matchedExistingSerial, setMatchedExistingSerial] = useState<SerialRecord | null>(null);

  // Method C (Product Name Search) state
  const [nameQuery, setNameQuery] = useState<string>('');

  // Quick New Product modal when scanning unknown code
  const [newProdModalOpen, setNewProdModalOpen] = useState<boolean>(false);
  const [newProdName, setNewProdName] = useState<string>('');
  const [newProdSku, setNewProdSku] = useState<string>('');
  const [newProdBarcode, setNewProdBarcode] = useState<string>('');
  const [newProdBrandId, setNewProdBrandId] = useState<string>(String(bootstrap.brands[0]?.id || ''));
  const [newProdCatId, setNewProdCatId] = useState<string>(String(bootstrap.categories[0]?.id || ''));
  const [newProdPurchase, setNewProdPurchase] = useState<string>('0');
  const [newProdSale, setNewProdSale] = useState<string>('0');
  const [newProdSerialTracking, setNewProdSerialTracking] = useState<boolean>(true);

  // Status, Errors, Labels
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [printLabels, setPrintLabels] = useState<PrintableQrLabel[] | null>(null);

  const currency = settings.currency || 'PKR';

  const loadProducts = async () => {
    const list = await apiFetch<Product[]>('/api/products');
    setProducts(list);
    return list;
  };

  useEffect(() => {
    loadProducts().then((list) => {
      if (preselectedProductId) {
        const found = list.find((p) => p.id === preselectedProductId);
        if (found) selectProductForEntry(found);
      }
    });
  }, [preselectedProductId]);

  const selectProductForEntry = (prod: Product, initialSerial?: string) => {
    setSelectedProduct(prod);
    setPurchasePrice(String(prod.purchase_price));
    setSalePrice(String(prod.sale_price));
    setUnknownCodePrompt(null);
    if (initialSerial) {
      setQuantityToAdd(1);
      setSerialInputs([initialSerial]);
    } else if (prod.serial_tracking === 1) {
      setSerialInputs((prev) => {
        const targetLen = Math.max(1, quantityToAdd);
        return Array.from({ length: targetLen }, (_, idx) => prev[idx] || '');
      });
    }
  };

  // Keep serial input rows aligned with quantity when serial_tracking is enabled
  useEffect(() => {
    if (!selectedProduct || selectedProduct.serial_tracking !== 1) return;
    const count = Math.max(1, quantityToAdd);
    setSerialInputs((prev) => Array.from({ length: count }, (_, idx) => prev[idx] || ''));
  }, [quantityToAdd, selectedProduct?.id, selectedProduct?.serial_tracking]);

  const handleCodeLookup = async (rawCode: string) => {
    const code = rawCode.trim();
    if (!code) return;
    setStatusMessage(null);
    setUnknownCodePrompt(null);
    setMatchedExistingSerial(null);

    try {
      const res = await apiFetch<{
        matchType: 'product' | 'serial' | 'none';
        product: Product | null;
        serialRecord: SerialRecord | null;
      }>(`/api/lookup?code=${encodeURIComponent(code)}`);

      if (res.matchType === 'product' && res.product) {
        playScanBeep(true);
        // If same product scanned continuously without serial tracking, increment quantity automatically
        if (continuousMode && selectedProduct?.id === res.product.id && res.product.serial_tracking === 0) {
          setQuantityToAdd((q) => q + 1);
          setStatusMessage({
            type: 'info',
            text: `Continuous scan: incremented "${res.product.name}" quantity to ${quantityToAdd + 1}.`,
          });
        } else {
          selectProductForEntry(res.product);
          setStatusMessage({
            type: 'info',
            text: `Identified "${res.product.name}" (${res.product.sku}). Ready to add stock.`,
          });
        }
        setScanCodeInput('');
      } else if (res.matchType === 'serial' && res.product && res.serialRecord) {
        playScanBeep(false);
        setMatchedExistingSerial(res.serialRecord);
        selectProductForEntry(res.product);
        setStatusMessage({
          type: 'error',
          text: `Serial "${res.serialRecord.serial_number}" already belongs to "${res.product.name}" (Status: ${res.serialRecord.status}). Duplicate serials are blocked.`,
        });
      } else {
        playScanBeep(false);
        setUnknownCodePrompt(code);
        setStatusMessage({
          type: 'error',
          text: `No product matched code "${code}". You can register a new product with this code.`,
        });
      }
    } catch (err) {
      playScanBeep(false);
      setStatusMessage({ type: 'error', text: err instanceof Error ? err.message : 'Lookup failed' });
    }
  };

  const handleSerialLookup = async (rawSerial: string) => {
    const sn = rawSerial.trim();
    if (!sn) return;
    setStatusMessage(null);
    setMatchedExistingSerial(null);

    try {
      const res = await apiFetch<{
        matchType: 'product' | 'serial' | 'none';
        product: Product | null;
        serialRecord: SerialRecord | null;
      }>(`/api/lookup?code=${encodeURIComponent(sn)}`);

      if (res.matchType === 'serial' && res.serialRecord) {
        playScanBeep(false);
        setMatchedExistingSerial(res.serialRecord);
        if (res.product) selectProductForEntry(res.product);
        setStatusMessage({
          type: 'error',
          text: `Serial "${res.serialRecord.serial_number}" is already registered (${res.serialRecord.status}) under "${res.product?.name}".`,
        });
        return;
      }

      if (res.matchType === 'product' && res.product) {
        playScanBeep(true);
        selectProductForEntry(res.product);
        setStatusMessage({
          type: 'info',
          text: `Code matched product "${res.product.name}". Enter unit serial numbers below.`,
        });
        return;
      }

      // Unknown serial -> ready to add 1 unit with this serial!
      playScanBeep(true);
      if (selectedProduct) {
        setQuantityToAdd(1);
        setSerialInputs([sn]);
        setStatusMessage({
          type: 'info',
          text: `New serial "${sn}" assigned to "${selectedProduct.name}". Verify price and click Add Stock.`,
        });
      } else {
        setSerialInputs([sn]);
        setQuantityToAdd(1);
        setStatusMessage({
          type: 'info',
          text: `Serial "${sn}" is unique and available! Select the product below to assign it.`,
        });
      }
    } catch (err) {
      setStatusMessage({ type: 'error', text: err instanceof Error ? err.message : 'Serial check failed' });
    }
  };

  const filteredSuggestions = useMemo(() => {
    const q = nameQuery.trim().toLowerCase();
    if (!q) return products.slice(0, 8);
    return products
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          (p.model && p.model.toLowerCase().includes(q)) ||
          (p.brand_name && p.brand_name.toLowerCase().includes(q)) ||
          (p.barcode && p.barcode.toLowerCase().includes(q))
      )
      .slice(0, 12);
  }, [products, nameQuery]);

  const handleAddSerialChip = (raw: string) => {
    const val = raw.trim();
    if (!val) return;
    const emptyIdx = serialInputs.findIndex((s) => !s.trim());
    if (emptyIdx >= 0) {
      const next = [...serialInputs];
      next[emptyIdx] = val;
      setSerialInputs(next);
    } else {
      const next = [...serialInputs, val];
      setSerialInputs(next);
      setQuantityToAdd(next.length);
    }
    setSerialQuickBuffer('');
    playScanBeep(true);
  };

  const handleSubmitStock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProduct) {
      setStatusMessage({ type: 'error', text: 'Please scan or select a product first.' });
      return;
    }
    if (quantityToAdd <= 0) {
      setStatusMessage({ type: 'error', text: 'Quantity to add must be at least 1.' });
      return;
    }

    const cleanedSerials = serialInputs.map((s) => s.trim()).filter(Boolean);
    if (selectedProduct.serial_tracking === 1 && cleanedSerials.length !== quantityToAdd) {
      setStatusMessage({
        type: 'error',
        text: `This product tracks individual serials. Enter ${quantityToAdd} unique serial number(s) (currently ${cleanedSerials.length}).`,
      });
      return;
    }

    setSubmitting(true);
    setStatusMessage(null);
    try {
      const res = await apiFetch<{
        product: Product;
        previousQty: number;
        addedQty: number;
        newQty: number;
        createdSerials: SerialRecord[];
      }>('/api/stock/quick-add', {
        method: 'POST',
        body: JSON.stringify({
          product_id: selectedProduct.id,
          location_id: Number(locationId),
          supplier_id: supplierId ? Number(supplierId) : null,
          user_id: currentUser.id,
          quantity: quantityToAdd,
          purchase_price: Number(purchasePrice || selectedProduct.purchase_price),
          sale_price: Number(salePrice || selectedProduct.sale_price),
          serial_numbers: cleanedSerials,
          entry_method: activeTab,
          date: entryDate,
          notes,
        }),
      });

      playScanBeep(true);
      setSelectedProduct(res.product);
      await loadProducts();
      onDataChanged();

      setStatusMessage({
        type: 'success',
        text: `Added +${res.addedQty} unit(s) to "${res.product.name}". Stock updated: ${res.previousQty} -> ${res.newQty}.`,
      });

      // Reset quantity/serials for next fast batch while keeping supplier/location
      setQuantityToAdd(1);
      setSerialInputs(['']);
      setNotes('');
      setSerialLookupInput('');

      // If serials were created, offer quick label printing
      if (res.createdSerials && res.createdSerials.length > 0) {
        setPrintLabels(
          res.createdSerials.map((sn) => ({
            title: res.product.name,
            subtitle: `S/N: ${sn.serial_number}`,
            code: sn.serial_qr,
            priceText: formatCurrency(res.product.sale_price, currency),
            badgeText: 'UNIT SERIAL QR',
          }))
        );
      }

      if (activeTab === 'qr_scan' && continuousMode) {
        setTimeout(() => scanInputRef.current?.focus(), 100);
      }
    } catch (err) {
      playScanBeep(false);
      setStatusMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to add stock' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegisterNewProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const created = await apiFetch<Product>('/api/products', {
        method: 'POST',
        body: JSON.stringify({
          name: newProdName,
          sku: newProdSku,
          barcode: newProdBarcode || null,
          brand_id: newProdBrandId ? Number(newProdBrandId) : null,
          category_id: newProdCatId ? Number(newProdCatId) : null,
          purchase_price: Number(newProdPurchase || 0),
          sale_price: Number(newProdSale || 0),
          serial_tracking: newProdSerialTracking,
          quantity: 0,
        }),
      });
      await loadProducts();
      onDataChanged();
      selectProductForEntry(created);
      setNewProdModalOpen(false);
      setUnknownCodePrompt(null);
      setStatusMessage({
        type: 'success',
        text: `Registered new product "${created.name}" (${created.sku}). Now enter quantity to add stock.`,
      });
    } catch (err) {
      setStatusMessage({ type: 'error', text: err instanceof Error ? err.message : 'Could not create product' });
    }
  };

  const openUnknownCodeRegistration = () => {
    const code = unknownCodePrompt || '';
    setNewProdName('');
    setNewProdSku(code.startsWith('PRODQR:') ? code.replace('PRODQR:', '') : code.toUpperCase());
    setNewProdBarcode(code.startsWith('PRODQR:') ? '' : code);
    setNewProdPurchase('0');
    setNewProdSale('0');
    setNewProdModalOpen(true);
  };

  const newCalculatedStock = selectedProduct ? selectedProduct.quantity + Math.max(0, quantityToAdd) : 0;

  return (
    <div className="space-y-6">
      {/* Header & Unified 3-Method Tab Bar */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Quick Stock Entry</h2>
            <p className="text-xs text-slate-500">
              Add hardware stock in seconds via QR/Barcode scan, Serial Number, or Product Name without losing unsaved fields
            </p>
          </div>
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setActiveTab('qr_scan')}
              className={`flex items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                activeTab === 'qr_scan' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <QrCode className="h-4 w-4" />
              QR Scan / Barcode
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('serial_entry')}
              className={`flex items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                activeTab === 'serial_entry' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Barcode className="h-4 w-4" />
              Serial No.
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('name_search')}
              className={`flex items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                activeTab === 'name_search' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Search className="h-4 w-4" />
              Name Search
            </button>
          </div>
        </div>

        {/* Status Banner */}
        {statusMessage && (
          <div
            className={`mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm ${
              statusMessage.type === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : statusMessage.type === 'error'
                ? 'border-red-200 bg-red-50 text-red-800'
                : 'border-blue-200 bg-blue-50 text-blue-800'
            }`}
          >
            <div className="flex items-center gap-2">
              {statusMessage.type === 'success' ? (
                <CheckCircle2 className="h-4 w-4 shrink-0" />
              ) : (
                <AlertCircle className="h-4 w-4 shrink-0" />
              )}
              <span>{statusMessage.text}</span>
            </div>
            {unknownCodePrompt && (
              <button
                type="button"
                onClick={openUnknownCodeRegistration}
                className="flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
              >
                <PackagePlus className="h-3.5 w-3.5" />
                Register &quot;{unknownCodePrompt}&quot; as New Product
              </button>
            )}
          </div>
        )}

        {/* Tab 1: QR / Barcode Scan */}
        {activeTab === 'qr_scan' && (
          <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 lg:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ScanLine className="h-5 w-5 text-blue-600" />
                  <h3 className="text-sm font-semibold text-slate-900">Scan Product QR / Barcode</h3>
                </div>
                <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={continuousMode}
                    onChange={(e) => setContinuousMode(e.target.checked)}
                    className="rounded border-slate-300 text-blue-600"
                  />
                  Continuous scanning mode
                </label>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Connect a USB barcode scanner (presses Enter automatically) or use camera scanning. Try{' '}
                <button
                  type="button"
                  onClick={() => handleCodeLookup('PRODQR:SSD-SAM-980P-1TB')}
                  className="font-mono text-blue-600 underline hover:text-blue-700"
                >
                  PRODQR:SSD-SAM-980P-1TB
                </button>{' '}
                to test immediately.
              </p>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleCodeLookup(scanCodeInput);
                }}
                className="mt-3 flex flex-wrap gap-2"
              >
                <input
                  ref={scanInputRef}
                  type="text"
                  value={scanCodeInput}
                  onChange={(e) => setScanCodeInput(e.target.value)}
                  placeholder="Focus here & scan USB QR/Barcode or type SKU..."
                  className="min-w-[240px] flex-1 rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 font-mono text-sm focus:border-blue-600 focus:outline-none"
                  autoFocus
                />
                <button
                  type="submit"
                  className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 whitespace-nowrap"
                >
                  Identify Product
                </button>
                <button
                  type="button"
                  onClick={() => setCameraOpen(true)}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
                >
                  <Camera className="h-4 w-4" />
                  Camera Scan
                </button>
              </form>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="text-xs font-semibold text-slate-700">Two-Tier QR Architecture</div>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                <strong className="text-slate-800">Product QR</strong> (<code className="text-[11px]">PRODQR:...</code>) identifies the hardware model.{' '}
                <strong className="text-slate-800">Unit Serial QR</strong> (<code className="text-[11px]">SERQR:...</code>) identifies each physical SSD, CPU, RAM, or GPU entering stock.
              </p>
            </div>
          </div>
        )}

        {/* Tab 2: Serial Number Entry */}
        {activeTab === 'serial_entry' && (
          <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <h3 className="text-sm font-semibold text-slate-900">Scan or Enter Serial Number</h3>
              <p className="mt-1 text-xs text-slate-500">
                Verifies uniqueness across the entire database, identifies existing products, or lets you link a new serial to a model (+1 stock).
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSerialLookup(serialLookupInput);
                }}
                className="mt-3 flex gap-2"
              >
                <input
                  type="text"
                  value={serialLookupInput}
                  onChange={(e) => setSerialLookupInput(e.target.value)}
                  placeholder="Enter or scan unit serial number..."
                  className="flex-1 rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 font-mono text-sm focus:border-blue-600 focus:outline-none"
                  autoFocus
                />
                <button
                  type="submit"
                  className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 whitespace-nowrap"
                >
                  Verify &amp; Load
                </button>
                <button
                  type="button"
                  onClick={() => setCameraOpen(true)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-700 hover:bg-slate-100"
                  title="Scan Serial QR with Camera"
                >
                  <Camera className="h-4 w-4" />
                </button>
              </form>

              {matchedExistingSerial && (
                <div className="mt-3 rounded-lg border border-amber-200 bg-white p-3 text-xs">
                  <div className="font-semibold text-slate-900">Existing Serial Record Found</div>
                  <div className="mt-1 grid grid-cols-2 gap-1 text-slate-600">
                    <span>S/N: <strong className="font-mono text-slate-900">{matchedExistingSerial.serial_number}</strong></span>
                    <span>Status: <strong>{matchedExistingSerial.status.toUpperCase()}</strong></span>
                    <span>Supplier: {matchedExistingSerial.supplier_name || '—'}</span>
                    <span>Cost: {formatCurrency(matchedExistingSerial.purchase_price, currency)}</span>
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <label className="block text-xs font-semibold text-slate-700">
                Assign Serial to Product (if new serial)
              </label>
              <select
                value={selectedProduct?.id || ''}
                onChange={(e) => {
                  const found = products.find((p) => p.id === Number(e.target.value));
                  if (found) selectProductForEntry(found, serialLookupInput.trim() || undefined);
                }}
                className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-blue-600 focus:outline-none"
              >
                <option value="">-- Select hardware product --</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.sku}) · Stock: {p.quantity}
                  </option>
                ))}
              </select>
              <p className="mt-2 text-xs text-slate-500">
                Saving a new serial number automatically increments product stock by +1 unit and generates its individual Serial QR label.
              </p>
            </div>
          </div>
        )}

        {/* Tab 3: Search by Product Name */}
        {activeTab === 'name_search' && (
          <div className="mt-5 space-y-3">
            <div className="relative">
              <Search className="absolute top-3 left-3.5 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={nameQuery}
                onChange={(e) => setNameQuery(e.target.value)}
                placeholder="Type product name, brand, model number, SKU, or barcode..."
                className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pr-4 pl-10 text-sm focus:border-blue-600 focus:outline-none"
                autoFocus
              />
            </div>

            <div className="grid max-h-60 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
              {filteredSuggestions.map((p) => {
                const isSelected = selectedProduct?.id === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => selectProductForEntry(p)}
                    className={`flex items-center justify-between rounded-lg border p-3 text-left transition-colors ${
                      isSelected
                        ? 'border-blue-600 bg-blue-50/70'
                        : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <div className="min-w-0 pr-2">
                      <div className="truncate text-sm font-semibold text-slate-900">{p.name}</div>
                      <div className="truncate font-mono text-xs text-slate-500">
                        {p.brand_name} · {p.sku}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="font-mono text-xs font-bold text-slate-900 tabular-nums">Qty: {p.quantity}</div>
                      <div className="font-mono text-[11px] text-slate-500 tabular-nums">
                        {formatCurrency(p.purchase_price, currency)}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Unified Stock Entry Form (always visible & keeps unsaved changes across tabs) */}
      <form onSubmit={handleSubmitStock} className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 lg:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4">
            <div className="flex items-center gap-4">
              {selectedProduct?.image_url ? (
                <img
                  src={selectedProduct.image_url}
                  alt={selectedProduct.name}
                  referrerPolicy="no-referrer"
                  className="h-16 w-16 rounded-lg border border-slate-200 object-cover"
                />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-slate-400">
                  <QrCode className="h-7 w-7" />
                </div>
              )}
              <div>
                <div className="text-xs font-medium text-slate-500">Selected Hardware Product</div>
                <h3 className="text-base font-bold text-slate-900">
                  {selectedProduct ? selectedProduct.name : 'No product selected yet'}
                </h3>
                {selectedProduct && (
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 font-mono text-xs text-slate-600">
                    <span>SKU: {selectedProduct.sku}</span>
                    <span>·</span>
                    <span>Model: {selectedProduct.model || '—'}</span>
                    <span>·</span>
                    <span>{selectedProduct.serial_tracking ? 'Serial Tracking ON' : 'Bulk Qty'}</span>
                  </div>
                )}
              </div>
            </div>

            {selectedProduct && (
              <div className="flex items-center gap-3">
                <QrCodeImage value={selectedProduct.qr_code} size={56} />
                <button
                  type="button"
                  onClick={() =>
                    setPrintLabels([
                      {
                        title: selectedProduct.name,
                        subtitle: selectedProduct.sku,
                        code: selectedProduct.qr_code,
                        priceText: formatCurrency(selectedProduct.sale_price, currency),
                        badgeText: 'PRODUCT QR',
                      },
                    ])
                  }
                  className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Product QR
                </button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700">Quantity to Add</label>
              <input
                type="number"
                min={1}
                value={quantityToAdd}
                onChange={(e) => setQuantityToAdd(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm font-semibold focus:border-blue-600 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">Purchase Price ({currency})</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={purchasePrice}
                onChange={(e) => setPurchasePrice(e.target.value)}
                placeholder="0"
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-blue-600 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">Sale Price ({currency})</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={salePrice}
                onChange={(e) => setSalePrice(e.target.value)}
                placeholder="0"
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-blue-600 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">Supplier</label>
              <select
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
              >
                <option value="">-- Optional supplier --</option>
                {bootstrap.suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">Target Stock Location</label>
              <select
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
              >
                {bootstrap.locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">Entry Date</label>
              <input
                type="date"
                value={entryDate}
                onChange={(e) => setEntryDate(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
              />
            </div>
          </div>

          {/* Serial Numbers Panel */}
          {selectedProduct?.serial_tracking === 1 && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-xs font-bold text-slate-900">
                    Unit Serial Numbers Required ({serialInputs.filter((s) => s.trim()).length} / {quantityToAdd})
                  </h4>
                  <p className="text-xs text-slate-500">
                    Scan or enter each unit&apos;s unique serial number. Each unit gets its own Serial QR label.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={serialQuickBuffer}
                    onChange={(e) => setSerialQuickBuffer(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddSerialChip(serialQuickBuffer);
                      }
                    }}
                    placeholder="Quick scan serial + Enter"
                    className="rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs focus:border-blue-600 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => handleAddSerialChip(serialQuickBuffer)}
                    className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                  >
                    Fill Next
                  </button>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {serialInputs.map((sn, idx) => (
                  <div key={idx} className="flex items-center gap-1.5">
                    <span className="w-6 font-mono text-xs text-slate-500">#{idx + 1}</span>
                    <input
                      type="text"
                      value={sn}
                      onChange={(e) => {
                        const next = [...serialInputs];
                        next[idx] = e.target.value;
                        setSerialInputs(next);
                      }}
                      placeholder={`Serial number #${idx + 1}`}
                      className="flex-1 rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs focus:border-blue-600 focus:outline-none"
                    />
                    {serialInputs.length > 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          const next = serialInputs.filter((_, i) => i !== idx);
                          setSerialInputs(next);
                          setQuantityToAdd(Math.max(1, next.length));
                        }}
                        className="p-1 text-slate-400 hover:text-red-600"
                        title="Remove slot"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700">Notes / Batch Reference</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional delivery challan, shelf bin, or supplier batch note..."
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
            />
          </div>
        </div>

        {/* Right Live Calculation & Save Panel */}
        <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5">
          <div className="space-y-4">
            <h3 className="text-sm font-bold text-slate-900">Stock Calculation Preview</h3>

            <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-600">Product</span>
                <span className="max-w-[160px] truncate font-semibold text-slate-900">
                  {selectedProduct ? selectedProduct.name : '—'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-600">Current Stock</span>
                <span className="font-mono font-semibold text-slate-900 tabular-nums">
                  {selectedProduct ? selectedProduct.quantity : 0}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-600">Quantity Added</span>
                <span className="font-mono font-semibold text-blue-700 tabular-nums">+{quantityToAdd}</span>
              </div>
              <div className="border-t border-slate-200 pt-2.5 flex items-center justify-between">
                <span className="font-bold text-slate-900">New Stock</span>
                <span className="font-mono text-xl font-bold text-emerald-700 tabular-nums">{newCalculatedStock}</span>
              </div>
            </div>

            <div className="space-y-1 text-xs text-slate-600">
              <div className="flex justify-between">
                <span>Batch Cost Value</span>
                <span className="font-mono font-semibold text-slate-900 tabular-nums">
                  {formatCurrency(Number(purchasePrice || 0) * quantityToAdd, currency)}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Operator</span>
                <span className="font-medium text-slate-800">{currentUser.name}</span>
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={!selectedProduct || submitting}
            className="mt-6 w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Saving Stock Transaction...' : 'Add Stock to Inventory'}
          </button>
        </div>
      </form>

      {/* Camera Scanner Modal */}
      <CameraScannerModal
        isOpen={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onScan={(code) => {
          if (activeTab === 'serial_entry') {
            setSerialLookupInput(code);
            handleSerialLookup(code);
          } else {
            setScanCodeInput(code);
            handleCodeLookup(code);
          }
        }}
      />

      {/* Register Unknown Product Modal */}
      {newProdModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="border-b border-slate-200 px-5 py-4">
              <h3 className="text-base font-semibold text-slate-900">Register New Product from Scanned Code</h3>
              <p className="text-xs text-slate-500">Creates product SKU and immediately loads it into Quick Stock Entry</p>
            </div>
            <form onSubmit={handleRegisterNewProduct} className="space-y-4 p-5">
              <div>
                <label className="block text-xs font-semibold text-slate-700">Product Name *</label>
                <input
                  type="text"
                  required
                  value={newProdName}
                  onChange={(e) => setNewProdName(e.target.value)}
                  placeholder="e.g. Samsung 990 PRO 2TB NVMe SSD"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">SKU *</label>
                  <input
                    type="text"
                    required
                    value={newProdSku}
                    onChange={(e) => setNewProdSku(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-blue-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Barcode</label>
                  <input
                    type="text"
                    value={newProdBarcode}
                    onChange={(e) => setNewProdBarcode(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-blue-600 focus:outline-none"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Category</label>
                  <select
                    value={newProdCatId}
                    onChange={(e) => setNewProdCatId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    {bootstrap.categories.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Brand</label>
                  <select
                    value={newProdBrandId}
                    onChange={(e) => setNewProdBrandId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    {bootstrap.brands.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Purchase Price ({currency})</label>
                  <input
                    type="number"
                    min={0}
                    value={newProdPurchase}
                    onChange={(e) => setNewProdPurchase(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Sale Price ({currency})</label>
                  <input
                    type="number"
                    min={0}
                    value={newProdSale}
                    onChange={(e) => setNewProdSale(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={newProdSerialTracking}
                  onChange={(e) => setNewProdSerialTracking(e.target.checked)}
                />
                Enable individual unit serial number tracking
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setNewProdModalOpen(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  Create &amp; Load Product
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* QR Label Printing Modal */}
      <QrLabelPrintModal
        isOpen={Boolean(printLabels)}
        onClose={() => setPrintLabels(null)}
        labels={printLabels || []}
        shopName={settings.shop_name}
      />
    </div>
  );
};
