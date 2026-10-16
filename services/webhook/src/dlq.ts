/**
 * Dead Letter Queue (DLQ) for permanently failed webhook deliveries.
 *
 * Architecture
 * ------------
 * When a webhook delivery exhausts all retry attempts without a 2xx
 * response, the delivery is moved here instead of being silently dropped.
 *
 * Storage
 * -------
 * This module uses an in-memory store that is intentionally kept simple.
 * For production deployments replace the Map with a database table or a
 * managed queue (e.g. SQS, Redis Stream) and update the persistence
 * helpers accordingly.
 *
 * Alert threshold
 * ---------------
 * Set DLQ_ALERT_THRESHOLD (environment variable or compile-time constant)
 * to emit a console warning / emit a metric whenever the DLQ depth
 * exceeds that value.  Wire the warning to your alerting system (e.g.
 * CloudWatch, Datadog, PagerDuty).
 */

import { WebhookPayload } from "./deliver";

// ── Constants ──────────────────────────────────────────────────────────────────

/**
 * DLQ depth that triggers an alert.
 * Override via environment variable DLQ_ALERT_THRESHOLD.
 */
export const DLQ_ALERT_THRESHOLD =
  Number(process.env.DLQ_ALERT_THRESHOLD ?? 10);

// ── Types ──────────────────────────────────────────────────────────────────────

export interface DlqEntry {
  /** Unique identifier for this DLQ entry. */
  id: string;
  /** The target URL that could not be reached. */
  url: string;
  /** The payload that failed to deliver. */
  payload: WebhookPayload;
  /** ISO-8601 timestamp of the first delivery attempt. */
  firstAttemptAt: string;
  /** ISO-8601 timestamp when it was moved to the DLQ. */
  failedAt: string;
  /** Number of delivery attempts that were made. */
  attempts: number;
  /** Last error message encountered. */
  lastError: string;
  /** ISO-8601 timestamp of the last replay attempt, if any. */
  lastReplayAt?: string;
  /** Number of replay attempts made from the DLQ. */
  replayAttempts: number;
}

// ── In-memory store ────────────────────────────────────────────────────────────

// In production replace this with a DB query / queue client.
const dlq = new Map<string, DlqEntry>();
let _sequenceCounter = 0;

function generateId(): string {
  _sequenceCounter += 1;
  return `dlq_${Date.now()}_${_sequenceCounter}`;
}

// ── Core DLQ operations ────────────────────────────────────────────────────────

/**
 * Move a permanently failed delivery into the DLQ.
 *
 * Emits a console error (visible in structured logging / CloudWatch).
 * If the DLQ depth exceeds DLQ_ALERT_THRESHOLD a warning is also emitted —
 * wire this to your alerting integration.
 */
export function enqueue(
  url: string,
  payload: WebhookPayload,
  attempts: number,
  lastError: string,
  firstAttemptAt: string,
): DlqEntry {
  const entry: DlqEntry = {
    id: generateId(),
    url,
    payload,
    firstAttemptAt,
    failedAt: new Date().toISOString(),
    attempts,
    lastError,
    replayAttempts: 0,
  };

  dlq.set(entry.id, entry);

  console.error(
    `[dlq] Permanent delivery failure — enqueued id=${entry.id} url=${url} attempts=${attempts} error="${lastError}"`,
  );

  checkAlertThreshold();

  return entry;
}

/**
 * Retrieve a single DLQ entry by ID.
 */
export function getEntry(id: string): DlqEntry | undefined {
  return dlq.get(id);
}

/**
 * List all DLQ entries, newest first.
 *
 * Optionally filter to entries for a specific merchant URL prefix.
 */
export function listEntries(urlPrefix?: string): DlqEntry[] {
  const all = Array.from(dlq.values()).sort(
    (a, b) => new Date(b.failedAt).getTime() - new Date(a.failedAt).getTime(),
  );
  if (urlPrefix) {
    return all.filter((e) => e.url.startsWith(urlPrefix));
  }
  return all;
}

/**
 * Current DLQ depth (number of entries).
 */
export function depth(): number {
  return dlq.size;
}

/**
 * Remove a DLQ entry after a successful replay.
 */
export function remove(id: string): boolean {
  return dlq.delete(id);
}

/**
 * Mark a replay attempt on an entry (before the attempt is made).
 */
export function markReplayAttempt(id: string): DlqEntry | undefined {
  const entry = dlq.get(id);
  if (!entry) return undefined;
  const updated: DlqEntry = {
    ...entry,
    lastReplayAt: new Date().toISOString(),
    replayAttempts: entry.replayAttempts + 1,
  };
  dlq.set(id, updated);
  return updated;
}

// ── Alert helper ──────────────────────────────────────────────────────────────

function checkAlertThreshold(): void {
  const current = dlq.size;
  if (current >= DLQ_ALERT_THRESHOLD) {
    console.warn(
      `[dlq] ALERT: DLQ depth ${current} has reached or exceeded threshold ${DLQ_ALERT_THRESHOLD}. ` +
        `Inspect and replay entries via the admin API: GET /admin/dlq`,
    );
    // TODO: emit metric to your alerting backend here, e.g.:
    //   cloudwatch.putMetricData({ ... dlqDepth: current ... })
  }
}
