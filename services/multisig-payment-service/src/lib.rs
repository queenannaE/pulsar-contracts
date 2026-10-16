/// Off-chain multisig payment service with on-chain quorum validation.
///
/// # Problem
///
/// The previous implementation tracked signatures locally but never
/// cross-validated against the on-chain contract state.  A mismatch between
/// the local signer list and what the contract recorded (e.g. due to a
/// direct on-chain `sign_multisig_payment` call bypassing this service)
/// would cause `execute_multisig_payment` to fail or, worse, to execute
/// with an incorrect quorum belief.
///
/// # Solution
///
/// 1. **[`OnChainClient`]** trait — abstraction over the Stellar RPC / SDK
///    call that queries the on-chain multisig state.  The default
///    [`NoOpOnChainClient`] is used in tests; production code should provide
///    a real implementation backed by `soroban-client` or `stellar-sdk`.
///
/// 2. **Pre-execution quorum check** — [`MultisigService::execute_multisig_payment`]
///    now calls `on_chain_client.get_multisig_state(payment_id)` and
///    reconciles the local signer list with the on-chain list before deciding
///    whether to proceed.
///
/// 3. **[`MultisigService::reconcile`]** — manually trigger reconciliation
///    for one or all payments; surfaces [`ReconcileReport`] with any
///    discrepancies found.  Wire to a `POST /reconcile/:payment_id` or
///    `POST /reconcile` HTTP endpoint.
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use thiserror::Error;

// ─── Errors ───────────────────────────────────────────────────────────────────

#[derive(Debug, Error, PartialEq, Eq)]
pub enum MultisigServiceError {
    #[error("validation failed: {0}")]
    Validation(String),
    #[error("payment not found")]
    PaymentNotFound,
    #[error("multisig payment already exists")]
    DuplicateMultisig,
    #[error("not authorized")]
    Unauthorized,
    #[error("payment already executed")]
    AlreadyExecuted,
    #[error("multisig payment expired")]
    Expired,
    #[error("insufficient signatures: have {have}, need {need}")]
    InsufficientSignatures { have: usize, need: usize },
    #[error("invalid input")]
    InvalidInput,
    /// Returned when the local signer set diverges from on-chain state.
    /// The caller should reconcile before re-trying execution.
    #[error(
        "quorum divergence detected for payment {payment_id}: \
         local has {local_count} signatures, on-chain has {on_chain_count}; \
         call reconcile() to synchronise"
    )]
    QuorumDivergence {
        payment_id: String,
        local_count: usize,
        on_chain_count: usize,
    },
    #[error("on-chain query failed: {0}")]
    OnChainQueryFailed(String),
    #[error("internal error")]
    Internal,
}

pub type Result<T> = std::result::Result<T, MultisigServiceError>;

// ─── Domain types ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PaymentOrder {
    pub order_id: String,
    pub merchant_address: String,
    pub payer_address: String,
    pub token_address: String,
    pub amount: i128,
    pub description: String,
    pub expires_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MultisigPayment {
    pub payment_id: String,
    pub order: PaymentOrder,
    pub required_signers: Vec<String>,
    pub signatures: Vec<String>,
    pub executed: bool,
    pub expires_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum MultisigEvent {
    Initiated { payment_id: String },
    Signed { payment_id: String, signer: String },
    Rejected { payment_id: String, signer: String },
    Executed { payment_id: String },
    Cancelled { payment_id: String },
    Reconciled { payment_id: String, added: Vec<String>, removed: Vec<String> },
}

// ─── On-chain state snapshot ──────────────────────────────────────────────────

/// What the on-chain contract records for a multisig payment.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OnChainMultisigState {
    pub payment_id: String,
    pub required_signers: Vec<String>,
    /// Addresses that have already signed on-chain.
    pub signatures: Vec<String>,
    pub executed: bool,
}

// ─── On-chain client trait ────────────────────────────────────────────────────

