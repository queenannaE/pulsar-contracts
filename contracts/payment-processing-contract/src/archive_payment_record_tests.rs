// SPDX-License-Identifier: MIT
//! Tests for `archive_payment_record` — resolves T-006 / issue #36
//!
//! Acceptance criteria:
//!   1. Admin archives existing payment → payment no longer retrievable
//!   2. Non-admin attempts archive → Unauthorized
//!   3. Archive non-existent payment → PaymentNotFound

#![cfg(test)]

extern crate alloc;
use alloc::vec;

use soroban_sdk::{
    testutils::Address as _,
    token::StellarAssetClient,
    Address, Bytes, BytesN, Env, String, Vec,
};

use ed25519_dalek::{Signer, SigningKey};

use crate::{
    error::PaymentError,
    types::{MerchantCategory, PaymentOrder, SortField, SortOrder},
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

fn create_token(env: &Env, admin: &Address) -> Address {
    env.register_stellar_asset_contract_v2(admin.clone()).address()
}

fn mint(env: &Env, token: &Address, to: &Address, amount: i128) {
    StellarAssetClient::new(env, token).mint(to, &amount);
}

fn s(env: &Env, v: &str) -> String {
    String::from_str(env, v)
}

fn b(env: &Env, v: &str) -> Bytes {
    Bytes::from_slice(env, v.as_bytes())
}

fn zero_key(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[0u8; 32])
}

fn admin_vec(env: &Env, admin: &Address) -> Vec<Address> {
    vec![env, admin.clone()]
}

fn sign_order(env: &Env, order: &PaymentOrder) -> (BytesN<32>, BytesN<64>) {
    let signing_key = SigningKey::from_bytes(&[1u8; 32]);
    let public_key = signing_key.verifying_key();
    let payload = order.order_id.clone();
    let mut payload_bytes = alloc::vec![0u8; payload.len() as usize];
    payload.copy_into_slice(&mut payload_bytes);
    let signature = signing_key.sign(&payload_bytes);
    (
        BytesN::from_array(env, &public_key.to_bytes()),
        BytesN::from_array(env, &signature.to_bytes()),
    )
}

/// Register an admin, a merchant, mint tokens to a payer, and process one
/// payment (`ORDER_ARC_001`). Returns `(admin, merchant, payer, token)`.
fn setup_paid_order(
    env: &Env,
    client: &PaymentContractClient,
) -> (Address, Address, Address, Address) {
    let admin = Address::generate(env);
    let merchant = Address::generate(env);
    let payer = Address::generate(env);
    let token = create_token(env, &admin);

    client.set_admin(&admin_vec(env, &admin), &1);
    client.register_merchant(
        &merchant,
        &s(env, "Store"),
        &s(env, "desc"),
        &s(env, "c@c.com"),
        &MerchantCategory::Retail,
        &None,
    );
    mint(env, &token, &payer, 5_000);

    let order = PaymentOrder {
        order_id: b(env, "ORDER_ARC_001"),
        merchant_address: merchant.clone(),
        payer: payer.clone(),
        token: token.clone(),
        amount: 1_000,
        description: s(env, "Test order"),
        expires_at: 0,
    };
    let (_pk, sig) = sign_order(env, &order);
    client.process_payment_with_signature(&payer, &order, &sig, &zero_key(env));

    (admin, merchant, payer, token)
}

// ── T-006-1: admin archives existing payment → payment no longer retrievable ─

#[test]
fn test_t006_admin_archives_payment_not_retrievable() {
    let (env, client) = setup();
    let (admin, merchant, payer, _token) = setup_paid_order(&env, &client);

    // Verify the payment exists in all indexes before archiving
    let record = client.get_payment_by_id(&payer, &b(&env, "ORDER_ARC_001"));
    assert_eq!(record.amount, 1_000);

    let mhist = client.get_merchant_payment_history(
        &merchant, &None, &10, &None, &SortField::Date, &SortOrder::Ascending,
    );
    assert_eq!(mhist.total, 1);

    let phist = client.get_payer_payment_history(
        &payer, &None, &10, &None, &SortField::Date, &SortOrder::Ascending,
    );
    assert_eq!(phist.total, 1);

    // Admin archives the payment
    client.archive_payment_record(&admin_vec(&env, &admin), &b(&env, "ORDER_ARC_001"));

    // Direct lookup must now return PaymentNotFound
    assert_eq!(
        client.try_get_payment_by_id(&payer, &b(&env, "ORDER_ARC_001")),
        Err(Ok(PaymentError::PaymentNotFound)),
    );

    // Merchant payment history must be empty after archiving
    let mhist_after = client.get_merchant_payment_history(
        &merchant, &None, &10, &None, &SortField::Date, &SortOrder::Ascending,
    );
    assert_eq!(mhist_after.total, 0);

    // Payer payment history must be empty after archiving
    let phist_after = client.get_payer_payment_history(
        &payer, &None, &10, &None, &SortField::Date, &SortOrder::Ascending,
    );
    assert_eq!(phist_after.total, 0);
}

// ── T-006-2: non-admin attempts archive → Unauthorized ───────────────────────

#[test]
fn test_t006_non_admin_archive_unauthorized() {
    let (env, client) = setup();
    let (_admin, _merchant, payer, _token) = setup_paid_order(&env, &client);

    // The payer is not an admin — must be rejected
    assert_eq!(
        client.try_archive_payment_record(
            &admin_vec(&env, &payer),
            &b(&env, "ORDER_ARC_001"),
        ),
        Err(Ok(PaymentError::Unauthorized)),
    );

    // A random address must also be rejected
    let random = Address::generate(&env);
    assert_eq!(
        client.try_archive_payment_record(
            &admin_vec(&env, &random),
            &b(&env, "ORDER_ARC_001"),
        ),
        Err(Ok(PaymentError::Unauthorized)),
    );
}

// ── T-006-3: archive non-existent payment → PaymentNotFound ──────────────────

#[test]
fn test_t006_archive_nonexistent_payment_not_found() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    client.set_admin(&admin_vec(&env, &admin), &1);

    assert_eq!(
        client.try_archive_payment_record(
            &admin_vec(&env, &admin),
            &b(&env, "DOES_NOT_EXIST"),
        ),
        Err(Ok(PaymentError::PaymentNotFound)),
    );
}
