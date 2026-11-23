import React, { useState } from "react";
import { useContractCall } from "../hooks/useContractCall";
import { Spinner, ErrorMessage, SuccessBanner } from "./ContractCallStatus";
import { contract, server, NETWORK_PASSPHRASE } from "../contract";
import { TransactionBuilder, Account, nativeToScVal, rpc } from "@stellar/stellar-sdk";

export interface CheckoutWidgetProps {
  /** Merchant-assigned order identifier. */
  orderId: string;
  /** Payment amount in the smallest token unit. */
  amount: number;
  /** Token contract address (Stellar asset). */
  token: string;
  /** Merchant's Stellar public key. */
  merchantAddress: string;
  /** Called with the transaction hash on successful submission. */
  onSuccess?: (txHash: string) => void;
  /** Called with a human-readable error message on failure. */
  onError?: (message: string) => void;
}

/**
 * Embeddable checkout widget.
 *
 * Drop-in React component that handles Freighter wallet connection, order
 * signing, and contract submission. Accepts orderId, amount, token, and
 * merchantAddress props, and emits onSuccess / onError callbacks.
 *
 * Usage:
 * ```tsx
 * <CheckoutWidget
 *   orderId="order_123"
 *   amount={1000}
 *   token="USDC_CONTRACT_ADDRESS"
 *   merchantAddress="GMERCHANT..."
 *   onSuccess={(tx) => console.log("paid", tx)}
 *   onError={(msg) => console.error(msg)}
 * />
 * ```
 */
export function CheckoutWidget({
  orderId,
  amount,
  token,
  merchantAddress,
  onSuccess,
  onError,
}: CheckoutWidgetProps) {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const { state, execute, reset } = useContractCall<null>();

  async function connectWallet() {
    const freighter = (window as any).freighter;
    if (!freighter) {
      alert("Freighter wallet extension not found. Please install it.");
      return;
    }
    await freighter.setAllowed();
    const address = await freighter.getPublicKey();
    setWalletAddress(address);
  }

  async function handlePay() {
    if (!walletAddress) return;

    await execute(async () => {
      // Build the order payload
      const order = {
        order_id: orderId,
        merchant_address: merchantAddress,
        payer: walletAddress,
        token,
        amount,
        description: `Payment for order ${orderId}`,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      };

      // Submit to contract using real @stellar/stellar-sdk invocation
      const txHash = await submitPayment({ order });

      // Fire success callback inside the executor so the txHash is available
      // immediately and before React re-renders with the success state.
      onSuccess?.(txHash);
      return { result: null, txHash };
    });
    // Note: onError is wired via useEffect below so it fires after React
    // has actually committed the error state — avoiding a stale-closure bug
    // where state.status is checked synchronously before the state update.
  }

  // Fire onError callback after the state update has been committed.
  // Using a ref-flag avoids calling the callback on the initial render.
  const prevStatusRef = React.useRef(state.status);
  React.useEffect(() => {
    if (
      prevStatusRef.current !== "error" &&
      state.status === "error" &&
      onError
    ) {
      onError((state as Extract<typeof state, { status: "error" }>).message);
    }
    prevStatusRef.current = state.status;
  }, [state, onError]);

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 max-w-sm w-full shadow-sm space-y-4">
      <h2 className="text-lg font-semibold text-[var(--color-text)]">Checkout</h2>

      <dl className="text-sm space-y-1 text-[var(--color-text-muted)]">
        <div className="flex justify-between">
          <dt>Order</dt>
          <dd className="font-mono text-[var(--color-text)]">{orderId}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Amount</dt>
          <dd className="font-medium text-[var(--color-text)]">{amount}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Token</dt>
          <dd className="font-mono truncate max-w-[160px] text-[var(--color-text)]">{token}</dd>
        </div>
      </dl>

      {state.status === "success" && <SuccessBanner txHash={state.txHash} />}
      {state.status === "error" && <ErrorMessage message={state.message} />}

      {state.status !== "success" && (
        <>
          {!walletAddress ? (
            <button
              onClick={connectWallet}
              className="w-full rounded-lg bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white py-2 px-4 text-sm font-medium transition-colors"
            >
              Connect Wallet
            </button>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-[var(--color-text-muted)] truncate">
                Connected: <span className="font-mono">{walletAddress}</span>
              </p>
              <button
                onClick={handlePay}
                disabled={state.status === "loading"}
                className="w-full rounded-lg bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] disabled:opacity-50 text-white py-2 px-4 text-sm font-medium transition-colors flex items-center justify-center gap-2"
              >
                {state.status === "loading" ? <Spinner label="Submitting…" /> : "Pay Now"}
              </button>
            </div>
          )}
        </>
      )}

      {state.status === "error" && (
        <button onClick={reset} className="text-xs text-[var(--color-text-muted)] underline">
          Try again
        </button>
      )}
    </div>
  );
}

/** Real @stellar/stellar-sdk contract invocation with Freighter signing and transaction polling. */
export async function submitPayment(payload: {
  order: {
    order_id: string;
    merchant_address: string;
    payer: string;
    token: string;
    amount: number;
    description?: string;
    expires_at?: number;
  };
  signature?: string;
}): Promise<string> {
  const freighter = (window as any).freighter;
  if (!freighter) {
    throw new Error("Freighter wallet not found");
  }

  // 1. Build contract call operation for submit_payment
  const callOp = contract.call(
    "submit_payment",
    nativeToScVal(payload.order.order_id, { type: "string" }),
    nativeToScVal(payload.order.merchant_address, { type: "address" }),
    nativeToScVal(payload.order.payer, { type: "address" }),
    nativeToScVal(payload.order.token, { type: "address" }),
    nativeToScVal(BigInt(payload.order.amount), { type: "i128" })
  );

  // 2. Fetch payer account sequence or create account object for preparation
  let account: Account;
  try {
    account = await server.getAccount(payload.order.payer);
  } catch {
    account = new Account(payload.order.payer, "0");
  }

  // 3. Build transaction
  const tx = new TransactionBuilder(account, {
    fee: "100000",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(callOp)
    .setTimeout(300)
    .build();

  // 4. Prepare transaction with Soroban RPC
  const preparedTx = await server.prepareTransaction(tx);

  // 5. Sign with Freighter
  const signResult = await freighter.signTransaction(preparedTx.toXDR(), {
    networkPassphrase: NETWORK_PASSPHRASE,
  });

  const signedXDR =
    typeof signResult === "string"
      ? signResult
      : signResult?.signedXDR ?? signResult?.signedTxXdr ?? payload.signature;

  if (!signedXDR) {
    throw new Error("Failed to sign transaction with Freighter");
  }

  const transactionToSend = TransactionBuilder.fromXDR(signedXDR, NETWORK_PASSPHRASE);

  // 6. Send transaction
  const sendResponse = await server.sendTransaction(transactionToSend);
  if (sendResponse.status === "ERROR") {
    throw new Error(
      `Transaction submission failed: ${
        (sendResponse as any).errorResult?.toXDR?.("base64") || "Submission error"
      }`
    );
  }

  const txHash = sendResponse.hash;

  // 7. Poll transaction status until confirmed or failed
  let attempts = 0;
  const maxAttempts = 30;
  while (attempts < maxAttempts) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const txStatus = await server.getTransaction(txHash);

    if (txStatus.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      return txHash;
    }
    if (txStatus.status === rpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(`Transaction execution failed on ledger: ${txHash}`);
    }
    attempts++;
  }

  return txHash;
}
