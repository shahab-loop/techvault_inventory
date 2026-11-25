import React, { useEffect, useId, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Html5Qrcode } from 'html5-qrcode';
import { Camera, Printer, QrCode, X } from 'lucide-react';
import { printHtmlViaIframe } from '../utils/format';

interface QrCodeImageProps {
  value: string;
  size?: number;
  className?: string;
}

export const QrCodeImage: React.FC<QrCodeImageProps> = ({ value, size = 120, className = '' }) => {
  const [dataUrl, setDataUrl] = useState<string>('');

  useEffect(() => {
    let active = true;
    if (!value) {
      setDataUrl('');
      return;
    }
    QRCode.toDataURL(value, {
      width: size * 2,
      margin: 1,
      color: { dark: '#0F172A', light: '#FFFFFF' },
    })
      .then((url) => {
        if (active) setDataUrl(url);
      })
      .catch(() => {
        if (active) setDataUrl('');
      });
    return () => {
      active = false;
    };
  }, [value, size]);

  if (!dataUrl) {
    return (
      <div
        style={{ width: size, height: size }}
        className={`flex items-center justify-center border border-slate-200 bg-slate-50 text-slate-400 ${className}`}
      >
        <QrCode className="h-6 w-6" />
      </div>
    );
  }

  return (
    <img
      src={dataUrl}
      alt={`QR code for ${value}`}
      width={size}
      height={size}
      className={`border border-slate-200 bg-white p-1 ${className}`}
    />
  );
};

interface CameraScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScan: (decodedText: string) => void;
  title?: string;
}

export const CameraScannerModal: React.FC<CameraScannerModalProps> = ({
  isOpen,
  onClose,
  onScan,
  title = 'Scan QR Code or Barcode',
}) => {
  const scannerId = useId().replace(/:/g, '_');
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [cameraError, setCameraError] = useState<string>('');
  const [manualInput, setManualInput] = useState<string>('');

  useEffect(() => {
    if (!isOpen) return;
    let mounted = true;
    setCameraError('');

    const startScanner = async () => {
      try {
        const html5QrCode = new Html5Qrcode(scannerId);
        scannerRef.current = html5QrCode;
        await html5QrCode.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 240, height: 240 } },
          (decodedText) => {
            if (mounted) {
              onScan(decodedText);
              onClose();
            }
          },
          () => {
            // ignore frame decode misses
          }
        );
      } catch (err) {
        if (mounted) {
          setCameraError(
            err instanceof Error
              ? `Camera unavailable (${err.message}). Connect a USB scanner or enter the code manually below.`
              : 'Camera unavailable. Use a USB scanner or enter the code manually below.'
          );
        }
      }
    };

    const timer = setTimeout(startScanner, 120);

    return () => {
      mounted = false;
      clearTimeout(timer);
      if (scannerRef.current) {
        scannerRef.current
          .stop()
          .then(() => scannerRef.current?.clear())
          .catch(() => {});
        scannerRef.current = null;
      }
    };
  }, [isOpen, onClose, onScan, scannerId]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <Camera className="h-5 w-5 text-blue-600" />
            <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-950">
            <div id={scannerId} className="min-h-[240px] w-full" />
          </div>

          {cameraError && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              {cameraError}
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (manualInput.trim()) {
                onScan(manualInput.trim());
                setManualInput('');
                onClose();
              }
            }}
            className="flex gap-2"
          >
            <input
              type="text"
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              placeholder="Or type / USB-scan code here..."
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-blue-600 focus:outline-none"
              autoFocus
            />
            <button
              type="submit"
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 whitespace-nowrap"
            >
              Use Code
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export interface PrintableQrLabel {
  title: string;
  subtitle: string;
  code: string;
  priceText?: string;
  badgeText: string;
}

interface QrLabelPrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  labels: PrintableQrLabel[];
  shopName?: string;
}

export const QrLabelPrintModal: React.FC<QrLabelPrintModalProps> = ({
  isOpen,
  onClose,
  labels,
  shopName = 'TechVault Hardware',
}) => {
  const [qrUrls, setQrUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isOpen || labels.length === 0) return;
    let active = true;
    Promise.all(
      labels.map(async (lbl) => {
        const url = await QRCode.toDataURL(lbl.code, { width: 220, margin: 1 });
        return [lbl.code, url] as const;
      })
    ).then((entries) => {
      if (active) setQrUrls(Object.fromEntries(entries));
    });
    return () => {
      active = false;
    };
  }, [isOpen, labels]);

  if (!isOpen) return null;

  const handlePrint = () => {
    const cardsHtml = labels
      .map(
        (lbl) => `
      <div style="border:1px solid #cbd5e1; border-radius:6px; padding:10px; width:220px; display:inline-block; margin:6px; vertical-align:top; font-family:sans-serif; page-break-inside:avoid;">
        <div style="font-size:9px; color:#64748b; text-transform:uppercase; font-weight:700; margin-bottom:4px;">${shopName} · ${lbl.badgeText}</div>
        <div style="display:flex; gap:8px; align-items:center;">
          <img src="${qrUrls[lbl.code] || ''}" width="68" height="68" style="border:1px solid #e2e8f0;" />
          <div style="min-width:0; flex:1;">
            <div style="font-size:11px; font-weight:700; color:#0f172a; line-height:1.2; margin-bottom:3px;">${lbl.title}</div>
            <div style="font-size:10px; color:#475569; margin-bottom:3px;">${lbl.subtitle}</div>
            ${lbl.priceText ? `<div style="font-size:11px; font-weight:700; color:#0f172a;">${lbl.priceText}</div>` : ''}
          </div>
        </div>
        <div style="font-family:monospace; font-size:9px; color:#334155; margin-top:5px; word-break:break-all;">${lbl.code}</div>
      </div>`
      )
      .join('');

    printHtmlViaIframe(`
      <!doctype html>
      <html>
        <head><title>Print QR Labels</title></head>
        <body style="margin:12px; background:#fff;">
          ${cardsHtml}
        </body>
      </html>
    `);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900">QR Code Labels ({labels.length})</h3>
            <p className="text-xs text-slate-500">Product QR identifies the model · Serial QR identifies each physical unit</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrint}
              className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              <Printer className="h-4 w-4" />
              Print Labels
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

        <div className="grid grid-cols-1 gap-3 overflow-y-auto p-5 sm:grid-cols-2">
          {labels.map((lbl, idx) => (
            <div key={`${lbl.code}-${idx}`} className="flex flex-col justify-between rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="mb-2 text-[11px] font-medium text-slate-500">
                {shopName} · {lbl.badgeText}
              </div>
              <div className="flex items-center gap-3">
                <QrCodeImage value={lbl.code} size={72} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-slate-900">{lbl.title}</div>
                  <div className="truncate text-xs text-slate-600">{lbl.subtitle}</div>
                  {lbl.priceText && <div className="mt-1 font-mono text-xs font-semibold text-slate-900">{lbl.priceText}</div>}
                </div>
              </div>
              <div className="mt-2 truncate font-mono text-[11px] text-slate-600">{lbl.code}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
