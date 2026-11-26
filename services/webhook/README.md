# Pulsar Webhook Service

Off-chain service that listens to Pulsar contract events and delivers HTTP POST notifications to registered merchant webhook URLs.

## Setup

```bash
cd services/webhook
cp .env.example .env    # fill in CONTRACT_ID
npm install
npm run dev             # development
npm run build && npm start  # production
```

## API

All endpoints accept JSON request bodies up to **64kb**. Requests with a larger body are rejected with HTTP `413 Payload Too Large`.

### Register a webhook

Registration is a two-step handshake. `POST /webhooks` does **not** immediately activate the URL; it creates a **pending** registration and sends a challenge token to the target URL. The registration only becomes **confirmed** (and starts receiving events) after the challenge is echoed back via the verification endpoint.

```http
POST /webhooks
Content-Type: application/json

{
  "merchantAddress": "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "url": "https://your-server.example.com/pulsar-events"
}
```

Response `202` (pending):
```json
{
  "merchantAddress": "GXXX...",
  "url": "https://your-server.example.com/pulsar-events",
  "status": "pending",
  "registeredAt": 1717200000000
}
```

The service then delivers a `POST` to the registered URL:

```json
{
  "event": "webhook_challenge",
  "merchantAddress": "GXXX...",
  "challenge": "<opaque challenge token>"
}
```

### Verify a webhook registration

Echo the challenge token back to confirm ownership of the URL:

```http
POST /webhooks/:merchantAddress/verify
Content-Type: application/json

{
  "challenge": "<opaque challenge token>"
}
```

Response `200` (confirmed):
```json
{
  "merchantAddress": "GXXX...",
  "url": "https://your-server.example.com/pulsar-events",
  "status": "confirmed",
  "registeredAt": 1717200000000,
  "confirmedAt": 1717200060000
}
```

An incorrect or expired challenge returns `400` and the registration stays pending.

### Get a registration

```http
GET /webhooks/:merchantAddress
```

### Delete a registration

```http
DELETE /webhooks/:merchantAddress
```

### Test a webhook

Sends a synthetic `webhook_test` event to the merchant's registered URL so you can verify the endpoint is reachable and receiving payloads.

```http
POST /webhooks/test
Content-Type: application/json

{
  "merchantAddress": "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
}
```

Response `200`:
```json
{
  "merchantAddress": "GXXX...",
  "url": "https://your-server.example.com/pulsar-events",
  "statusCode": 200,
  "body": "{\"received\":true}",
  "deliveredAt": 1717200000000
}
```

`statusCode` and `body` are the HTTP status code and response body returned by the target URL.

This endpoint is rate-limited to **5 calls per minute per merchant**. Exceeding the limit returns `429`.

Errors:
- `404` — no webhook registration exists for the given `merchantAddress`
- `429` — rate limit exceeded (5 calls per minute per merchant)

### Health endpoints

#### `GET /health`
Basic service status with a timestamp and uptime.

#### `GET /health/deep`
Full dependency health check including:
- database connection
- RPC node health
- contract availability on Soroban

#### `GET /health/liveness`
Reports whether the service process is alive.

#### `GET /health/readiness`
Reports whether the service is ready to receive traffic.

#### `GET /health/metrics`
Returns runtime health metrics and response-time statistics.

---

## Registration Security Model

Registering a webhook URL is a privileged action: whoever controls a registration receives that merchant's payment events. To prevent an attacker from registering a victim merchant's URL and intercepting their events, registrations must prove control of the target URL.

### Challenge-token handshake

1. **Request** — the client calls `POST /webhooks` with `merchantAddress` and `url`. The service stores the registration with `status: "pending"` and generates a single-use, time-limited challenge token.
2. **Challenge delivery** — the service sends a `webhook_challenge` event containing the token to the submitted URL. Only a party that actually receives traffic at that URL can read the token.
3. **Echo back** — the client calls `POST /webhooks/:merchantAddress/verify` with the token. If it matches the stored challenge and has not expired, the registration is marked `status: "confirmed"`.
4. **Activation** — only `confirmed` registrations receive event deliveries.

### Lifecycle

| Status | Meaning | Receives events |
|---|---|---|
| `pending` | Challenge issued, awaiting verification | No |
| `confirmed` | Challenge echoed back successfully | Yes |

Pending registrations that are never verified expire and are discarded. Re-registering a URL restarts the handshake with a fresh challenge token.

### Why unverified URLs are rejected

Without the handshake, anyone could register an arbitrary URL (including a victim merchant's) and receive events they do not own. Requiring the challenge to be echoed back proves the registrant controls the endpoint, so events are only ever delivered to URLs whose owners opted in. Event delivery to `pending` registrations is refused.

---

## Webhook Payload

Every event delivers a `POST` to the registered URL with this JSON body:

```json
{
  "event": "payment_processed",
  "contractId": "CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "ledger": 1234567,
  "timestamp": 1717200000,
  "data": {
    "paymentId": "0000000000000000-0000000000000000-0",
    "amount": "10000000",
    "merchant": "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
  }
}
```

### Supported events

| `event` | Trigger |
|---|---|
| `payment_processed` | A payment was successfully processed |
| `refund_initiated` | A refund was initiated |
| `refund_approved` | A refund was approved |
| `refund_rejected` | A refund was rejected |
| `refund_executed` | A refund was executed (funds transferred) |
| `multisig_initiated` | A multisig payment was initiated |
| `multisig_signed` | A signer signed a multisig payment |
| `multisig_executed` | A multisig payment was executed |
| `webhook_test` | A synthetic test event sent via `POST /webhooks/test` |

### `data` payload schema

The `data` object only contains the fields explicitly allowlisted for each event type:

| `event` | Allowlisted `data` fields |
|---|---|
| `payment_processed` | `paymentId`, `amount`, `merchant` |
| `refund_initiated` | `refundId`, `paymentId`, `amount`, `merchant` |
| `refund_approved` | `refundId`, `paymentId`, `approver` |
| `refund_rejected` | `refundId`, `paymentId`, `approver`, `reason` |
| `refund_executed` | `refundId`, `paymentId`, `amount`, `merchant` |
| `multisig_initiated` | `paymentId`, `amount`, `merchant`, `signers` |
| `multisig_signed` | `paymentId`, `signer` |
| `multisig_executed` | `paymentId`, `amount`, `merchant` |

> **Note:** Any other fields present on the raw Soroban event are stripped before delivery and are never forwarded to merchants. Unknown event types receive an empty `data` object (`{}`).

---

## Retry Logic

Failed deliveries are retried with exponential backoff:

| Attempt | Delay |
|---|---|
| 1 | immediate |
| 2 | 1 s |
| 3 | 2 s |
| 4 | 4 s |
| 5 | 8 s |

After 5 failed attempts the delivery is dropped and the error is logged.
