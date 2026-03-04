'use client';

import { useState, useEffect, useCallback } from 'react';

interface Invoice {
  id: string;
  vendor: string;
  amount: number;
  currency: string;
  dueDate: string | null;
  status: string;
  emailSubject: string;
  emailDate: string;
  emailLink: string;
  processedAt: string;
}

function getUrgencyClass(dueDate: string | null, status: string): string {
  if (status === 'paid') return 'bg-gray-50 border-gray-200';
  if (status === 'cancelled') return 'bg-gray-50 border-gray-200 opacity-60';
  if (!dueDate) return 'bg-white border-gray-200';

  const now = new Date();
  const due = new Date(dueDate);
  const diffDays = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return 'bg-red-50 border-red-300';
  if (diffDays <= 7) return 'bg-yellow-50 border-yellow-300';
  return 'bg-green-50 border-green-200';
}

function getUrgencyBadge(dueDate: string | null, status: string): { text: string; className: string } | null {
  if (status === 'paid') return { text: 'Paid', className: 'bg-gray-200 text-gray-600' };
  if (status === 'cancelled') return { text: 'Cancelled', className: 'bg-gray-200 text-gray-500' };
  if (!dueDate) return null;

  const now = new Date();
  const due = new Date(dueDate);
  const diffDays = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return { text: `${Math.abs(diffDays)}d overdue`, className: 'bg-red-100 text-red-700' };
  if (diffDays === 0) return { text: 'Due today', className: 'bg-red-100 text-red-700' };
  if (diffDays <= 7) return { text: `Due in ${diffDays}d`, className: 'bg-yellow-100 text-yellow-700' };
  return { text: `Due in ${diffDays}d`, className: 'bg-green-100 text-green-700' };
}

