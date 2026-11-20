# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | ✅        |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

There are two supported reporting channels. The GitHub private security
advisory system is preferred because it provides a structured, auditable
workflow; email is available as a fallback for reporters who cannot use it.

### 1. GitHub private security advisory (preferred)

👉 **[Report a vulnerability](https://github.com/queenannaE/pulsar-contracts/security/advisories/new)**

This opens a private advisory on the `queenannaE/pulsar-contracts`
repository. Only the repository maintainers can see your report.

### 2. Email the maintainers directly

Send your report to **euniceoyiefieo@gmail.com** with the subject line
`[SECURITY] Pulsar — <short summary>`. Please encrypt sensitive details
with the maintainer's PGP key if you have it; otherwise plain email is fine.

### What to include

- A clear description of the vulnerability and its potential impact
- Steps to reproduce or a proof-of-concept
- Affected versions
- Any suggested mitigations (optional)

### Response SLA

| Milestone | Target |
|-----------|--------|
| Acknowledgement | Within **48 hours** of submission |
| Initial assessment | Within **5 business days** |
| Fix or mitigation | Within **90 days** (critical issues prioritised) |

We will keep you informed of progress throughout the process and credit you in the release notes unless you prefer to remain anonymous.

### Coordinated disclosure

We follow a coordinated disclosure model. Reporters are asked to give
maintainers a reasonable window (default 90 days, or until a fix is shipped —
whichever comes first) before publicly disclosing the issue. We will not
take action against good-faith security research that respects this window.

## Rewards

Pulsar does not currently operate a funded bug bounty or responsible-disclosure
reward program. Reports submitted under this policy are therefore not eligible
for a guaranteed monetary payment.

With the reporter's consent, we may recognize valid reports through:

- acknowledgement in the release notes;
- inclusion in a future security Hall of Fame; and
- credit in the relevant security advisory or fix announcement.

After mainnet launch, the maintainers may evaluate listing Pulsar on a bug
bounty platform such as HackerOne or Immunefi. Any active listing, funding,
eligibility rules, and payment terms will be linked from this section before
they apply. Until then, do not assume that a report carries a monetary reward.

### Scope of any future bounty program

The current disclosure and recognition scope is limited to vulnerabilities in
the smart contract code maintained in this repository. Off-chain services,
infrastructure, SDKs, documentation, and third-party dependencies are not in
scope unless a future program explicitly includes them. Issues in third-party
dependencies should be reported to their respective maintainers.

## Scope

This policy covers the smart contract code in this repository. Issues in third-party dependencies (e.g. `soroban-sdk`) should be reported to their respective maintainers.

---

## Mainnet Security Audit (SEC-001)

The Pulsar contract handles real token transfers. **An independent security audit by a recognised Soroban/Stellar smart contract auditor is required before any mainnet deployment.**

All Critical and High severity findings must be resolved before deployment. The full audit report will be published in [`docs/security-audit.md`](docs/security-audit.md) once completed.

See [`docs/security-audit.md`](docs/security-audit.md) for the full audit scope, recommended auditors, pre-audit checklist, and deployment gate criteria.
