# ADR-0006: Multi-Signature Admin Governance Model

**Status:** Accepted  
**Date:** 2026-10-16  
**Issue:** [SEC-006](https://github.com/queenannaE/pulsar-contracts/issues/51)

---

## Context

Prior to this change the contract stored a single admin address. Any function
that required admin privileges would accept exactly that one address. Compromise
of the admin private key was therefore catastrophic: an attacker would gain full
control over merchant deactivation, refund approval, payment archival, global
stats, and contract upgrade — with no recovery path.

---

## Decision

We implement an **N-of-M threshold multi-signature admin model**:

- `set_admin(admins, threshold)` — one-time initialisation. Registers up to M
  admin addresses and a required signing threshold N (1 ≤ N ≤ M).
- `update_admin_config(current_admins, new_admins, new_threshold)` — rotate the
  admin set. Requires the **current** threshold of admins to authorise the
  change, preventing a single compromised key from replacing the set.
- `require_multi_admin(admins)` — the internal enforcement function, called by
  every admin-gated operation. It counts how many addresses in the provided list
  are registered admins and have provided a valid on-chain authorization
  (`require_auth`). If the count meets or exceeds the stored threshold, the call
  proceeds; otherwise `Unauthorized` is returned.

### Storage

`AdminConfig { admins: Vec<Address>, threshold: u32 }` is stored in instance
storage under `DataKey::AdminConfig`. A legacy `DataKey::Admin` single-address
pointer is kept in sync with `admins[0]` for backwards-compatible read paths
that have not yet been migrated.

---

## Governance Model

### Threshold choices

| Threshold | Behaviour | Recommended for |
|-----------|-----------|-----------------|
| 1-of-M    | Any single admin can act | Development / testing only |
| 2-of-3    | Majority quorum with one spare key | Small teams |
| 3-of-5    | Majority quorum with two spare keys | Production deployments |

The contract does not enforce a minimum threshold greater than 1. Operators
**should** deploy with a threshold ≥ 2 in production.

### Key rotation

To rotate the admin key set:
1. Assemble `N` existing admin signers.
2. Call `update_admin_config(current_admins, new_admins, new_threshold)`.
3. The contract atomically replaces the admin list and threshold.
4. Old keys are no longer valid for admin operations.

### Recovery from key compromise

If fewer than `threshold` keys are compromised but the remaining `threshold`
honest keys are still available:
1. The remaining admins call `update_admin_config` to remove the compromised
   key(s) and optionally lower the threshold temporarily.
2. Re-issue new keys and restore the original threshold.

If `threshold` or more keys are compromised and no recovery quorum exists,
recovery requires a contract upgrade via an out-of-band governance process
(e.g., deploying a new contract and migrating state). This scenario is
analogous to a hardware wallet loss and is outside the scope of on-chain
governance.

---

## Consequences

### Positive
- Single key compromise no longer gives an attacker full admin control.
- Key rotation is possible without redeploying the contract.
- The threshold model is auditable on-chain (readable via `get_admin_config`).

### Negative / Trade-offs
- Admin operations require coordination between N key holders.
- If admin keys are lost below quorum, recovery requires a contract upgrade.
- The `upgrade` function still uses single-admin auth (`require_admin`) because
  a compromised upgrade path is a separate concern from day-to-day admin ops.
  Operators should use a hardware security module (HSM) for the upgrade key.

---

## Alternatives Considered

### Time-locked action queue
Operations are staged and only executed after a time delay (e.g., 48 h).
Rejected because:
- Adds significant complexity (queue storage, expiry, cancellation).
- Introduces latency for legitimate emergency operations (refund approvals,
  pausing the contract).
- The pause mechanism (SEC-010) already provides an emergency stop, which
  reduces the urgency of a time-lock on all admin operations.

### Off-chain multi-sig (Stellar account thresholds)
Use a Stellar multi-sig account as the admin address. Rejected because:
- Moves trust to the Stellar account layer, not the contract layer.
- Makes admin key rotation dependent on Stellar account operations rather
  than a single contract call.
- Less auditable from the contract's perspective.
