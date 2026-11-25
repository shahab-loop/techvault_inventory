import React, { useEffect, useState } from 'react';
import { CheckCircle2, Database, Download, HardDriveUpload, RotateCcw, Save, Shield, UserPlus } from 'lucide-react';
import { AppSettings, BackupRecord, User } from '../types';
import { apiFetch } from '../utils/api';
import { formatDate } from '../utils/format';

interface SettingsBackupViewProps {
  settings: AppSettings;
  users: User[];
  currentUser: User;
  onSettingsUpdated: () => void;
}

export const SettingsBackupView: React.FC<SettingsBackupViewProps> = ({
  settings,
  users,
  currentUser,
  onSettingsUpdated,
}) => {
  const [form, setForm] = useState<AppSettings>(settings);
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [newUserName, setNewUserName] = useState('');
  const [newUserRole, setNewUserRole] = useState<'Admin' | 'Manager' | 'Cashier'>('Cashier');
  const [message, setMessage] = useState<string>('');
  const [restoreConfirm, setRestoreConfirm] = useState<BackupRecord | null>(null);

  useEffect(() => {
    setForm(settings);
  }, [settings]);

  const loadBackups = async () => {
    const list = await apiFetch<BackupRecord[]>('/api/backups');
    setBackups(list);
  };

  useEffect(() => {
    loadBackups();
  }, []);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch('/api/settings', { method: 'PUT', body: JSON.stringify(form) });
    setMessage('Shop configuration and invoice settings saved.');
    onSettingsUpdated();
  };

  const handleCreateBackup = async () => {
    await apiFetch('/api/backups', { method: 'POST', body: JSON.stringify({ backup_type: 'manual' }) });
    setMessage('SQLite database snapshot created in local backups folder.');
    await loadBackups();
  };

  const handleConfirmRestore = async () => {
    if (!restoreConfirm) return;
    await apiFetch('/api/backups/restore', {
      method: 'POST',
      body: JSON.stringify({ backup_id: restoreConfirm.id }),
    });
    setRestoreConfirm(null);
    setMessage(`Database restored from ${restoreConfirm.filename}.`);
    onSettingsUpdated();
    await loadBackups();
  };

  const handleUploadDbRestore = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const arrayBuf = reader.result as ArrayBuffer;
      const bytes = new Uint8Array(arrayBuf);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
      const base64 = btoa(binary);
      try {
        await apiFetch('/api/backups/upload-restore', {
          method: 'POST',
          body: JSON.stringify({ file_base64: base64 }),
        });
        setMessage(`Database successfully restored from uploaded file "${file.name}".`);
        onSettingsUpdated();
        await loadBackups();
      } catch (err) {
        setMessage(err instanceof Error ? err.message : 'Restore failed');
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setForm({ ...form, shop_logo: reader.result });
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-6">
      {message && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{message}</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Shop & Invoice Configuration */}
        <form onSubmit={handleSaveSettings} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 lg:col-span-7">
          <h3 className="border-b border-slate-200 pb-3 text-base font-bold text-slate-900">
            Shop Profile, Invoice &amp; Inventory Rules
          </h3>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-xs">
            <div className="sm:col-span-2">
              <label className="block font-semibold text-slate-700">Shop Name</label>
              <input
                type="text"
                value={form.shop_name || ''}
                onChange={(e) => setForm({ ...form, shop_name: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700">Phone Number</label>
              <input
                type="text"
                value={form.shop_phone || ''}
                onChange={(e) => setForm({ ...form, shop_phone: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700">Currency (Default PKR)</label>
              <input
                type="text"
                value={form.currency || 'PKR'}
                onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block font-semibold text-slate-700">Shop Address</label>
              <input
                type="text"
                value={form.shop_address || ''}
                onChange={(e) => setForm({ ...form, shop_address: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700">Invoice Number Prefix</label>
              <input
                type="text"
                value={form.invoice_prefix || 'INV-'}
                onChange={(e) => setForm({ ...form, invoice_prefix: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700">Default Tax Rate (%)</label>
              <input
                type="number"
                min={0}
                step="0.5"
                value={form.tax_rate || '0'}
                onChange={(e) => setForm({ ...form, tax_rate: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700">Default Printer Format</label>
              <select
                value={form.default_printer || '80mm'}
                onChange={(e) => setForm({ ...form, default_printer: e.target.value as 'A4' | '80mm' | '58mm' })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="A4">A4 Standard Sheet</option>
                <option value="80mm">80mm Thermal Receipt</option>
                <option value="58mm">58mm Compact Thermal</option>
              </select>
            </div>
            <div>
              <label className="block font-semibold text-slate-700">Default Low-Stock Threshold</label>
              <input
                type="number"
                min={0}
                value={form.low_stock_default || '5'}
                onChange={(e) => setForm({ ...form, low_stock_default: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700">Auto-Backup Schedule</label>
              <select
                value={form.auto_backup_interval || 'daily'}
                onChange={(e) => setForm({ ...form, auto_backup_interval: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="daily">Daily Local Snapshot</option>
                <option value="weekly">Weekly Local Snapshot</option>
                <option value="manual">Manual Only</option>
              </select>
            </div>
            <div>
              <label className="block font-semibold text-slate-700">Shop Logo (for Invoices)</label>
              <input type="file" accept="image/*" onChange={handleLogoUpload} className="mt-1 block w-full text-xs" />
            </div>
            <div className="sm:col-span-2">
              <label className="block font-semibold text-slate-700">Warranty Policy Text</label>
              <textarea
                rows={2}
                value={form.warranty_terms || ''}
                onChange={(e) => setForm({ ...form, warranty_terms: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-xs"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block font-semibold text-slate-700">Invoice Terms &amp; Conditions</label>
              <textarea
                rows={2}
                value={form.invoice_terms || ''}
                onChange={(e) => setForm({ ...form, invoice_terms: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-xs"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
            <input
              type="checkbox"
              checked={form.allow_negative_stock === 'true'}
              onChange={(e) => setForm({ ...form, allow_negative_stock: e.target.checked ? 'true' : 'false' })}
            />
            Allow negative stock sales (Admin override — disabled by default for strict accuracy)
          </label>

          <button
            type="submit"
            disabled={currentUser.role !== 'Admin'}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {currentUser.role === 'Admin' ? 'Save All Settings' : 'Admin Role Required to Save Settings'}
          </button>
        </form>

        {/* Backup & Staff Users */}
        <div className="space-y-6 lg:col-span-5">
          {/* SQLite Backup & Restore */}
          <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <Database className="h-4 w-4 text-blue-600" />
                <h3 className="text-sm font-bold text-slate-900">SQLite Backup &amp; Restore</h3>
              </div>
              <a
                href="/api/export/business-json"
                className="text-xs font-medium text-blue-600 hover:underline"
              >
                Export JSON
              </a>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleCreateBackup}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800"
              >
                <Database className="h-3.5 w-3.5" /> Create Backup Now
              </button>
              <label className="flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                <HardDriveUpload className="h-3.5 w-3.5" />
                Restore .db File
                <input type="file" accept=".db,.sqlite" onChange={handleUploadDbRestore} className="hidden" />
              </label>
            </div>

            <div className="max-h-56 space-y-2 overflow-y-auto">
              {backups.length === 0 ? (
                <div className="py-4 text-center text-xs text-slate-400">No backups created yet.</div>
              ) : (
                backups.map((b) => (
                  <div key={b.id} className="flex items-center justify-between rounded-lg border border-slate-200 p-2.5 text-xs">
                    <div className="min-w-0 pr-2">
                      <div className="truncate font-mono font-semibold text-slate-900">{b.filename}</div>
                      <div className="text-slate-500">
                        {formatDate(b.created_at, true)} · {Math.round(b.size_bytes / 1024)} KB
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <a
                        href={`/api/backups/${b.id}/download`}
                        className="rounded border border-slate-300 p-1.5 text-slate-600 hover:bg-slate-100"
                        title="Download .db"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </a>
                      <button
                        type="button"
                        onClick={() => setRestoreConfirm(b)}
                        className="flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-2 py-1 font-medium text-amber-800 hover:bg-amber-100"
                      >
                        <RotateCcw className="h-3 w-3" /> Restore
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Staff Users & Roles */}
          <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
              <Shield className="h-4 w-4 text-blue-600" />
              <h3 className="text-sm font-bold text-slate-900">Shop Staff &amp; Permissions</h3>
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!newUserName.trim()) return;
                await apiFetch('/api/users', {
                  method: 'POST',
                  body: JSON.stringify({ name: newUserName, role: newUserRole }),
                });
                setNewUserName('');
                onSettingsUpdated();
              }}
              className="flex gap-2"
            >
              <input
                type="text"
                value={newUserName}
                onChange={(e) => setNewUserName(e.target.value)}
                placeholder="Staff member name..."
                className="flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
              />
              <select
                value={newUserRole}
                onChange={(e) => setNewUserRole(e.target.value as 'Admin' | 'Manager' | 'Cashier')}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
              >
                <option value="Cashier">Cashier</option>
                <option value="Manager">Manager</option>
                <option value="Admin">Admin</option>
              </select>
              <button type="submit" className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white">
                <UserPlus className="h-3.5 w-3.5" />
              </button>
            </form>
            <div className="space-y-1.5">
              {users.map((u) => (
                <div key={u.id} className="flex items-center justify-between rounded border border-slate-200 px-3 py-2 text-xs">
                  <div>
                    <span className="font-semibold text-slate-900">{u.name}</span>
                    <span className="ml-2 text-slate-500">· {u.role}</span>
                  </div>
                  <span className="text-emerald-700 font-medium">{u.active ? 'Active' : 'Disabled'}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {restoreConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
            <h3 className="text-base font-bold text-slate-900">Restore Database Snapshot?</h3>
            <p className="mt-2 text-xs text-slate-600">
              Restoring <span className="font-mono font-semibold">{restoreConfirm.filename}</span> will replace current live data. A safety snapshot of your current database will be saved automatically first.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRestoreConfirm(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmRestore}
                className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-700"
              >
                Confirm Restore
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
