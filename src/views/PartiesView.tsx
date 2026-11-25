import React, { useEffect, useState } from 'react';
import { Banknote, Building2, Plus, Users, X } from 'lucide-react';
import { AppSettings, Customer, Supplier, User } from '../types';
import { apiFetch } from '../utils/api';
import { formatCurrency, formatDate } from '../utils/format';

interface PartiesViewProps {
  settings: AppSettings;
  currentUser: User;
  onDataChanged: () => void;
}

export const PartiesView: React.FC<PartiesViewProps> = ({ settings, currentUser, onDataChanged }) => {
  const [tab, setTab] = useState<'customers' | 'suppliers'>('customers');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [payments, setPayments] = useState<any[]>([]);

  const [addModal, setAddModal] = useState(false);
  const [partyForm, setPartyForm] = useState({ name: '', phone: '', email: '', address: '', notes: '' });

  const [payTarget, setPayTarget] = useState<{ type: 'customer' | 'supplier'; id: number; name: string; due: number } | null>(
    null
  );
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('cash');
  const [payNotes, setPayNotes] = useState('');

  const currency = settings.currency || 'PKR';

  const loadAll = async () => {
    const [c, s, p] = await Promise.all([
      apiFetch<Customer[]>('/api/customers'),
      apiFetch<Supplier[]>('/api/suppliers'),
      apiFetch<any[]>('/api/payments'),
    ]);
    setCustomers(c);
    setSuppliers(s);
    setPayments(p);
  };

  useEffect(() => {
    loadAll();
  }, []);

  const handleSaveParty = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = tab === 'customers' ? '/api/customers' : '/api/suppliers';
    await apiFetch(url, { method: 'POST', body: JSON.stringify(partyForm) });
    setPartyForm({ name: '', phone: '', email: '', address: '', notes: '' });
    setAddModal(false);
    await loadAll();
    onDataChanged();
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payTarget) return;
    await apiFetch('/api/payments', {
      method: 'POST',
      body: JSON.stringify({
        party_type: payTarget.type,
        party_id: payTarget.id,
        amount: Number(payAmount),
        payment_method: payMethod,
        notes: payNotes,
        user_id: currentUser.id,
      }),
    });
    setPayTarget(null);
    setPayAmount('');
    setPayNotes('');
    await loadAll();
    onDataChanged();
  };

  const activeList = tab === 'customers' ? customers : suppliers;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-lg bg-slate-200/70 p-1">
          <button
            type="button"
            onClick={() => setTab('customers')}
            className={`flex items-center gap-1.5 rounded-md px-4 py-1.5 text-xs font-semibold ${
              tab === 'customers' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            <Users className="h-3.5 w-3.5" /> Customers ({customers.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('suppliers')}
            className={`flex items-center gap-1.5 rounded-md px-4 py-1.5 text-xs font-semibold ${
              tab === 'suppliers' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            <Building2 className="h-3.5 w-3.5" /> Suppliers ({suppliers.length})
          </button>
        </div>

        <button
          type="button"
          onClick={() => setAddModal(true)}
          className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" /> Add {tab === 'customers' ? 'Customer' : 'Supplier'}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white lg:col-span-8">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                  <th className="px-4 py-3">Name &amp; Contact</th>
                  <th className="px-4 py-3">Address</th>
                  <th className="px-4 py-3 text-right">Total Business</th>
                  <th className="px-4 py-3 text-right">Outstanding Balance</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {activeList.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{p.name}</div>
                      <div className="text-xs text-slate-500">{p.phone || 'No phone'}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">{p.address || '—'}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs font-semibold tabular-nums">
                      {formatCurrency(p.total_purchases || 0, currency)}
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-mono text-xs font-bold tabular-nums ${
                        (p.outstanding_balance || 0) > 0 ? 'text-amber-700' : 'text-emerald-700'
                      }`}
                    >
                      {formatCurrency(p.outstanding_balance || 0, currency)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {(p.outstanding_balance || 0) > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setPayTarget({
                              type: tab === 'customers' ? 'customer' : 'supplier',
                              id: p.id,
                              name: p.name,
                              due: p.outstanding_balance || 0,
                            });
                            setPayAmount(String(p.outstanding_balance || 0));
                          }}
                          className="inline-flex items-center gap-1 rounded border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
                        >
                          <Banknote className="h-3.5 w-3.5" /> Settle
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Payment History Feed */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white lg:col-span-4">
          <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900">
            Recent Payment History
          </div>
          <div className="max-h-[480px] divide-y divide-slate-200 overflow-y-auto text-xs">
            {payments
              .filter((pay) => pay.party_type === (tab === 'customers' ? 'customer' : 'supplier'))
              .map((pay) => (
                <div key={pay.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <div className="font-semibold text-slate-900">{pay.party_name}</div>
                    <div className="text-slate-500">
                      {pay.invoice_no || 'Account settlement'} · {pay.payment_method.toUpperCase()}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono font-bold text-emerald-700 tabular-nums">
                      {formatCurrency(pay.amount, currency)}
                    </div>
                    <div className="text-slate-400">{formatDate(pay.payment_date)}</div>
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>

      {/* Add Customer / Supplier Modal */}
      {addModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h3 className="text-base font-semibold text-slate-900">
                Add New {tab === 'customers' ? 'Customer' : 'Supplier'}
              </h3>
              <button type="button" onClick={() => setAddModal(false)} className="text-slate-400">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSaveParty} className="space-y-3 p-5 text-xs">
              <div>
                <label className="block font-semibold text-slate-700">Name *</label>
                <input
                  type="text"
                  required
                  value={partyForm.name}
                  onChange={(e) => setPartyForm({ ...partyForm, name: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700">Phone</label>
                <input
                  type="text"
                  value={partyForm.phone}
                  onChange={(e) => setPartyForm({ ...partyForm, phone: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700">Address</label>
                <input
                  type="text"
                  value={partyForm.address}
                  onChange={(e) => setPartyForm({ ...partyForm, address: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700">Notes</label>
                <input
                  type="text"
                  value={partyForm.notes}
                  onChange={(e) => setPartyForm({ ...partyForm, notes: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setAddModal(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 font-medium text-slate-700"
                >
                  Cancel
                </button>
                <button type="submit" className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white">
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Record Payment Modal */}
      {payTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="border-b border-slate-200 px-5 py-4">
              <h3 className="text-base font-semibold text-slate-900">Record Payment — {payTarget.name}</h3>
              <p className="text-xs text-slate-500">Outstanding Balance: {formatCurrency(payTarget.due, currency)}</p>
            </div>
            <form onSubmit={handleRecordPayment} className="space-y-3 p-5 text-xs">
              <div>
                <label className="block font-semibold text-slate-700">Payment Amount ({currency})</label>
                <input
                  type="number"
                  required
                  min={1}
                  max={payTarget.due}
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700">Method</label>
                <select
                  value={payMethod}
                  onChange={(e) => setPayMethod(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="cash">Cash</option>
                  <option value="bank">Bank Transfer</option>
                  <option value="card">Card</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700">Reference / Notes</label>
                <input
                  type="text"
                  value={payNotes}
                  onChange={(e) => setPayNotes(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setPayTarget(null)}
                  className="rounded-lg border border-slate-300 px-4 py-2 font-medium text-slate-700"
                >
                  Cancel
                </button>
                <button type="submit" className="rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white">
                  Confirm Payment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
