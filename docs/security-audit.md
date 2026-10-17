# Security Audit — Pulsar Contracts

> **Status: PENDING** — An independent security audit must be completed before any mainnet deployment.

---

## Requirement (SEC-001)

The Pulsar payment-processing contract handles real token transfers on the Stellar network. Before any mainnet deployment, the contract must be reviewed by a recognised Soroban/Stellar smart contract security auditor.

---

## Audit Criteria

| Criterion | Requirement |
|---|---|
| Auditor | Recognised firm with Soroban/Stellar smart contract experience |
| Scope | All contract source files in `contracts/payment-processing-contract/src/` |
| Blocking findings | All **Critical** and **High** severity findings must be resolved before mainnet deployment |
| Report publication | Full audit report must be published in this repository under `docs/` |
| Re-audit | A re-audit or targeted review is required if Critical/High findings result in significant code changes |

---

## Scope of Audit

The following source files are in scope:

| File | Description |
|---|---|
| `src/lib.rs` | Contract entry-point and all public functions |
| `src/types.rs` | All data structures and storage keys |
| `src/storage.rs` | Storage read/write helpers and TTL management |
| `src/error.rs` | ContractError enum |
| `src/helper.rs` | Auth, validation, and filter helpers |

### Key areas of focus

- **Signature verification** — ed25519 signature scheme used in `process_payment_with_signature`
- **Authorization checks** — `require_auth` usage across all privileged functions
- **Refund logic** — 30-day window enforcement, cumulative refund cap, state machine transitions
- **Multi-signature payments** — signer deduplication, execution guards, state transitions
- **Storage and TTL** — persistent entry expiry, data integrity over time
- **Integer arithmetic** — overflow/underflow in amount calculations
- **Access control** — admin, merchant, and payer permission boundaries
- **Replay protection** — duplicate order ID and refund ID prevention

---

## Re-entrancy Model (SC-011)

Token transfers in `process_payment_with_signature` and `execute_refund` call external token contracts. The following two layers of defence prevent a malicious token contract from exploiting re-entrancy.

### Layer 1 — Checks-Effects-Interactions (CEI)

Both functions commit **all** state mutations (payment/refund records, index lists, statistics) to persistent storage **before** calling `token::Client::transfer`. This is the standard CEI pattern. If a re-entrant callback tries to invoke either function again with the same IDs, the idempotency checks (`PaymentAlreadyExists`, `RefundNotApproved`) will reject it immediately.

```
// process_payment_with_signature execution order:
1. Checks (validate inputs, check duplicates, verify signature)
2. Effects (save_payment, push indexes, increment_stats)  ← state committed
3. Interaction (token_client.transfer)                    ← external call last
```

```
// execute_refund execution order:
1. Checks (get refund, verify Approved status, verify caller)
2. Effects (save_payment, refund.status = Completed, save_refund, push index, inc stats)
3. Interaction (token_client.transfer)                    ← external call last
```

### Layer 2 — Soroban execution model

Soroban's VM enforces additional constraints that limit re-entrancy beyond CEI:

- **Single-use authorisation:** `require_auth()` consumes the caller's authorisation context for the current invocation. A re-entrant call from within the token contract would require a fresh, independent authorisation context — one that was not granted in the original transaction.
- **No in-transaction re-entry:** Soroban does not support re-entry into the same contract instance from within the same invocation stack under the same authorisation scope.

### Security sign-off

This analysis covers SC-011. A full independent security audit (SEC-001) is still required before mainnet deployment. The audit scope must include re-entrancy scenarios with malicious token contracts.

---

## Recommended Auditors

The following firms have demonstrated experience auditing Soroban/Stellar smart contracts or Rust-based blockchain code:

| Firm | Website | Notes |
|---|---|---|
| OtterSec | https://osec.io | Soroban and Rust smart contract audits |
| Trail of Bits | https://www.trailofbits.com | Rust and blockchain security specialists |
| Halborn | https://halborn.com | Stellar ecosystem experience |
| Cure53 | https://cure53.de | Rust and cryptographic code review |

> This list is informational. The project maintainers should conduct their own due diligence when selecting an auditor.

---

## Pre-Audit Checklist

Before engaging an auditor, ensure the following are complete:

- [ ] All known Critical and High issues from `ISSUES.md` are resolved
- [ ] Test coverage is at or above 80% (see T-015)
- [ ] `cargo audit` reports no unresolved advisories
- [ ] `cargo deny check` passes cleanly
- [ ] All public functions have inline documentation comments
- [ ] The contract ABI and storage layout are documented (see `docs/adr/`)

---

## Audit Process

1. **Engage auditor** — share contract source, documentation, and test suite
2. **Preliminary review** — auditor provides scope confirmation and timeline
3. **Audit execution** — typically 1–3 weeks depending on scope
4. **Draft report** — review findings, provide clarifications
5. **Remediation** — resolve all Critical and High findings; document mitigations for Medium/Low
6. **Final report** — auditor confirms fixes; final report issued
7. **Publication** — publish final report as `docs/audit-report-<version>-<auditor>.pdf` in this repository

---

## Deployment Gate

**Mainnet deployment is blocked until:**

1. A final audit report with no unresolved Critical or High findings exists in this repository
2. The report covers the exact commit hash being deployed
3. The project maintainer has signed off on all Medium findings

---

## Audit History

| Version | Auditor | Date | Report | Status |
|---|---|---|---|---|
| — | — | — | — | Pending |

*This table will be updated once an audit is completed.*
