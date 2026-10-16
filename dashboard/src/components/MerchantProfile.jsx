import React, { useEffect, useState } from 'react';

const API = process.env.REACT_APP_INDEXER_URL || 'http://localhost:3001';

function Field({ term, value, mono }) {
  return (
    <div className="profile-field">
      <dt>{term}</dt>
      <dd className={mono ? 'mono' : undefined}>{value || '—'}</dd>
    </div>
  );
}

export default function MerchantProfile({ publicKey, walletType }) {
  const [stats,   setStats]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    if (!publicKey) return;
    setLoading(true);
    setError(null);
    fetch(`${API}/merchants/${encodeURIComponent(publicKey)}/stats`)
      .then(r => {
        if (!r.ok) throw new Error(`Server responded ${r.status}`);
        return r.json();
      })
      .then(data => setStats(data))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [publicKey]);

  return (
    <section aria-labelledby="profile-heading">
      <h2 id="profile-heading">Merchant Profile</h2>

      <dl className="profile-grid">
        <Field term="Wallet Address"  value={publicKey}   mono />
        <Field term="Wallet Provider" value={walletType} />
      </dl>

      {/* On-chain stats */}
      <h3 style={{ marginTop: '1.5rem', marginBottom: '0.75rem', fontSize: '0.95rem', fontWeight: 600 }}>
        On-chain Statistics
      </h3>

      {loading && (
        <p aria-live="polite" className="loading-state">Loading stats…</p>
      )}
      {error && (
        <div role="alert" className="alert alert-warning">
          Could not load stats: {error}
        </div>
      )}
      {stats && !loading && (
        <dl className="profile-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
          <Field term="Total Payments"       value={stats.total_payments?.toLocaleString()} />
          <Field term="Total Volume"         value={stats.total_volume != null ? stats.total_volume.toLocaleString() : null} />
          <Field term="Total Refunds"        value={stats.total_refunds?.toLocaleString()} />
          <Field term="Total Refund Volume"  value={stats.total_refund_volume != null ? stats.total_refund_volume.toLocaleString() : null} />
        </dl>
      )}

      <div className="profile-notice" role="note">
        To update your merchant profile (name, description, contact info), use the
        Stellar CLI or the Pulsar SDK to call <code>register_merchant</code> on-chain.
      </div>
    </section>
  );
}