/// Abstraction over Stellar RPC / SDK for querying on-chain multisig state.
///
/// In production, implement this trait with a real `soroban-client` or
/// `stellar-sdk` call that invokes `get_multisig_payment` on the contract.
/// In tests, use [`NoOpOnChainClient`] or a custom mock.
pub trait OnChainClient: Send + Sync {
    /// Query on-chain state for `payment_id`.
    ///
    /// Returns `Ok(None)` if the payment does not exist on-chain yet.
    /// Returns `Err` if the RPC call itself fails.
    fn get_multisig_state(
        &self,
        payment_id: &str,
    ) -> Result<Option<OnChainMultisigState>>;
}

// ─── No-op client (for tests / offline mode) ──────────────────────────────────

/// Always returns `Ok(None)` — used when no RPC endpoint is available.
///
/// With this client the service behaves like the original implementation:
/// no cross-validation is performed.  Replace with a real implementation
/// in production.
pub struct NoOpOnChainClient;

impl OnChainClient for NoOpOnChainClient {
    fn get_multisig_state(&self, _payment_id: &str) -> Result<Option<OnChainMultisigState>> {
        Ok(None)
    }
}

// ─── Reconcile report ─────────────────────────────────────────────────────────

/// Result of a reconciliation pass for a single payment.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReconcileReport {
    pub payment_id: String,
    /// Signatures present on-chain but absent locally (merged into local).
    pub added_locally: Vec<String>,
    /// Signatures present locally but absent on-chain (removed from local).
    pub removed_locally: Vec<String>,
    /// True if local and on-chain state were already in sync.
    pub was_in_sync: bool,
}

// ─── Service ──────────────────────────────────────────────────────────────────

pub struct MultisigService<C: OnChainClient = NoOpOnChainClient> {
    payments: HashMap<String, MultisigPayment>,
    events: Vec<MultisigEvent>,
    on_chain_client: C,
}

impl MultisigService<NoOpOnChainClient> {
    /// Create a service with no on-chain validation (default / test mode).
    pub fn new() -> Self {
        MultisigService {
            payments: HashMap::new(),
            events: Vec::new(),
            on_chain_client: NoOpOnChainClient,
        }
    }
}

impl Default for MultisigService<NoOpOnChainClient> {
    fn default() -> Self {
        Self::new()
    }
}

impl<C: OnChainClient> MultisigService<C> {
    /// Create a service with a real (or mock) on-chain client.
    pub fn with_client(client: C) -> Self {
        MultisigService {
            payments: HashMap::new(),
            events: Vec::new(),
            on_chain_client: client,
        }
    }

    // ── Initiate ────────────────────────────────────────────────────────────

    pub fn initiate_multisig_payment(
        &mut self,
        _initiator: String,
        payment_id: String,
        order: PaymentOrder,
        required_signers: Vec<String>,
        timeout_seconds: u64,
    ) -> Result<&MultisigPayment> {
        if required_signers.is_empty() || required_signers.len() > 10 {
            return Err(MultisigServiceError::InvalidInput);
        }
        if self.payments.contains_key(&payment_id) {
            return Err(MultisigServiceError::DuplicateMultisig);
        }

        let mut unique_signers: Vec<String> = Vec::new();
        for signer in &required_signers {
            if unique_signers.contains(signer) {
                return Err(MultisigServiceError::InvalidInput);
            }
            unique_signers.push(signer.clone());
        }

        let now = Utc::now();
        let payment = MultisigPayment {
            payment_id: payment_id.clone(),
            order,
            required_signers: unique_signers,
            signatures: Vec::new(),
            executed: false,
            expires_at: now + chrono::Duration::seconds(timeout_seconds as i64),
            created_at: now,
        };

        self.payments.insert(payment_id.clone(), payment);
        self.events.push(MultisigEvent::Initiated { payment_id: payment_id.clone() });
        Ok(self.payments.get(&payment_id).unwrap())
    }

