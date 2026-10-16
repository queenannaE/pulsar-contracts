import React, { useState } from 'react';
import { useWallet } from './hooks/useWallet';
import PaymentHistory from './components/PaymentHistory';
import RefundManager from './components/RefundManager';
import MerchantProfile from './components/MerchantProfile';
import './App.css';

const TABS = [
  { id: 'Payments', label: 'Payments' },
  { id: 'Refunds',  label: 'Refunds' },
  { id: 'Profile',  label: 'Profile' },
];

export default function App() {
  const {
    publicKey,
    connectFreighter,
    connectAlbedo,
    disconnect,
    walletType,
    error,
  } = useWallet();

  const [tab, setTab] = useState('Payments');

  return (
    <div className="app">
      {/* WCAG 2.4.1 — skip navigation */}
      <a href="#main-content" className="skip-link">Skip to main content</a>

      <header className="app-header">
        <h1>Pulsar Merchant Dashboard</h1>

        {publicKey ? (
          <div className="wallet-info">
            <span
              className="wallet-address"
              title={publicKey}
              aria-label={`Connected wallet: ${publicKey}`}
            >
              {publicKey.slice(0, 8)}…{publicKey.slice(-4)}
              {walletType && <> ({walletType})</>}
            </span>
            <button className="btn btn-ghost btn-sm" onClick={disconnect}>
              Disconnect
            </button>
          </div>
        ) : (
          <div className="wallet-buttons">
            <button className="btn btn-ghost btn-sm" onClick={connectFreighter}>
              Connect Freighter
            </button>
            <button className="btn btn-ghost btn-sm" onClick={connectAlbedo}>
              Connect Albedo
            </button>
          </div>
        )}
      </header>

      {error && (
        <div role="alert" aria-live="assertive" className="alert alert-error" style={{ margin: '1rem 1.5rem 0' }}>
          {error}
        </div>
      )}

      {!publicKey ? (
        <main id="main-content" className="connect-prompt" aria-label="Connect wallet">
          <h2>Connect your wallet</h2>
          <p>Connect your Freighter or Albedo wallet to access the merchant dashboard.</p>
          <div className="wallet-buttons">
            <button className="btn btn-primary" onClick={connectFreighter}>
              Connect Freighter
            </button>
            <button className="btn btn-secondary" onClick={connectAlbedo}>
              Connect Albedo
            </button>
          </div>
        </main>
      ) : (
        <>
          <nav aria-label="Dashboard sections">
            <ul role="tablist" className="tabs" aria-label="Dashboard sections">
              {TABS.map(t => (
                <li key={t.id} role="presentation">
                  <button
                    id={`tab-${t.id}`}
                    role="tab"
                    aria-selected={tab === t.id}
                    aria-controls={`panel-${t.id}`}
                    onClick={() => setTab(t.id)}
                  >
                    {t.label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <main id="main-content">
            {TABS.map(t => (
              <div
                key={t.id}
                id={`panel-${t.id}`}
                role="tabpanel"
                aria-labelledby={`tab-${t.id}`}
                hidden={tab !== t.id}
                className="tab-content"
              >
                {tab === t.id && (
                  <>
                    {t.id === 'Payments' && <PaymentHistory merchantAddress={publicKey} />}
                    {t.id === 'Refunds'  && <RefundManager  merchantAddress={publicKey} />}
                    {t.id === 'Profile'  && <MerchantProfile publicKey={publicKey} walletType={walletType} />}
                  </>
                )}
              </div>
            ))}
          </main>
        </>
      )}
    </div>
  );
}
