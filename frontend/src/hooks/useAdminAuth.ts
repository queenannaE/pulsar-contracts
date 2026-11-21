import { useState } from "react";

export interface AdminAuthState {
  address: string | null;
  isAdmin: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
}

/**
 * Wallet-based admin auth via Freighter.
 * isAdmin is verified against the contract's admin address.
 */
export function useAdminAuth(adminAddress: string): AdminAuthState {
  const [address, setAddress] = useState<string | null>(null);

  async function connect() {
    const freighter = (window as any).freighter;
    if (!freighter) {
      alert("Freighter wallet extension not found.");
      return;
    }
    const alreadyAllowed = await freighter.isAllowed?.();
    if (!alreadyAllowed) {
      await freighter.setAllowed();
    }
    const pubKey: string = await freighter.getPublicKey();
    setAddress(pubKey);
  }

  function disconnect() {
    setAddress(null);
  }

  return {
    address,
    isAdmin: address === adminAddress,
    connect,
    disconnect,
  };
}
