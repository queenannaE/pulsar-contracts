import { useState, useCallback } from 'react';
import {
  isConnected as freighterIsConnected,
  getPublicKey as freighterGetPublicKey,
  signTransaction as freighterSignTransaction,
} from '@stellar/freighter-api';

/**
 * Lazily import Albedo so the dashboard still builds even if
 * the package is not yet installed (graceful degradation).
 */
async function loadAlbedo() {
  try {
    const mod = await import('@albedo-link/intent');
    return mod.default || mod;
  } catch {
    return null;
  }
}

/**
 * useWallet — supports Freighter and Albedo wallets.
 *
 * Returns:
 *   publicKey        — connected G… address or null
 *   walletType       — 'Freighter' | 'Albedo' | null
 *   connectFreighter — async fn
 *   connectAlbedo    — async fn
 *   disconnect       — fn
 *   signTransaction  — async fn(xdr, network) → signed XDR string
 *   error            — last error message or null
 */
export function useWallet() {
  const [publicKey,  setPublicKey]  = useState(null);
  const [walletType, setWalletType] = useState(null);
  const [error,      setError]      = useState(null);

  /* ---- Freighter ---- */
  const connectFreighter = useCallback(async () => {
    setError(null);
    try {
      const connected = await freighterIsConnected();
      if (!connected) {
        setError('Freighter not found. Install it from freighter.app.');
        return;
      }
      const key = await freighterGetPublicKey();
      if (!key) {
        setError('Freighter returned no public key.');
        return;
      }
      setPublicKey(key);
      setWalletType('Freighter');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  /* ---- Albedo ---- */
  const connectAlbedo = useCallback(async () => {
    setError(null);
    const albedo = await loadAlbedo();
    if (!albedo) {
      setError('Albedo library failed to load. Check your network connection.');
      return;
    }
    try {
      // publicKey intent opens an Albedo popup and returns the user's key
      const result = await albedo.publicKey({});
      if (!result || !result.pubkey) {
        setError('Albedo returned no public key.');
        return;
      }
      setPublicKey(result.pubkey);
      setWalletType('Albedo');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const disconnect = useCallback(() => {
    setPublicKey(null);
    setWalletType(null);
    setError(null);
  }, []);

  /**
   * signTransaction — signs a Stellar XDR transaction.
   *
   * @param {string} xdr     — base64-encoded transaction envelope
   * @param {string} network — 'TESTNET' | 'PUBLIC'
   * @returns {Promise<string>} — signed XDR
   */
  const signTransaction = useCallback(async (xdr, network = 'TESTNET') => {
    if (walletType === 'Freighter') {
      return freighterSignTransaction(xdr, { network });
    }
    if (walletType === 'Albedo') {
      const albedo = await loadAlbedo();
      if (!albedo) throw new Error('Albedo library not available');
      const result = await albedo.tx({ xdr, network: network.toLowerCase() });
      return result.signed_envelope_xdr;
    }
    throw new Error('No wallet connected');
  }, [walletType]);

  return {
    publicKey,
    walletType,
    connectFreighter,
    connectAlbedo,
    disconnect,
    signTransaction,
    error,
  };
}
