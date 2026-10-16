import React, { useEffect, useState, useCallback } from 'react';

const API = process.env.REACT_APP_INDEXER_URL || 'http://localhost:3001';
const PAGE_SIZE = 20;

function StatusBadge({ status }) {
  const cls = {
    Completed:         'badge badge-completed',
    PartiallyRefunded: 'badge badge-refunded',
    FullyRefunded:     'badge badge-refunded',
    Pending:           'badge badge-pending',
  }[status] || 'badge';
  return <span className={cls}>{status || 'Unknown'}</span>;
}

export default function PaymentHistory({ merchantAddress }) {
  const [payments,   setPayments]   = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState(null);
  const [page,       setPage]       = useState(1);
  const [filterText, setFilterText] = useState('');

  const fetchPayments = useCallback(() => {
    if (!merchantAddress) return;
    setLoading(true);
    setError(null);
    fetch(`${API}/events/payment_processed`)
      .then(r => {
        if (!r.ok) throw new Error(`Server responded ${r.status}`);
        return r.json();
      })
      .then(data => {
        const filtered = (Array.isArray(data) ? data : []).filter(e =>
          JSON.stringify(e.topics || '').includes(merchantAddress)
        );
        setPayments(filtered);
        setPage(1);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [merchantAddress]);

  useEffect(() => { fetchPayments(); }, [fetchPayments]);

  /* Client-side filter by order ID / tx hash */
  const displayed = payments.filter(p => {
    if (!filterText) return true;
    const q = filterText.toLowerCase();
    return (
      (p.id          || '').toLowerCase().includes(q) ||
      (p.tx_hash     || '').toLowerCase().includes(q) ||
      (p.event_type  || '').toLowerCase().includes(q)
    );
  });

  const totalPages = Math.max(1, Math.ceil(displayed.length / PAGE_SIZE));
  const pageItems  = displayed.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <section aria-labelledby="payments-heading">
      <h2 id="payments-heading">Payment History</h2>

      {/* Controls */}
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="form-group" style={{ marginBottom: 0, flex: '1 1 220px' }}>
          <label htmlFor="payment-search">Search by ID or event</label>
          <input
            id="payment-search"
            type="search"
            value={filterText}
            onChange={e => { setFilterText(e.target.value); setPage(1); }}
            placeholder="Order ID, tx hash, event…"
          />
        </div>
        <button
          className="btn btn-secondary btn-sm"
          onClick={fetchPayments}
          disabled={loading}
          aria-label="Refresh payment history"
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div role="alert" aria-live="polite" className="alert alert-error">
          Failed to load payments: {error}
        </div>
      )}

      {loading ? (
        <p aria-live="polite" className="loading-state">Loading payments…</p>
      ) : displayed.length === 0 ? (
        <p className="empty-state">
          {filterText ? 'No payments match your search.' : 'No payments found for this address.'}
        </p>
      ) : (
        <>
          <div className="table-wrapper" role="region" aria-label="Payment history">
            <table>
              <caption className="visually-hidden">
                Payment history for {merchantAddress}. {displayed.length} record{displayed.length !== 1 ? 's' : ''}.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Ledger</th>
                  <th scope="col">Tx Hash</th>
                  <th scope="col">Event</th>
                  <th scope="col">Status</th>
                  <th scope="col">Date</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map(p => (
                  <tr key={p.id || p.tx_hash}>
                    <td>{p.ledger ?? '—'}</td>
                    <td>
                      <span className="mono" title={p.tx_hash}>
                        {p.tx_hash ? `${p.tx_hash.slice(0, 12)}…` : '—'}
                      </span>
                    </td>
                    <td>{p.event_type || '—'}</td>
                    <td><StatusBadge status={p.status} /></td>
                    <td>
                      {p.created_at
                        ? new Date(p.created_at).toLocaleString(undefined, {
                            year: 'numeric', month: 'short', day: 'numeric',
                            hour: '2-digit', minute: '2-digit',
                          })
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="pagination">
              <p className="pagination-info" aria-live="polite">
                Page {page} of {totalPages} · {displayed.length} record{displayed.length !== 1 ? 's' : ''}
              </p>
              <div className="pagination-controls" role="navigation" aria-label="Pagination">
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  aria-label="Previous page"
                >
                  ← Prev
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  aria-label="Next page"
                >
                  Next →
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
