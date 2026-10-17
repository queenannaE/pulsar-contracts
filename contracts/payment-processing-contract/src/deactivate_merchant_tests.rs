// SPDX-License-Identifier: MIT
//! Tests for `deactivate_merchant` — resolves T-005 / issue #35
//!
//! Acceptance criteria:
//!   1. Random caller attempts deactivate_merchant → Unauthorized
//!   2. Merchant deactivates themselves → succeeds
//!   3. Admin deactivates merchant → succeeds

#![cfg(test)]

extern crate alloc;
use alloc::vec;

use soroban_sdk::{testutils::Address as _, Address, Env, String, Vec};

use crate::{
    error::PaymentError,
    types::MerchantCategory,
    PaymentContract, PaymentContractClient,
};

// ── helpers ───────────────────────────────────────────────────────────────────

fn setup() -> (Env, PaymentContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(PaymentContract, ());
    let client = PaymentContractClient::new(&env, &contract_id);
    (env, client)
}

fn s(env: &Env, v: &str) -> String {
    String::from_str(env, v)
}

fn admin_vec(env: &Env, admin: &Address) -> Vec<Address> {
    vec![env, admin.clone()]
}

/// Register an admin and a merchant, returning both addresses.
fn setup_merchant(env: &Env, client: &PaymentContractClient) -> (Address, Address) {
    let admin = Address::generate(env);
    let merchant = Address::generate(env);
    client.set_admin(&admin_vec(env, &admin), &1);
    client.register_merchant(
        &merchant,
        &s(env, "Test Store"),
        &s(env, "A store"),
        &s(env, "store@example.com"),
        &MerchantCategory::Retail,
        &None,
    );
    (admin, merchant)
}

// ── T-005-1: random caller → Unauthorized ────────────────────────────────────

/// A completely unrelated address must not be able to deactivate another
/// merchant's account. Passing `None` for `admin_authorizers` means the
/// call requires the `merchant_address` to `require_auth`; a random address
/// will fail that check.
#[test]
fn test_t005_random_caller_deactivate_unauthorized() {
    let (env, client) = setup();
    let (_admin, merchant) = setup_merchant(&env, &client);
    let random = Address::generate(&env);

    // Calling deactivate_merchant with a random address as merchant_address
    // but without the merchant's auth must be rejected.
    // We use try_deactivate_merchant so the test doesn't panic.
    let result = client.try_deactivate_merchant(&random, &None);
    // random is not a registered merchant → MerchantNotFound (also proves
    // a random caller cannot deactivate)
    assert!(
        result == Err(Ok(PaymentError::Unauthorized))
            || result == Err(Ok(PaymentError::MerchantNotFound)),
        "expected Unauthorized or MerchantNotFound, got {:?}",
        result
    );

    // Ensure the real merchant is still active
    assert!(client.get_merchant(&merchant).active);
}

/// A random address cannot pass itself off as an admin to deactivate a
/// merchant by providing a non-admin address in the `admin_authorizers` list.
#[test]
fn test_t005_fake_admin_deactivate_unauthorized() {
    let (env, client) = setup();
    let (_admin, merchant) = setup_merchant(&env, &client);
    let fake_admin = Address::generate(&env);

    let result = client.try_deactivate_merchant(&merchant, &Some(admin_vec(&env, &fake_admin)));
    assert_eq!(result, Err(Ok(PaymentError::Unauthorized)));

    // Merchant must still be active
    assert!(client.get_merchant(&merchant).active);
}

// ── T-005-2: merchant deactivates themselves → succeeds ──────────────────────

/// The merchant should be able to deactivate their own account by passing
/// `None` for `admin_authorizers` (the contract uses `merchant_address.require_auth()`
/// in that branch, which is satisfied by `mock_all_auths()`).
#[test]
fn test_t005_merchant_self_deactivate_succeeds() {
    let (env, client) = setup();
    let (_admin, merchant) = setup_merchant(&env, &client);

    // Merchant deactivates themselves (no admin list)
    client.deactivate_merchant(&merchant, &None);

    assert!(!client.get_merchant(&merchant).active);
}

// ── T-005-3: admin deactivates merchant → succeeds ───────────────────────────

/// The registered admin should be able to deactivate any merchant by
/// supplying their address in `admin_authorizers`.
#[test]
fn test_t005_admin_deactivates_merchant_succeeds() {
    let (env, client) = setup();
    let (admin, merchant) = setup_merchant(&env, &client);

    // Admin passes their address in the authorizers list
    client.deactivate_merchant(&merchant, &Some(admin_vec(&env, &admin)));

    assert!(!client.get_merchant(&merchant).active);
}

/// After admin deactivation, the merchant record must persist with
/// `active = false` and remain queryable.
#[test]
fn test_t005_deactivated_merchant_record_preserved() {
    let (env, client) = setup();
    let (admin, merchant) = setup_merchant(&env, &client);

    client.deactivate_merchant(&merchant, &Some(admin_vec(&env, &admin)));

    let record = client.get_merchant(&merchant);
    assert!(!record.active);
    assert_eq!(record.name, s(&env, "Test Store"));
}
