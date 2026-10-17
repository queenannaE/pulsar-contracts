# ADR-0006: Cap Merchant/Payer Payment-ID Index at 10,000 Entries (SC-013)

**Status:** Accepted  
**Date:** 2024-10-17  
**Deciders:** Pulsar Contributors  
**Issue:** [SC-013](https://github.com/queenannaE/pulsar-contracts/issues/13)

---

## Context

`push_merchant_payment_id` and `push_payer_payment_id` append a payment `order_id`
to a `Vec<Bytes>` stored under a single persistent Soroban storage key
(`MerchantPayments(Address)` / `PayerPayments(Address)`). Because every payment
write reads the whole vector, re-serialises it, and writes it back, the cost of
each payment grows linearly with the number of prior payments for that entity:

```
cost per payment ≈ O(n_merchant) + O(n_payer) storage read/write
```

Two concrete risks arise as the vector grows:

1. **Ledger entry size limit** — Soroban imposes a per-entry size limit on
   persistent storage values. A `Vec<Bytes>` storing `order_id` values of up to
   64 bytes each will exceed the limit before 100,000 entries.
2. **Transaction cost inflation** — reading and re-writing a large vector
   consumes a proportionally large amount of the per-transaction CPU and storage
   budget, making payments progressively more expensive and eventually
   infeasible.

---

## Decision

Cap the in-contract per-entity payment-ID index at **10,000 entries**
(`MAX_PAYMENT_IDS_PER_KEY = 10_000`). When the cap is reached, the oldest entry
is evicted from the index (FIFO eviction). The underlying `PaymentRecord` stored
under `DataKey::Payment(order_id)` is **not** deleted; it remains in persistent
storage and is still fully queryable by `order_id`.

Alternatives that were considered are documented below.

---

## Alternatives Considered

### Option A — Chunked / linked-list index (rejected for now)

Split the flat `Vec<Bytes>` into fixed-size chunks linked by a head pointer, e.g.
`MerchantPaymentsChunk(merchant, chunk_id)`. Each chunk holds at most `CHUNK_SIZE`
IDs; when a chunk is full a new one is created.

**Pros:**
- Each write only touches the current (tail) chunk — O(1) write cost.
- No entries are ever evicted; the full history remains in-index.
- Scales to millions of entries without hitting single-entry size limits.

**Cons:**
- Significantly increases contract complexity (pointer management, scan-across-
  chunks logic for pagination).
- Reads for pagination must follow the chain, adding multiple storage round-trips.
- Migration path from the current flat-list layout is non-trivial.
- Estimated effort: **Large** (multi-sprint).

This option remains the recommended long-term architecture and is tracked as a
future improvement (see [Roadmap](#roadmap)).

### Option B — Off-chain index only (rejected)

Remove the in-contract index entirely. Rely on an off-chain event indexer
(already present at `indexer/`) to answer history queries.

**Pros:**
- Eliminates in-contract index growth entirely.
- Allows arbitrarily complex queries off-chain.

**Cons:**
- Breaks `get_merchant_payment_history` and `get_payer_payment_history` for
  callers that use the on-chain API directly (no indexer dependency).
- Represents a breaking ABI change requiring a major version bump.
- Off-chain indexers have their own availability and consistency concerns.

### Option C — Configurable cap (not chosen for initial implementation)

Make `MAX_PAYMENT_IDS_PER_KEY` an admin-configurable parameter rather than a
compile-time constant.

**Pros:** Allows the cap to be tuned without a contract upgrade.

**Cons:** Adds storage and governance overhead for a parameter that is unlikely
to need frequent changes. The cap can always be changed via a contract upgrade.

---

## Decision Rationale

Option A is the correct long-term solution, but its implementation complexity
is out of scope for the current sprint. Option B is a breaking change. A
compile-time cap (the current implementation) is the lowest-risk incremental
fix: it bounds ledger entry size, keeps the on-chain API functional, and does
not require a schema migration.

The cap value of **10,000** was chosen as a balance between:

- Keeping each index entry well within observed Soroban entry size limits
  (10,000 × 64-byte IDs ≈ 640 KB, which fits comfortably).
- Providing sufficient history for the large majority of merchants (most
  merchants will not process 10,000 payments before the indexer can take over).

---

## Storage Cost Benchmarks

Estimates assume `order_id` values of 64 bytes each (worst-case), plus Soroban
XDR vector framing overhead (≈16 bytes per entry).

| Index size | Raw bytes (approx.) | Notes |
|---|---|---|
| 1,000 entries | ~80 KB | Well within limits; O(ms) read/write |
| 10,000 entries (cap) | ~800 KB | Near the typical Soroban entry size limit |
| 100,000 entries | ~8 MB | Exceeds Soroban entry limits; contract would panic |

> These are planning estimates. Actual limits depend on Soroban network
> parameters at deployment time. Verify against the current network RPC before
> deployment.

---

## Consequences

### Positive
- Bounds ledger entry size and per-transaction cost regardless of merchant
  activity level.
- Prevents a denial-of-service vector where an attacker drives up payment costs
  for a target merchant by flooding their index.
- The full payment record remains queryable by `order_id`; only the paginated
  index is capped.

### Negative
- **FIFO eviction:** merchants with more than 10,000 payments will see their
  oldest payment IDs disappear from `get_merchant_payment_history` pagination.
  The records themselves are still accessible via `get_payment_by_id`.
- Integrators that rely solely on on-chain pagination for complete history must
  either use the off-chain indexer or call `get_payment_by_id` directly.
- The cap cannot be raised without a contract upgrade (see Option C above).

### Neutral
- The cap applies independently to the merchant index, the payer index, and the
  global index. A payment with both a merchant and a payer at the cap evicts
  one entry from each.

---

## Roadmap

The chunked/linked-list index (Option A) is the target long-term solution. It
will be designed and estimated in a future sprint. When implemented, it will
supersede this ADR.

---

## References

- `contracts/payment-processing-contract/src/storage.rs` — `MAX_PAYMENT_IDS_PER_KEY`, `push_merchant_payment_id`, `push_payer_payment_id`
- [ADR-0002: Per-Entity Storage Layout](./0002-storage-layout.md)
- [ADR-0003: Cursor-Based Pagination](./0003-pagination-design.md)