    // ── Sign ────────────────────────────────────────────────────────────────

    pub fn sign_multisig_payment(
        &mut self,
        signer: String,
        payment_id: &str,
    ) -> Result<&MultisigPayment> {
        let payment = self
            .payments
            .get_mut(payment_id)
            .ok_or(MultisigServiceError::PaymentNotFound)?;

        if payment.executed {
            return Err(MultisigServiceError::AlreadyExecuted);
        }
        if Utc::now() > payment.expires_at {
            return Err(MultisigServiceError::Expired);
        }
        if !payment.required_signers.contains(&signer) {
            return Err(MultisigServiceError::Unauthorized);
        }
        if payment.signatures.contains(&signer) {
            return Err(MultisigServiceError::InvalidInput);
        }

        payment.signatures.push(signer.clone());
        self.events.push(MultisigEvent::Signed {
            payment_id: payment_id.to_string(),
            signer,
        });
        Ok(payment)
    }

    // ── Execute (with on-chain quorum check) ────────────────────────────────

    /// Execute a multisig payment.
    ///
    /// Before executing, queries the on-chain contract to confirm that all
    /// required signatures are recorded there.  If the on-chain state is
    /// available but diverges from the local state, the method:
    ///
    /// 1. Returns [`MultisigServiceError::QuorumDivergence`] — the caller
    ///    must call [`reconcile`] to merge local and on-chain state, then
    ///    retry.
    ///
    /// If the on-chain client returns `Ok(None)` (payment not yet on-chain or
    /// no client configured) the check is skipped and only local state is
    /// used — consistent with the original behaviour.
    ///
    /// [`reconcile`]: MultisigService::reconcile
    pub fn execute_multisig_payment(
        &mut self,
        _executor: String,
        payment_id: &str,
    ) -> Result<&MultisigPayment> {
        let payment = self
            .payments
            .get(payment_id)
            .ok_or(MultisigServiceError::PaymentNotFound)?;

        if payment.executed {
            return Err(MultisigServiceError::AlreadyExecuted);
        }
        if Utc::now() > payment.expires_at {
            return Err(MultisigServiceError::Expired);
        }

        // ── On-chain quorum validation ──────────────────────────────────────
        let on_chain = self
            .on_chain_client
            .get_multisig_state(payment_id)
            .map_err(|e| MultisigServiceError::OnChainQueryFailed(e.to_string()))?;

        if let Some(chain_state) = on_chain {
            // Check for divergence between local signatures and on-chain signatures.
            let local_sigs: std::collections::HashSet<&String> =
                payment.signatures.iter().collect();
            let chain_sigs: std::collections::HashSet<&String> =
                chain_state.signatures.iter().collect();

            if local_sigs != chain_sigs {
                return Err(MultisigServiceError::QuorumDivergence {
                    payment_id: payment_id.to_string(),
                    local_count: local_sigs.len(),
                    on_chain_count: chain_sigs.len(),
                });
            }

            // Confirm all required signers have signed on-chain.
            let all_signed = payment
                .required_signers
                .iter()
                .all(|s| chain_state.signatures.contains(s));
            if !all_signed {
                return Err(MultisigServiceError::InsufficientSignatures {
                    have: chain_state.signatures.len(),
                    need: payment.required_signers.len(),
                });
            }
        } else {
            // No on-chain state available — fall back to local check.
            let local_have = payment.signatures.len();
            let need = payment.required_signers.len();
            if local_have < need {
                return Err(MultisigServiceError::InsufficientSignatures {
                    have: local_have,
                    need,
                });
            }
        }

        // ── Execute ─────────────────────────────────────────────────────────
        let payment = self.payments.get_mut(payment_id).unwrap();
        payment.executed = true;
        self.events
            .push(MultisigEvent::Executed { payment_id: payment_id.to_string() });
        Ok(payment)
    }

