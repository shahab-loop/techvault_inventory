import React, { useEffect, useState } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Download, Printer, X } from 'lucide-react';
import { AppSettings, SaleInvoice } from '../types';
import { apiFetch } from '../utils/api';
import { formatCurrency, formatDate, printHtmlViaIframe } from '../utils/format';

interface SaleDetailResponse {
  sale: SaleInvoice;
  items: Array<{
    id: number;
    product_id: number;
    product_name: string;
    product_model: string;
    product_sku: string;
    quantity: number;
    unit_price: number;
    discount: number;
    total_price: number;
    warranty_months: number;
    serials: Array<{
      id: number;
      serial_number: string;
      serial_qr: string;
      warranty_expiry: string | null;
      status: string;
    }>;
  }>;
}

interface InvoiceModalProps {
  saleId: number | null;
  settings: AppSettings;
  onClose: () => void;
}

export const InvoiceModal: React.FC<InvoiceModalProps> = ({ saleId, settings, onClose }) => {
  const [data, setData] = useState<SaleDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [format, setFormat] = useState<'A4' | '80mm' | '58mm'>(settings.default_printer || '80mm');

  useEffect(() => {
    if (!saleId) return;
    setLoading(true);
    apiFetch<SaleDetailResponse>(`/api/sales/${saleId}`)
      .then((res) => setData(res))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [saleId]);

  if (!saleId) return null;

  const currency = settings.currency || 'PKR';

  const handleDownloadPdf = () => {
    if (!data) return;
    const { sale, items } = data;
    const isThermal = format !== 'A4';
    const doc = isThermal
      ? new jsPDF({
          orientation: 'portrait',
          unit: 'mm',
          format: [format === '80mm' ? 80 : 58, 220],
        })
      : new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    const margin = isThermal ? 4 : 14;
    let y = isThermal ? 8 : 16;

    doc.setFontSize(isThermal ? 10 : 15);
    doc.text(settings.shop_name || 'TechVault Hardware', margin, y);
    y += isThermal ? 4.5 : 6;

    doc.setFontSize(isThermal ? 7 : 9);
    if (settings.shop_address) {
      doc.text(settings.shop_address, margin, y, { maxWidth: isThermal ? (format === '80mm' ? 72 : 50) : 180 });
      y += isThermal ? 5.5 : 5;
    }
    if (settings.shop_phone) {
      doc.text(`Tel: ${settings.shop_phone}`, margin, y);
      y += isThermal ? 5 : 6;
    }

    doc.setFontSize(isThermal ? 8 : 10);
    doc.text(`Invoice: ${sale.invoice_no}`, margin, y);
    y += 4.5;
    doc.setFontSize(isThermal ? 7 : 9);
    doc.text(`Date: ${formatDate(sale.sale_date, true)}`, margin, y);
    y += 4.5;
    doc.text(`Customer: ${sale.customer_name || 'Walk-in Customer'}`, margin, y);
    y += 5;

    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      styles: { fontSize: isThermal ? 6.5 : 8.5, cellPadding: isThermal ? 1.5 : 2.5 },
      headStyles: { fillColor: [15, 23, 42] },
      head: isThermal ? [['Item', 'Qty', 'Total']] : [['Product / Model & Serials', 'Qty', 'Unit Price', 'Total']],
      body: items.map((it) => {
        const snText = it.serials.length > 0 ? `\nS/N: ${it.serials.map((s) => s.serial_number).join(', ')}` : '';
        const itemLabel = `${it.product_name}${it.product_model ? ` (${it.product_model})` : ''}${snText}`;
        return isThermal
          ? [itemLabel, String(it.quantity), formatCurrency(it.total_price, currency)]
          : [itemLabel, String(it.quantity), formatCurrency(it.unit_price, currency), formatCurrency(it.total_price, currency)];
      }),
    });

    const finalY = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || y + 25) + 6;
    doc.setFontSize(isThermal ? 7.5 : 9.5);
    doc.text(`Subtotal: ${formatCurrency(sale.subtotal, currency)}`, margin, finalY);
    doc.text(`Discount: ${formatCurrency(sale.discount, currency)}`, margin, finalY + 4.5);
    doc.text(`Tax: ${formatCurrency(sale.tax, currency)}`, margin, finalY + 9);
    doc.setFontSize(isThermal ? 9 : 11);
    doc.text(`Grand Total: ${formatCurrency(sale.total, currency)}`, margin, finalY + 14.5);
    doc.setFontSize(isThermal ? 7.5 : 9);
    doc.text(`Paid (${sale.payment_method.toUpperCase()}): ${formatCurrency(sale.paid_amount, currency)}`, margin, finalY + 20);
    doc.text(`Balance Due: ${formatCurrency(Math.max(0, sale.total - sale.paid_amount), currency)}`, margin, finalY + 24.5);

    if (settings.warranty_terms) {
      doc.setFontSize(isThermal ? 6.5 : 8);
      doc.text(`Warranty: ${settings.warranty_terms}`, margin, finalY + 31, {
        maxWidth: isThermal ? (format === '80mm' ? 72 : 50) : 180,
      });
    }

    doc.save(`${sale.invoice_no}-${format}.pdf`);
  };

  const handlePrint = () => {
    if (!data) return;
    const { sale, items } = data;
    const widthCss = format === '80mm' ? '80mm' : format === '58mm' ? '58mm' : '210mm';
    const isThermal = format !== 'A4';

    const rowsHtml = items
      .map(
        (it) => `
      <tr style="border-bottom:1px dashed #cbd5e1;">
        <td style="padding:5px 2px; vertical-align:top;">
          <div style="font-weight:600;">${it.product_name}</div>
          ${it.product_model ? `<div style="font-size:${isThermal ? '10px' : '11px'}; color:#475569;">Model: ${it.product_model}</div>` : ''}
          ${
            it.serials.length > 0
              ? `<div style="font-family:monospace; font-size:${isThermal ? '9.5px' : '11px'}; color:#0f172a; margin-top:2px;">S/N: ${it.serials
                  .map((s) => s.serial_number)
                  .join(', ')}</div>`
              : ''
          }
          <div style="font-size:10px; color:#64748b;">Warranty: ${it.warranty_months} months</div>
        </td>
        <td style="padding:5px 4px; text-align:right; vertical-align:top;">${it.quantity}</td>
        ${isThermal ? '' : `<td style="padding:5px 4px; text-align:right; vertical-align:top;">${formatCurrency(it.unit_price, currency)}</td>`}
        <td style="padding:5px 2px; text-align:right; vertical-align:top; font-weight:600;">${formatCurrency(it.total_price, currency)}</td>
      </tr>`
      )
      .join('');

    const html = `
      <!doctype html>
      <html>
        <head>
          <title>${sale.invoice_no}</title>
          <style>
            @page { size: ${isThermal ? `${widthCss} auto` : 'A4'}; margin: ${isThermal ? '3mm' : '12mm'}; }
            body { font-family: Arial, sans-serif; color: #0f172a; margin: 0 auto; width: ${isThermal ? widthCss : '100%'}; font-size: ${
      isThermal ? '11px' : '13px'
    }; }
          </style>
        </head>
        <body>
          <div style="text-align:${isThermal ? 'center' : 'left'}; border-bottom:1px solid #0f172a; padding-bottom:8px; margin-bottom:10px;">
            ${settings.shop_logo ? `<img src="${settings.shop_logo}" style="max-height:42px; margin-bottom:4px;" />` : ''}
            <div style="font-size:${isThermal ? '14px' : '20px'}; font-weight:700;">${settings.shop_name}</div>
            <div style="font-size:${isThermal ? '10px' : '12px'}; color:#475569;">${settings.shop_address}</div>
            <div style="font-size:${isThermal ? '10px' : '12px'}; color:#475569;">${settings.shop_phone}</div>
          </div>
          <div style="display:flex; justify-content:space-between; margin-bottom:10px; font-size:${isThermal ? '10.5px' : '12px'};">
            <div>
              <div><strong>Invoice:</strong> ${sale.invoice_no}</div>
              <div><strong>Date:</strong> ${formatDate(sale.sale_date, true)}</div>
            </div>
            <div style="text-align:right;">
              <div><strong>Customer:</strong> ${sale.customer_name || 'Walk-in'}</div>
              ${sale.customer_phone ? `<div>${sale.customer_phone}</div>` : ''}
            </div>
          </div>
          <table style="width:100%; border-collapse:collapse; margin-bottom:10px;">
            <thead>
              <tr style="border-bottom:1px solid #0f172a; text-align:left;">
                <th style="padding:4px 2px;">Item</th>
                <th style="padding:4px; text-align:right;">Qty</th>
                ${isThermal ? '' : '<th style="padding:4px; text-align:right;">Price</th>'}
                <th style="padding:4px 2px; text-align:right;">Total</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
          <div style="border-top:1px solid #0f172a; padding-top:8px; font-size:${isThermal ? '11px' : '13px'};">
            <div style="display:flex; justify-content:space-between;"><span>Subtotal</span><span>${formatCurrency(sale.subtotal, currency)}</span></div>
            <div style="display:flex; justify-content:space-between;"><span>Discount</span><span>${formatCurrency(sale.discount, currency)}</span></div>
            <div style="display:flex; justify-content:space-between;"><span>Tax</span><span>${formatCurrency(sale.tax, currency)}</span></div>
            <div style="display:flex; justify-content:space-between; font-weight:700; font-size:${isThermal ? '13px' : '15px'}; margin-top:4px;"><span>Grand Total</span><span>${formatCurrency(sale.total, currency)}</span></div>
            <div style="display:flex; justify-content:space-between; margin-top:4px;"><span>Paid (${sale.payment_method.toUpperCase()})</span><span>${formatCurrency(sale.paid_amount, currency)}</span></div>
            <div style="display:flex; justify-content:space-between;"><span>Balance</span><span>${formatCurrency(Math.max(0, sale.total - sale.paid_amount), currency)}</span></div>
          </div>
          <div style="margin-top:12px; border-top:1px dashed #94a3b8; padding-top:8px; font-size:10px; color:#475569;">
            <div><strong>Warranty:</strong> ${settings.warranty_terms}</div>
            <div style="margin-top:3px;"><strong>Terms:</strong> ${settings.invoice_terms}</div>
          </div>
        </body>
      </html>`;

    printHtmlViaIframe(html);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-3">
            <h3 className="text-base font-semibold text-slate-900">
              {data ? `Invoice ${data.sale.invoice_no}` : 'Loading Invoice...'}
            </h3>
            <div className="flex items-center rounded-lg bg-slate-100 p-1">
              {(['A4', '80mm', '58mm'] as const).map((fmt) => (
                <button
                  key={fmt}
                  type="button"
                  onClick={() => setFormat(fmt)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                    format === fmt ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {fmt}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={!data}
              className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              PDF
            </button>
            <button
              type="button"
              onClick={handlePrint}
              disabled={!data}
              className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <Printer className="h-4 w-4" />
              Print ({format})
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto bg-slate-100 p-6">
          {loading && <div className="py-12 text-center text-sm text-slate-500">Loading invoice details...</div>}
          {!loading && data && (
            <div
              className={`mx-auto border border-slate-200 bg-white p-6 shadow-sm ${
                format === '58mm' ? 'max-w-[270px] text-xs' : format === '80mm' ? 'max-w-[360px] text-xs' : 'max-w-2xl text-sm'
              }`}
            >
              <div className={`border-b border-slate-900 pb-4 ${format === 'A4' ? 'flex items-start justify-between' : 'text-center'}`}>
                <div>
                  {settings.shop_logo && (
                    <img src={settings.shop_logo} alt={settings.shop_name} className="mb-2 max-h-12 object-contain" />
                  )}
                  <h4 className="text-lg font-bold text-slate-900">{settings.shop_name}</h4>
                  <p className="text-xs text-slate-600">{settings.shop_address}</p>
                  <p className="text-xs text-slate-600">{settings.shop_phone}</p>
                </div>
                <div className={format === 'A4' ? 'text-right' : 'mt-3'}>
                  <div className="font-mono text-sm font-bold text-slate-900">{data.sale.invoice_no}</div>
                  <div className="text-xs text-slate-500">{formatDate(data.sale.sale_date, true)}</div>
                  <div className="mt-1 text-xs font-medium text-slate-700">
                    Status: {data.sale.status.toUpperCase()} · {data.sale.payment_status.toUpperCase()}
                  </div>
                </div>
              </div>

              <div className="my-4 flex flex-wrap justify-between gap-2 text-xs text-slate-700">
                <div>
                  <span className="font-semibold text-slate-900">Customer:</span> {data.sale.customer_name || 'Walk-in Customer'}
                  {data.sale.customer_phone && <span className="ml-2 text-slate-500">({data.sale.customer_phone})</span>}
                </div>
                <div>
                  <span className="font-semibold text-slate-900">Cashier:</span> {data.sale.user_name || 'Staff'}
                </div>
              </div>

              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-slate-300 text-xs text-slate-600">
                    <th className="py-2">Product &amp; Serial Numbers</th>
                    <th className="py-2 text-right">Qty</th>
                    {format === 'A4' && <th className="py-2 text-right">Unit Price</th>}
                    <th className="py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {data.items.map((it) => (
                    <tr key={it.id}>
                      <td className="py-2.5 pr-2 align-top">
                        <div className="font-medium text-slate-900">{it.product_name}</div>
                        <div className="text-xs text-slate-500">
                          {it.product_model || it.product_sku} · {it.warranty_months}m warranty
                        </div>
                        {it.serials.length > 0 && (
                          <div className="mt-1 font-mono text-[11px] text-slate-700">
                            S/N: {it.serials.map((s) => s.serial_number).join(', ')}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 text-right align-top font-mono tabular-nums">{it.quantity}</td>
                      {format === 'A4' && (
                        <td className="py-2.5 text-right align-top font-mono tabular-nums">
                          {formatCurrency(it.unit_price, currency)}
                        </td>
                      )}
                      <td className="py-2.5 text-right align-top font-mono font-semibold tabular-nums">
                        {formatCurrency(it.total_price, currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="mt-4 space-y-1 border-t border-slate-900 pt-3 text-xs">
                <div className="flex justify-between text-slate-600">
                  <span>Subtotal</span>
                  <span className="font-mono tabular-nums">{formatCurrency(data.sale.subtotal, currency)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Discount</span>
                  <span className="font-mono tabular-nums">-{formatCurrency(data.sale.discount, currency)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Tax</span>
                  <span className="font-mono tabular-nums">{formatCurrency(data.sale.tax, currency)}</span>
                </div>
                <div className="flex justify-between pt-1 text-sm font-bold text-slate-900">
                  <span>Grand Total</span>
                  <span className="font-mono tabular-nums">{formatCurrency(data.sale.total, currency)}</span>
                </div>
                <div className="flex justify-between text-slate-700">
                  <span>Paid ({data.sale.payment_method.toUpperCase()})</span>
                  <span className="font-mono tabular-nums">{formatCurrency(data.sale.paid_amount, currency)}</span>
                </div>
                <div className="flex justify-between font-semibold text-slate-900">
                  <span>Remaining Balance</span>
                  <span className="font-mono tabular-nums">
                    {formatCurrency(Math.max(0, data.sale.total - data.sale.paid_amount), currency)}
                  </span>
                </div>
              </div>

              <div className="mt-5 border-t border-dashed border-slate-300 pt-3 text-[11px] text-slate-500">
                <p>
                  <strong className="text-slate-700">Warranty:</strong> {settings.warranty_terms}
                </p>
                <p className="mt-1">
                  <strong className="text-slate-700">Terms:</strong> {settings.invoice_terms}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
