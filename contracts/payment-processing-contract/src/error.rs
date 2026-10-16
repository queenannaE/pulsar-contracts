// SPDX-License-Identifier: MIT

use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum PaymentError {
    // Auth
    Unauthorized = 1,
    AdminAlreadySet = 2,

    // Merchant
    MerchantNotFound = 10,
    MerchantAlreadyRegistered = 11,
    MerchantInactive = 12,

    // Payment
    PaymentNotFound = 20,
    PaymentAlreadyExists = 21,
    InvalidAmount = 22,
    InvalidSignature = 23,
    PaymentExpired = 24,

    // Refund
    RefundNotFound = 30,
    RefundAlreadyExists = 31,
    RefundWindowExpired = 32,
    RefundAmountExceedsPayment = 33,
    RefundNotApproved = 34,
    RefundAlreadyCompleted = 35,
    /// Refund must be in Rejected state to be disputed.
    RefundNotRejected = 36,
    /// Dispute can only be raised by the original payer.
    DisputeUnauthorized = 37,
    /// Refund is not in Disputed state; cannot resolve.
    RefundNotDisputed = 38,

    // Multisig
    MultisigNotFound = 40,
    MultisigAlreadySigned = 41,
    MultisigAlreadyExecuted = 42,
    InsufficientSignatures = 43,

    // General
    InvalidInput = 50,
    // StorageError = 51 was removed: the variant was never returned by any
    // code path and only inflated the ABI. See issue SC-009.
    ArithmeticError = 52,

    // Subscription
    /// Subscription ID not found in storage.
    SubscriptionNotFound = 60,
    /// A subscription with this ID already exists.
    SubscriptionAlreadyExists = 61,
    /// Subscription is not in Active state (e.g. already cancelled).
    SubscriptionNotActive = 62,
    /// Payment interval has not elapsed since the last charge.
    /// The off-chain scheduler must wait until `last_charged_at + interval`
    /// before invoking `process_subscription_payment` again.
    SubscriptionIntervalNotElapsed = 63,
}