    // ── Reconcile ───────────────────────────────────────────────────────────

    /// Reconcile local signer state against on-chain state for `payment_id`.
    ///
    /// - Signatures recorded on-chain but missing locally are **added**.
    /// - Signatures recorded locally but absent on-chain are **removed**
    ///   (they may have been submitted directly on-chain and then rejected,
    ///   or are simply ahead of the on-chain state due to latency).
    ///
    /// Returns a [`ReconcileReport`] describing what changed.
    ///
    /// Wire this to a `POST /reconcile/:payment_id` HTTP endpoint.
    pub fn reconcile(&mut self, payment_id: &str) -> Result<ReconcileReport> {
        if !self.payments.contains_key(payment_id) {
            return Err(MultisigServiceError::PaymentNotFound);
        }

        let on_chain = self
            .on_chain_client
            .get_multisig_state(payment_id)
            .map_err(|e| MultisigServiceError::OnChainQueryFailed(e.to_string()))?;

        let Some(chain_state) = on_chain else {
            // Nothing to reconcile — on-chain state is not available yet.
            return Ok(ReconcileReport {
                payment_id: payment_id.to_string(),
                added_locally: vec![],
                removed_locally: vec![],
                was_in_sync: true,
            });
        };

        let payment = self.payments.get(payment_id).unwrap();
        let local_set: std::collections::HashSet<String> =
            payment.signatures.iter().cloned().collect();
        let chain_set: std::collections::HashSet<String> =
            chain_state.signatures.iter().cloned().collect();

        let added_locally: Vec<String> = chain_set.difference(&local_set).cloned().collect();
        let removed_locally: Vec<String> = local_set.difference(&chain_set).cloned().collect();

        let was_in_sync = added_locally.is_empty() && removed_locally.is_empty();

        if !was_in_sync {
            let payment = self.payments.get_mut(payment_id).unwrap();
            // Add on-chain signatures that are missing locally
            for sig in &added_locally {
                if !payment.signatures.contains(sig) {
                    payment.signatures.push(sig.clone());
                }
            }
            // Remove local signatures not present on-chain
            payment.signatures.retain(|s| !removed_locally.contains(s));

            self.events.push(MultisigEvent::Reconciled {
                payment_id: payment_id.to_string(),
                added: added_locally.clone(),
                removed: removed_locally.clone(),
            });
        }

        Ok(ReconcileReport {
            payment_id: payment_id.to_string(),
            added_locally,
            removed_locally,
            was_in_sync,
        })
    }

    /// Reconcile **all** non-executed payments.
    ///
    /// Wire to a `POST /reconcile` HTTP endpoint for bulk reconciliation.
    pub fn reconcile_all(&mut self) -> Result<Vec<ReconcileReport>> {
        let ids: Vec<String> = self
            .payments
            .keys()
            .filter(|id| {
                self.payments
                    .get(*id)
                    .map(|p| !p.executed)
                    .unwrap_or(false)
            })
            .cloned()
            .collect();

        let mut reports = Vec::new();
        for id in ids {
            reports.push(self.reconcile(&id)?);
        }
        Ok(reports)
    }

    // ── Cancel ──────────────────────────────────────────────────────────────

    pub fn cancel_multisig_payment(
        &mut self,
        initiator: String,
        payment_id: &str,
    ) -> Result<&MultisigPayment> {
        let payment = self
            .payments
            .get_mut(payment_id)
            .ok_or(MultisigServiceError::PaymentNotFound)?;

        if payment.order.payer_address != initiator {
            return Err(MultisigServiceError::Unauthorized);
        }
        if payment.executed {
            return Err(MultisigServiceError::AlreadyExecuted);
        }

        payment.executed = true;
        self.events
            .push(MultisigEvent::Cancelled { payment_id: payment_id.to_string() });
        Ok(payment)
    }

    // ── Queries ─────────────────────────────────────────────────────────────