function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('he-IL', { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString('he-IL', {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function groupByMonth(invoices: Invoice[]): Map<string, Invoice[]> {
  const groups = new Map<string, Invoice[]>();

  for (const inv of invoices) {
    const dateStr = inv.dueDate || inv.emailDate;
    let key = 'No Date';
    if (dateStr) {
      const d = new Date(dateStr);
      if (!isNaN(d.getTime())) {
        key = d.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
      }
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(inv);
  }

  return groups;
}

export default function LoginWrapper() {
  const [token, setToken] = useState<string>('');
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('invoice_token') : null;
    if (saved) {
      setToken(saved);
      setAuthenticated(true);
    }
  }, []);

  function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (token.trim()) {
      localStorage.setItem('invoice_token', token.trim());
      setAuthenticated(true);
    }
  }

  if (!authenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <form onSubmit={handleLogin} className="bg-white p-8 rounded-lg shadow-md w-full max-w-sm">
          <h1 className="text-xl font-semibold text-gray-800 mb-6">Invoice Monitor</h1>
          <label className="block text-sm font-medium text-gray-600 mb-2">Access Token</label>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="w-full px-3 py-2 border rounded-md mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Enter your token"
            autoFocus
          />
          <button
            type="submit"
            className="w-full bg-blue-600 text-white py-2 rounded-md hover:bg-blue-700 transition"
          >
            Sign In
          </button>
        </form>
      </div>
    );
  }

  return <Dashboard token={token} onLogout={() => { localStorage.removeItem('invoice_token'); setAuthenticated(false); setToken(''); }} />;
}

function Dashboard({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'pending' | 'paid'>('pending');
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const fetchInvoices = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch(`/api/invoices?token=${encodeURIComponent(token)}`);
      if (res.status === 401) {
        onLogout();
        return;
      }
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setInvoices(data.invoices);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load invoices';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [token, onLogout]);

  useEffect(() => {
    fetchInvoices();
    const interval = setInterval(fetchInvoices, 60 * 60 * 1000); // refresh hourly
    return () => clearInterval(interval);
  }, [fetchInvoices]);

  async function toggleStatus(invoice: Invoice) {
    const newStatus = invoice.status === 'paid' ? 'pending' : 'paid';
    setUpdatingId(invoice.id);

    try {
      const res = await fetch('/api/mark-paid', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ invoiceId: invoice.id, status: newStatus }),
      });

      if (res.ok) {
        setInvoices((prev) =>
          prev.map((inv) => (inv.id === invoice.id ? { ...inv, status: newStatus } : inv))
        );
      }
    } catch {
      // silently fail — next refresh will correct state
    } finally {
      setUpdatingId(null);
    }
  }

  const filtered = invoices.filter((inv) => {
    if (filter === 'pending') return inv.status !== 'paid' && inv.status !== 'cancelled';
    if (filter === 'paid') return inv.status === 'paid';
    return true;
  });

  const grouped = groupByMonth(filtered);

  const totalPending = invoices
    .filter((inv) => inv.status !== 'paid' && inv.status !== 'cancelled')
    .reduce((sum, inv) => sum + inv.amount, 0);

  const overdueCount = invoices.filter((inv) => {
    if (inv.status === 'paid' || inv.status === 'cancelled' || !inv.dueDate) return false;
    return new Date(inv.dueDate) < new Date();
  }).length;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Invoice Monitor</h1>
          <p className="text-sm text-gray-500 mt-1">
            {invoices.length} invoices tracked
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={fetchInvoices}
            className="text-sm text-blue-600 hover:text-blue-800"
          >
            Refresh
          </button>
          <button
            onClick={onLogout}
            className="text-sm text-gray-400 hover:text-gray-600"
          >
            Sign out
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-white rounded-lg border p-4">
          <p className="text-sm text-gray-500">Total Pending</p>
          <p className="text-2xl font-semibold text-gray-900">
            {formatCurrency(totalPending, 'ILS')}
          </p>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <p className="text-sm text-gray-500">Overdue</p>
          <p className={`text-2xl font-semibold ${overdueCount > 0 ? 'text-red-600' : 'text-gray-900'}`}>
            {overdueCount}
          </p>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
        {(['pending', 'all', 'paid'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-1.5 text-sm rounded-md transition ${
              filter === f ? 'bg-white shadow-sm font-medium text-gray-900' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading invoices...</div>
      ) : error ? (
        <div className="text-center py-12">
          <p className="text-red-500 mb-2">{error}</p>
          <button onClick={fetchInvoices} className="text-blue-600 hover:underline text-sm">
            Try again
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          No {filter === 'all' ? '' : filter} invoices found
        </div>
      ) : (
        Array.from(grouped.entries()).map(([month, monthInvoices]) => (
          <div key={month} className="mb-8">
            <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">
              {month}
            </h2>
            <div className="space-y-2">
              {monthInvoices.map((inv) => {
                const badge = getUrgencyBadge(inv.dueDate, inv.status);
                return (
                  <div
                    key={inv.id}
                    className={`rounded-lg border p-4 transition ${getUrgencyClass(inv.dueDate, inv.status)}`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className={`font-medium ${inv.status === 'paid' ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                            {inv.vendor}
                          </h3>
                          {badge && (
                            <span className={`text-xs px-2 py-0.5 rounded-full ${badge.className}`}>
                              {badge.text}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
                          <span>Due: {formatDate(inv.dueDate)}</span>
                          {inv.emailLink && (
                            <a
                              href={inv.emailLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-500 hover:text-blue-700 hover:underline"
                            >
                              View email
                            </a>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 ml-4">
                        <span className={`text-lg font-semibold tabular-nums ${inv.status === 'paid' ? 'text-gray-400' : 'text-gray-900'}`}>
                          {formatCurrency(inv.amount, inv.currency)}
                        </span>
                        <button
                          onClick={() => toggleStatus(inv)}
                          disabled={updatingId === inv.id}
                          className={`w-7 h-7 rounded-full border-2 flex items-center justify-center transition ${
                            inv.status === 'paid'
                              ? 'bg-green-500 border-green-500 text-white'
                              : 'border-gray-300 hover:border-green-400 text-transparent hover:text-green-400'
                          } ${updatingId === inv.id ? 'opacity-50' : ''}`}
                          title={inv.status === 'paid' ? 'Mark as unpaid' : 'Mark as paid'}
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
