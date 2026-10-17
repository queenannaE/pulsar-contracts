# Reproducible Builds

Pulsar smart contracts are deployed on Stellar Soroban and must produce
byte-identical WASM artifacts across every environment. This document explains
how the project achieves that.

## Why reproducibility matters for smart contracts

A deployed contract is identified by the SHA-256 hash of its WASM bytecode.
If two builds of the same source tree produce different binaries — because
different dependency versions were resolved — the hash will differ, breaking
verification and auditability.

## Cargo.lock is committed

`Cargo.lock` is tracked in git (see `.gitignore`). This is the recommended
practice for any deployable Rust artefact, including smart contracts.

Benefits:
- Every developer and every CI run builds against the exact same dependency
  tree.
- Security audits (e.g. `cargo audit`) operate on the precise dependency
  versions in use, not a superset of possible versions.
- Dependency upgrades are explicit, reviewed changes, not silent surprises.

## `--locked` in CI

All `cargo build`, `cargo test`, `cargo clippy`, and `cargo llvm-cov`
invocations in CI pass `--locked`. This causes Cargo to refuse to update
`Cargo.lock` and fail instead, catching any case where the lock file has
drifted from `Cargo.toml`.

```
cargo build --target wasm32-unknown-unknown --release --locked
cargo test  --all-features --locked
cargo clippy --all-targets --all-features --locked -- -D warnings
```

Note: `cargo fmt` and `cargo audit` do not accept `--locked`; `fmt` operates
on source files only and `audit` reads the lock file directly.

## Updating dependencies

To update a dependency:

1. Run `cargo update -p <crate>` (or `cargo update` to update all).
2. Review the diff in `Cargo.lock` — check for unexpected transitive changes.
3. Run the full test suite locally (`cargo test --locked`).
4. Commit the updated `Cargo.lock` together with any `Cargo.toml` changes.

## Related issues

- [DO-001](https://github.com/queenannaE/pulsar-contracts/issues/56) — `Cargo.lock` is not committed — builds are not reproducible