    pub fn get_multisig_payment(&self, payment_id: &str) -> Option<&MultisigPayment> {
        self.payments.get(payment_id)
    }

    pub fn get_events(&self) -> &[MultisigEvent] {
        &self.events
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_order() -> PaymentOrder {
        PaymentOrder {
            order_id:         "MS_001".into(),
            merchant_address: "MERCHANT_001".into(),
            payer_address:    "PAYER_001".into(),
            token_address:    "TOKEN_001".into(),
            amount:           1000,
            description:      "Multisig payment".into(),
            expires_at:       None,
        }
    }

    fn initiate(svc: &mut MultisigService, id: &str, signers: Vec<&str>) {
        svc.initiate_multisig_payment(
            "PAYER_001".into(),
            id.into(),
            sample_order(),
            signers.into_iter().map(String::from).collect(),
            3600,
        )
        .unwrap();
    }

    // ── Original behaviour ──────────────────────────────────────────────────

    #[test]
    fn initiate_multisig_payment_success() {
        let mut svc = MultisigService::new();
        let payment = svc
            .initiate_multisig_payment(
                "PAYER_001".into(),
                "MS_001".into(),
                sample_order(),
                vec!["SIGNER_1".into(), "SIGNER_2".into()],
                3600,
            )
            .unwrap();

        assert_eq!(payment.required_signers.len(), 2);
        assert!(!payment.executed);
    }

    #[test]
    fn sign_multisig_payment_and_execute_no_client() {
        // With NoOpOnChainClient the service falls back to local-only check.
        let mut svc = MultisigService::new();
        initiate(&mut svc, "MS_002", vec!["SIGNER_1", "SIGNER_2"]);
        svc.sign_multisig_payment("SIGNER_1".into(), "MS_002").unwrap();
        svc.sign_multisig_payment("SIGNER_2".into(), "MS_002").unwrap();
        let payment = svc.execute_multisig_payment("SIGNER_1".into(), "MS_002").unwrap();
        assert!(payment.executed);
        assert_eq!(svc.get_events().len(), 4); // Initiated + 2×Signed + Executed
    }

    // ── Quorum divergence ───────────────────────────────────────────────────

    /// A mock client that always returns a fixed on-chain state.
    struct MockClient {
        state: Option<OnChainMultisigState>,
    }

    impl OnChainClient for MockClient {
        fn get_multisig_state(
            &self,
            _payment_id: &str,
        ) -> Result<Option<OnChainMultisigState>> {
            Ok(self.state.clone())
        }
    }

    #[test]
    fn execute_fails_on_quorum_divergence() {
        // On-chain: only SIGNER_1 has signed.  Local: both SIGNER_1 and SIGNER_2.
        let client = MockClient {
            state: Some(OnChainMultisigState {
                payment_id:       "MS_003".into(),
                required_signers: vec!["SIGNER_1".into(), "SIGNER_2".into()],
                signatures:       vec!["SIGNER_1".into()], // only one on-chain
                executed:         false,
            }),
        };
        let mut svc = MultisigService::with_client(client);
        initiate(&mut svc, "MS_003", vec!["SIGNER_1", "SIGNER_2"]);
        svc.sign_multisig_payment("SIGNER_1".into(), "MS_003").unwrap();
        svc.sign_multisig_payment("SIGNER_2".into(), "MS_003").unwrap();

        let err = svc
            .execute_multisig_payment("SIGNER_1".into(), "MS_003")
            .unwrap_err();

        assert!(
            matches!(
                err,
                MultisigServiceError::QuorumDivergence {
                    local_count: 2,
                    on_chain_count: 1,
                    ..
                }
            ),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn execute_succeeds_when_on_chain_matches_local() {
        // Both local and on-chain agree: SIGNER_1 and SIGNER_2 signed.
        let client = MockClient {
            state: Some(OnChainMultisigState {
                payment_id:       "MS_004".into(),
                required_signers: vec!["SIGNER_1".into(), "SIGNER_2".into()],
                signatures:       vec!["SIGNER_1".into(), "SIGNER_2".into()],
                executed:         false,
            }),
        };
        let mut svc = MultisigService::with_client(client);
        initiate(&mut svc, "MS_004", vec!["SIGNER_1", "SIGNER_2"]);
        svc.sign_multisig_payment("SIGNER_1".into(), "MS_004").unwrap();
        svc.sign_multisig_payment("SIGNER_2".into(), "MS_004").unwrap();

        let payment = svc
            .execute_multisig_payment("SIGNER_1".into(), "MS_004")
            .unwrap();
        assert!(payment.executed);
    }

    // ── Reconcile ───────────────────────────────────────────────────────────

    #[test]
    fn reconcile_adds_missing_on_chain_signatures() {
        // On-chain: SIGNER_1 + SIGNER_2.  Local: only SIGNER_1.
        let client = MockClient {
            state: Some(OnChainMultisigState {
                payment_id:       "MS_005".into(),
                required_signers: vec!["SIGNER_1".into(), "SIGNER_2".into()],
                signatures:       vec!["SIGNER_1".into(), "SIGNER_2".into()],
                executed:         false,
            }),
        };
        let mut svc = MultisigService::with_client(client);
        initiate(&mut svc, "MS_005", vec!["SIGNER_1", "SIGNER_2"]);
        svc.sign_multisig_payment("SIGNER_1".into(), "MS_005").unwrap();

        let report = svc.reconcile("MS_005").unwrap();

        assert!(!report.was_in_sync);
        assert!(report.added_locally.contains(&"SIGNER_2".to_string()));
        assert!(report.removed_locally.is_empty());

        // After reconcile, execute should succeed.
        let payment = svc
            .execute_multisig_payment("SIGNER_1".into(), "MS_005")
            .unwrap();
        assert!(payment.executed);
    }

    #[test]
    fn reconcile_removes_stale_local_signatures() {
        // Local has SIGNER_1 + SIGNER_2, on-chain only SIGNER_1.
        let client = MockClient {
            state: Some(OnChainMultisigState {
                payment_id:       "MS_006".into(),
                required_signers: vec!["SIGNER_1".into(), "SIGNER_2".into()],
                signatures:       vec!["SIGNER_1".into()],
                executed:         false,
            }),
        };
        let mut svc = MultisigService::with_client(client);
        initiate(&mut svc, "MS_006", vec!["SIGNER_1", "SIGNER_2"]);
        svc.sign_multisig_payment("SIGNER_1".into(), "MS_006").unwrap();
        svc.sign_multisig_payment("SIGNER_2".into(), "MS_006").unwrap();

        let report = svc.reconcile("MS_006").unwrap();

        assert!(!report.was_in_sync);
        assert!(report.removed_locally.contains(&"SIGNER_2".to_string()));

        let payment = svc.get_multisig_payment("MS_006").unwrap();
        assert_eq!(payment.signatures, vec!["SIGNER_1"]);
    }

    #[test]
    fn reconcile_all_returns_report_for_each_pending_payment() {
        let client = MockClient { state: None }; // NoOp — in sync by definition
        let mut svc = MultisigService::with_client(client);
        initiate(&mut svc, "MS_007", vec!["SIGNER_1"]);
        initiate(&mut svc, "MS_008", vec!["SIGNER_2"]);

        let reports = svc.reconcile_all().unwrap();
        assert_eq!(reports.len(), 2);
        assert!(reports.iter().all(|r| r.was_in_sync));
    }

    #[test]
    fn reconcile_not_found_returns_error() {
        let mut svc = MultisigService::new();
        let err = svc.reconcile("DOES_NOT_EXIST").unwrap_err();
        assert_eq!(err, MultisigServiceError::PaymentNotFound);
    }
}
