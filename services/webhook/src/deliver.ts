import https from "https";
import http from "http";
import { URL } from "url";
import * as dlq from "./dlq";

export interface WebhookPayload {
  event: string;
  contractId: string;
  ledger: number;
  timestamp: number;
  data: Record<string, unknown>;
}

/**
 * Explicit allowlist of `data` fields per event type.
 *
 * Only fields listed here are forwarded to merchants; any other field present
 * on the raw Soroban event value is stripped before delivery (and before the
 * payload is stored in the DLQ).  Events not present in this map receive an
 * empty `data` object.
 */
export const EVENT_DATA_ALLOWLIST: Record<string, readonly string[]> = {
  payment_processed: ["id", "payer", "merchant", "amount", "token", "orderId"],
  refund_requested: ["id", "paymentId", "amount", "reason"],
  refund_completed: ["id", "paymentId", "amount", "reason"],
  refund_failed: ["id", "paymentId", "amount", "reason"],
  multisig_created: ["id", "signers", "threshold", "approvals"],
  multisig_approved: ["id", "signers", "threshold", "approvals"],
  multisig_executed: ["id", "signers", "threshold", "approvals"],
};

/**
 * Return only the fields of `raw` that are on the allowlist for `event`.
 * Unknown events yield an empty object.
 */
export function filterEventData(
  event: string,
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const allowed = EVENT_DATA_ALLOWLIST[event];
  if (!allowed) return {};

  const filtered: Record<string, unknown> = {};
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(raw, key)) {
      filtered[key] = raw[key];
    }
  }
  return filtered;
}

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 1_000;

/**
 * Validate that a webhook target URL uses a secure scheme.
 *
 * Plain `http:` URLs leak payment event data in transit, so they are rejected
 * by default.  Insecure delivery is only permitted when either:
 *   - `NODE_ENV=development` (local development convenience), or
 *   - `ALLOW_INSECURE_WEBHOOKS=true` is explicitly set (a warning is logged).
 *
 * Throws a configuration-level error for any other scheme (including `http:`
 * when insecure delivery is not permitted).
 */
export function assertSecureUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      `[webhook] Invalid webhook URL "${url}": not a valid absolute URL`,
    );
  }

  if (parsed.protocol === "https:") return;

  const isDevelopment = process.env.NODE_ENV === "development";
  const allowInsecure = process.env.ALLOW_INSECURE_WEBHOOKS === "true";

  if (parsed.protocol === "http:" && (isDevelopment || allowInsecure)) {
    if (allowInsecure) {
      console.warn(
        `[webhook] WARNING: ALLOW_INSECURE_WEBHOOKS is enabled — delivering to insecure URL ${url}. Payment event data will be sent over plain HTTP.`,
      );
    }
    return;
  }

  throw new Error(
    `[webhook] Insecure webhook URL rejected: "${url}" uses scheme "${parsed.protocol}". ` +
      `Only "https:" is allowed. Set ALLOW_INSECURE_WEBHOOKS=true to override (not recommended).`,
  );
}

/**
 * Attempt to deliver `payload` to `url` with exponential-backoff retries.
 *
 * If all attempts are exhausted, the delivery is moved to the Dead Letter
 * Queue (DLQ) instead of being silently dropped.  The DLQ can be inspected
 * and replayed via the admin API endpoints:
 *
 *   GET  /admin/dlq           — list all failed deliveries
 *   GET  /admin/dlq/:id       — inspect a single entry
 *   POST /admin/dlq/:id/replay — replay a single entry
 */
export async function deliver(
  url: string,
  payload: WebhookPayload,
  requestId?: string,
): Promise<void> {
  // Reject insecure targets before any delivery attempt is made.
  assertSecureUrl(url);

  const body = JSON.stringify(payload);
  const firstAttemptAt = new Date().toISOString();
  let lastError = "unknown error";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await post(url, body, requestId);
      return; // success — nothing to DLQ
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);

      if (attempt === MAX_ATTEMPTS) {
        // All attempts exhausted — move to DLQ (with the filtered payload).
        dlq.enqueue(url, safePayload, attempt, lastError, firstAttemptAt);
        return;
      }

      const delay = BASE_DELAY_MS * 2 ** (attempt - 1);
      console.warn(
        `[webhook] Attempt ${attempt}/${MAX_ATTEMPTS} failed for ${url} (${lastError}). Retrying in ${delay}ms…`,
      );
      await sleep(delay);
    }
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function post(url: string, body: string, requestId?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Guard again so no plain-HTTP request can ever be issued.
    try {
      assertSecureUrl(url);
    } catch (err) {
      reject(err);
      return;
    }
    const parsed = new URL(url);
    const lib = parsed.protocol === "https:" ? https : http;
    const headers: Record<string, string | number> = {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
      "User-Agent": "pulsar-webhook/0.1",
    };
    if (requestId) {
      headers["X-Request-ID"] = requestId;
    }
    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method: "POST",
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const REACHABILITY_TIMEOUT_MS = 5_000;

/**
 * Check whether `url` is reachable before confirming a webhook registration.
 *
 * Sends a lightweight HEAD request (falling back to GET if the target
 * rejects HEAD) with a short timeout. Returns true if the endpoint responds
 * with any HTTP status (even 4xx/5xx — we only care that something is
 * listening), false if the connection fails, times out, or the host cannot
 * be resolved.
 */
export function checkReachable(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      resolve(false);
      return;
    }

    const lib = parsed.protocol === "https:" ? https : http;
    const attempt = (method: "HEAD" | "GET") => {
      const req = lib.request(
        {
          hostname: parsed.hostname,
          port: parsed.port,
          path: parsed.pathname + parsed.search,
          method,
          timeout: REACHABILITY_TIMEOUT_MS,
          headers: { "User-Agent": "pulsar-webhook/0.1" },
        },
        (res) => {
          res.resume();
          if (method === "HEAD" && res.statusCode && res.statusCode >= 400 && res.statusCode < 500) {
            // Some servers don't support HEAD — retry with GET before giving up.
            attempt("GET");
            return;
          }
          resolve(true);
        },
      );
      req.on("timeout", () => {
        req.destroy();
        resolve(false);
      });
      req.on("error", () => {
        if (method === "HEAD") {
          attempt("GET");
        } else {
          resolve(false);
        }
      });
      req.end();
    };
    attempt("HEAD");
  });
}
