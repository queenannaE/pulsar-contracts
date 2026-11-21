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

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 1_000;

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
): Promise<void> {
  const body = JSON.stringify(payload);
  const firstAttemptAt = new Date().toISOString();
  let lastError = "unknown error";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await post(url, body);
      return; // success — nothing to DLQ
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);

      if (attempt === MAX_ATTEMPTS) {
        // All attempts exhausted — move to DLQ.
        dlq.enqueue(url, payload, attempt, lastError, firstAttemptAt);
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

function post(url: string, body: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          "User-Agent": "pulsar-webhook/0.1",
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
        res.resume();
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
