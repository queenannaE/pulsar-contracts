import { useState } from "react";
import { getErrorMessage } from "../lib/contractErrors";
import { useNotifications } from "../components/NotificationCenter";

export type CallState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: T; txHash: string }
  | { status: "error"; message: string };

export function useContractCall<T>() {
  const [state, setState] = useState<CallState<T>>({ status: "idle" });
  const { notify } = useNotifications();

  async function execute(fn: () => Promise<{ result: T; txHash: string }>) {
    setState({ status: "loading" });
    try {
      const { result, txHash } = await fn();
      setState({ status: "success", data: result, txHash });
    } catch (err) {
      const message = getErrorMessage(err);
      setState({ status: "error", message });
      // MISC-045: surface payment/contract-call failures as a global alert,
      // not just inline widget state that can go unnoticed.
      notify("error", `Payment failed: ${message}`);
    }
  }

  function reset() {
    setState({ status: "idle" });
  }

  return { state, execute, reset };
}
