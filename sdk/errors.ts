// AUTO-GENERATED — do not edit by hand.
// Run `node sdk/scripts/generate-errors.js` to regenerate from error-registry.json.

export enum PulsarErrorCode {
  Unauthorized               = 1,
  AdminAlreadySet            = 2,
  MerchantNotFound           = 10,
  MerchantAlreadyRegistered  = 11,
  MerchantInactive           = 12,
  PaymentNotFound            = 20,
  PaymentAlreadyExists       = 21,
  InvalidAmount              = 22,
  InvalidSignature           = 23,
  PaymentExpired             = 24,
  InsufficientBalance        = 25,
  RefundNotFound             = 30,
  RefundAlreadyExists        = 31,
  RefundWindowExpired        = 32,
  RefundAmountExceedsPayment = 33,
  RefundNotApproved          = 34,
  RefundAlreadyCompleted     = 35,
  MultisigNotFound           = 40,
  MultisigAlreadySigned      = 41,
  MultisigAlreadyExecuted    = 42,
  InsufficientSignatures     = 43,
  InvalidInput               = 50,
  StorageError               = 51,
  ArithmeticError            = 52,
}

const registry: Record<number, string> = {
  1: "Caller lacks permission to perform this action",
  2: "Admin has already been initialised",
  10: "Merchant is not registered",
  11: "A merchant with this address is already registered",
  12: "Merchant account is deactivated",
  20: "Order ID not found",
  21: "A payment with this order ID already exists",
  22: "Amount must be greater than zero",
  23: "Signature verification failed",
  24: "Order is past its expiry timestamp",
  25: "Payer or merchant does not have enough token balance to complete the transfer",
  30: "Refund ID not found",
  31: "A refund with this ID already exists",
  32: "The 30-day refund window has passed",
  33: "Cumulative refund amount exceeds the original payment",
  34: "Refund is not in Approved state",
  35: "Refund has already been completed or rejected",
  40: "Multisig payment not found",
  41: "This signer has already signed the multisig payment",
  42: "Multisig payment has already been executed",
  43: "Not all required signers have signed",
  50: "General input validation failure",
  51: "Storage operation failed",
  52: "Arithmetic overflow or underflow",
};

/** Map a numeric contract error code to a human-readable message. */
export function getErrorMessage(code: number): string {
  return registry[code] ?? `Unknown contract error (code ${code})`;
}
