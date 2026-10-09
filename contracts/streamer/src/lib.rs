#![no_std]

use soroban_sdk::token::Client as TokenClient;
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, Env, Map, String, Vec,
};

const MAX_TITLE_LEN: u32 = 120;
const MAX_DESCRIPTION_LEN: u32 = 1024;

fn normalize_optional_text(input: Option<String>, max_len: u32) -> Option<String> {
    match input {
        Some(value) => {
            if value.len() == 0 {
                None
            } else {
                if value.len() > max_len {
                    panic!();
                }
                Some(value)
            }
        }
        None => None,
    }
}

/// Sum of every recipient's per-second rate (the stream's combined outflow).
fn total_outflow_rate(stream: &Stream) -> i128 {
    let mut total: i128 = 0i128;
    for i in 0..stream.recipients.len() {
        let r = stream.recipients.get(i).unwrap();
        let ri = stream.recipient_rate_per_second.get(r).unwrap_or(0i128);
        total = total.saturating_add(ri);
    }
    total
}

/// The most a recipient can ever receive from the deposit: their pro-rata share of it,
/// `deposit * rate / total_rate`. This is exactly what the recipient would have streamed
/// by the time the deposit is used up at the combined rate, so the shares of all
/// recipients add up to at most `deposit` (integer division rounds each share down).
fn recipient_share_cap(deposit: i128, rate: i128, total_rate: i128) -> i128 {
    if deposit <= 0 || rate <= 0 || total_rate <= 0 {
        return 0i128;
    }
    match deposit.checked_mul(rate) {
        Some(product) => product / total_rate,
        // `deposit * rate` does not fit in an i128: divide first. This still rounds
        // down, so the shares can never add up to more than the deposit.
        None => (deposit / total_rate).saturating_mul(rate),
    }
}

/// Amount `recipient` can withdraw right now.
///
/// A recipient accrues `rate * elapsed` since the stream started, bounded by their share
/// of the deposit (see `recipient_share_cap`), minus what they have already withdrawn.
/// Capping each recipient by their own share, and not by a deposit remainder shared with
/// everyone else, keeps the total paid out within `deposit` for any withdrawal order and
/// never leaves a recipient's accrued funds stranded behind another recipient's accrual.
fn withdrawable_now(stream: &Stream, recipient: &Address, now: u64) -> i128 {
    let rate = stream
        .recipient_rate_per_second
        .get(recipient.clone())
        .unwrap_or(0i128);
    if rate <= 0i128 {
        return 0i128;
    }
    let share_cap = recipient_share_cap(stream.deposit, rate, total_outflow_rate(stream));
    let elapsed = now.saturating_sub(stream.start_time) as i128;
    let vested = core::cmp::min(elapsed.saturating_mul(rate), share_cap);
    let withdrawn = stream
        .recipient_total_withdrawn
        .get(recipient.clone())
        .unwrap_or(0i128);
    core::cmp::max(vested.saturating_sub(withdrawn), 0i128)
}

/// Error codes
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Error {
    AlreadyInitialized = 1,
    InvalidParameters = 2,
    ContractInsufficientBalance = 3,
    StreamNotFound = 4,
    StreamInactive = 5,
    NothingToWithdraw = 6,
    SubscriptionNotFound = 7,
    SubscriptionInactive = 8,
    NotDueYet = 9,
    InsufficientContractBalance = 10,
    NotInitialized = 11,
}

/// Data keys in storage
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    PlatformAdmin,
    NextStreamId,
    StreamKey(u32), // stream_id -> Stream
    NextSubscriptionId,
    SubscriptionKey(u32),               // subscription_id -> Subscription
    TokenContract,                      // Address (optional global token id if you want a default)
    UserSentStreams(Address), // user address -> Vec<u32> (stream IDs where user is sender)
    UserReceivedStreams(Address), // user address -> Vec<u32> (stream IDs where user is recipient)
    UserSubscriptions(Address), // user address -> Vec<u32> (subscription IDs where user is subscriber)
    UserReceivedSubscriptions(Address), // user address -> Vec<u32> (subscription IDs where user is receiver)
}

/// A streaming payment: continuous rate-based escrow
#[contracttype]
#[derive(Clone)]
pub struct Stream {
    pub id: u32,
    pub sender: Address,
    pub recipients: Vec<Address>, // Multiple recipients (changed from single Address)
    pub token_contract: Address,
    // Per-recipient rate in atomic units per second, derived from amount-per-period / period_seconds
    pub recipient_rate_per_second: Map<Address, i128>,
    pub deposit: i128,   // total deposited initially (remaining is derived)
    pub start_time: u64, // ledger timestamp seconds
    pub recipient_last_withdraw: Map<Address, u64>, // Per-recipient last withdrawal time
    pub recipient_total_withdrawn: Map<Address, i128>, // Per-recipient total withdrawn amount
    pub is_active: bool,
    pub title: Option<String>,
    pub description: Option<String>,
}

/// A recurring subscription (pull/payments at intervals)
#[contracttype]
#[derive(Clone)]
pub struct Subscription {
    pub id: u32,
    pub subscriber: Address,
    pub receiver: Address,
    pub token_contract: Address,
    pub amount_per_interval: i128,
    pub interval_seconds: u64,
    pub next_payment_time: u64,
    pub active: bool,
    pub balance: i128, // Escrowed balance for this subscription (isolated from other subscriptions)
    pub title: Option<String>,
    pub description: Option<String>,
}

#[contract]
pub struct Streamer;

#[contractimpl]
impl Streamer {
    /// Initialize platform admin and optional default token contract.
    /// Call once.
    pub fn init(env: Env, platform_admin: Address, default_token: Option<Address>) {
        if env
            .storage()
            .persistent()
            .get::<_, Address>(&DataKey::PlatformAdmin)
            .is_some()
        {
            panic!();
        }
        env.storage()
            .persistent()
            .set(&DataKey::PlatformAdmin, &platform_admin);
        env.storage()
            .persistent()
            .set(&DataKey::NextStreamId, &1u32);
        env.storage()
            .persistent()
            .set(&DataKey::NextSubscriptionId, &1u32);
        if let Some(t) = default_token {
            env.storage().persistent().set(&DataKey::TokenContract, &t);
        }
    }

    // ===========================
    // STREAMING: create / withdraw / cancel
    // ===========================

    /// Create a stream. Transfers `deposit` tokens from the sender to this contract
    /// and registers a new payment stream with multiple recipients.
    /// Each recipient receives the full `rate_per_second` (multiplicative model).
    ///
    /// Returns the stream id.
    pub fn create_stream(
        env: Env,
        sender: Address,
        recipients: Vec<Address>,
        token_contract: Address,
        amounts_per_period: Vec<i128>, // atomic units for each recipient
        period_seconds: u64,           // e.g., 30 days in seconds
        deposit: i128,
        title: Option<String>,
        description: Option<String>,
    ) -> u32 {
        // auth
        sender.require_auth();

        // Validate inputs
        if recipients.len() == 0 {
            panic!(); // At least one recipient required
        }

        // Check lengths and duplicates
        if recipients.len() != amounts_per_period.len() {
            panic!();
        }
        for i in 0..recipients.len() {
            for j in (i + 1)..recipients.len() {
                if recipients.get(i).unwrap() == recipients.get(j).unwrap() {
                    panic!(); // Duplicate recipient found
                }
            }
        }

        if period_seconds == 0 || deposit <= 0 {
            panic!();
        }

        // compute start time
        let start_time: u64 = env.ledger().timestamp();

        // Transfer tokens from sender to contract
        let token = TokenClient::new(&env, &token_contract);
        let contract_addr = env.current_contract_address();

        // Transfer deposit from sender to contract
        token.transfer(&sender, &contract_addr, &deposit);

        // allocate stream id
        let mut next_id: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::NextStreamId)
            .unwrap_or(1u32);
        let stream_id = next_id;

        // Create maps for tracking
        let mut recipient_last_withdraw = Map::new(&env);
        let mut recipient_total_withdrawn = Map::new(&env);
        let mut recipient_rate_per_second = Map::new(&env);

        // Derive per-recipient rate: amount_per_period / period_seconds (integer division)
        let normalized_title = normalize_optional_text(title, MAX_TITLE_LEN);
        let normalized_description = normalize_optional_text(description, MAX_DESCRIPTION_LEN);

        for i in 0..recipients.len() {
            let recipient = recipients.get(i).unwrap();
            let amt = amounts_per_period.get(i).unwrap();
            if amt <= 0i128 {
                panic!();
            }
            let rate_i: i128 = amt / (period_seconds as i128);
            if rate_i <= 0i128 {
                // Too small for given period
                panic!();
            }
            recipient_rate_per_second.set(recipient.clone(), rate_i);
            // Initialize last withdraw maps (optional; default on read is start_time)
            // Initialize totals to 0
            recipient_total_withdrawn.set(recipient.clone(), 0i128);
        }

        let stream = Stream {
            id: stream_id,
            sender: sender.clone(),
            recipients: recipients.clone(),
            token_contract: token_contract.clone(),
            recipient_rate_per_second,
            deposit,
            start_time,
            recipient_last_withdraw,
            recipient_total_withdrawn,
            is_active: true,
            title: normalized_title.clone(),
            description: normalized_description.clone(),
        };
        env.storage()
            .persistent()
            .set(&DataKey::StreamKey(stream_id), &stream);
        next_id += 1;
        env.storage()
            .persistent()
            .set(&DataKey::NextStreamId, &next_id);

        // Update user stream indexes
        // Add to sender's sent streams
        let sender_clone = sender.clone();
        let mut sent_streams: Vec<u32> = env
            .storage()
            .persistent()
            .get(&DataKey::UserSentStreams(sender_clone.clone()))
            .unwrap_or_else(|| Vec::new(&env));
        sent_streams.push_back(stream_id);
        env.storage()
            .persistent()
            .set(&DataKey::UserSentStreams(sender_clone), &sent_streams);

        // Add to each recipient's received streams
        for i in 0..recipients.len() {
            let recipient = recipients.get(i).unwrap();
            let recipient_clone = recipient.clone();
            let mut received_streams: Vec<u32> = env
                .storage()
                .persistent()
                .get(&DataKey::UserReceivedStreams(recipient_clone.clone()))
                .unwrap_or_else(|| Vec::new(&env));
            received_streams.push_back(stream_id);
            env.storage().persistent().set(
                &DataKey::UserReceivedStreams(recipient_clone),
                &received_streams,
            );
        }

        // emit event (include all recipients)
        env.events().publish(
            (symbol_short!("strm_crt"), stream_id),
            (
                sender,
                recipients.clone(),
                deposit,
                start_time,
                normalized_title,
                normalized_description,
            ),
        );

        stream_id
    }

    /// Withdraw accrued funds for a stream.
    /// The recipient parameter specifies which recipient is withdrawing.
    /// Each recipient can withdraw independently based on their own rate (full rate_per_second).
    pub fn withdraw_stream(env: Env, stream_id: u32, recipient: Address) -> i128 {
        // fetch stream
        let mut stream: Stream = env
            .storage()
            .persistent()
            .get(&DataKey::StreamKey(stream_id))
            .unwrap_or_else(|| panic!());

        if !stream.is_active {
            panic!();
        }

        // Verify recipient is in the recipients list
        let mut is_recipient = false;
        for i in 0..stream.recipients.len() {
            let r = stream.recipients.get(i).unwrap();
            if r == recipient {
                is_recipient = true;
                break;
            }
        }
        if !is_recipient {
            panic!(); // Not a recipient of this stream
        }

        let now: u64 = env.ledger().timestamp();

        // Get this recipient's last withdrawal time (default to start_time)
        let last_withdraw = stream
            .recipient_last_withdraw
            .get(recipient.clone())
            .unwrap_or(stream.start_time);

        if now <= last_withdraw {
            return 0i128;
        }

        // This recipient must have a positive rate
        let rate_i = stream
            .recipient_rate_per_second
            .get(recipient.clone())
            .unwrap_or(0i128);
        if rate_i <= 0i128 {
            panic!();
        }

        // What this recipient has accrued so far (bounded by their own share of the
        // deposit) minus what they already withdrew. Other recipients' withdrawals do not
        // affect it, so the sum of all payouts can never exceed the deposit.
        let transfer_amount = withdrawable_now(&stream, &recipient, now);

        if transfer_amount <= 0 {
            panic!(); // Nothing to withdraw
        }

        // TOKEN TRANSFER: contract -> recipient
        let token = TokenClient::new(&env, &stream.token_contract);
        let contract_addr = env.current_contract_address();

        token.transfer(&contract_addr, &recipient, &transfer_amount);

        // Update this recipient's last withdrawal time
        stream.recipient_last_withdraw.set(recipient.clone(), now);

        // Update this recipient's total withdrawn
        let current_total = stream
            .recipient_total_withdrawn
            .get(recipient.clone())
            .unwrap_or(0i128);
        let new_total = current_total.saturating_add(transfer_amount);
        stream
            .recipient_total_withdrawn
            .set(recipient.clone(), new_total);

        // The stream is finished once every recipient has received their full share of the
        // deposit. Until then it stays open so the others can still claim theirs.
        let total_rate = total_outflow_rate(&stream);
        let mut all_paid = true;
        for i in 0..stream.recipients.len() {
            let r = stream.recipients.get(i).unwrap();
            let ri = stream
                .recipient_rate_per_second
                .get(r.clone())
                .unwrap_or(0i128);
            let share = recipient_share_cap(stream.deposit, ri, total_rate);
            let paid = stream.recipient_total_withdrawn.get(r).unwrap_or(0i128);
            if paid < share {
                all_paid = false;
                break;
            }
        }
        if all_paid {
            stream.is_active = false;
        }

        env.storage()
            .persistent()
            .set(&DataKey::StreamKey(stream_id), &stream);

        env.events().publish(
            (symbol_short!("strm_wd"), stream_id),
            (recipient.clone(), transfer_amount, now),
        );

        transfer_amount
    }

    /// Cancel a stream. Caller must be the sender.
    /// Calculates remaining deposit after all recipients' withdrawals and refunds to sender.
    pub fn cancel_stream(env: Env, stream_id: u32) {
        let mut stream: Stream = env
            .storage()
            .persistent()
            .get(&DataKey::StreamKey(stream_id))
            .unwrap_or_else(|| panic!());

        // only sender can cancel
        stream.sender.require_auth();

        if !stream.is_active {
            panic!();
        }

        // compute remaining deposit after all recipients' withdrawals
        let now: u64 = env.ledger().timestamp();
        // Total outflow rate = sum of per-recipient rates
        let mut total_outflow_rate: i128 = 0i128;
        for i in 0..stream.recipients.len() {
            let r = stream.recipients.get(i).unwrap();
            let ri = stream.recipient_rate_per_second.get(r).unwrap_or(0i128);
            total_outflow_rate = total_outflow_rate.saturating_add(ri);
        }
        let elapsed_from_start = (now - stream.start_time) as i128;
        let total_distributed = elapsed_from_start.saturating_mul(total_outflow_rate);
        let remaining_deposit = stream.deposit.saturating_sub(total_distributed);

        let token = TokenClient::new(&env, &stream.token_contract);
        let contract_addr = env.current_contract_address();

        // Refund remaining deposit to sender
        if remaining_deposit > 0 {
            token.transfer(&contract_addr, &stream.sender, &remaining_deposit);
        }

        // mark inactive
        stream.is_active = false;
        stream.deposit = 0;
        env.storage()
            .persistent()
            .set(&DataKey::StreamKey(stream_id), &stream);

        env.events().publish(
            (symbol_short!("strm_can"), stream_id),
            (stream.sender.clone(), remaining_deposit, now),
        );
    }

    // ===========================
    // SUBSCRIPTIONS: recurring payments (interval pulls)
    // ===========================

    /// Deposit funds to a subscription (isolated escrow per subscription)
    /// Subscriber must authorize (require_auth). Funds are isolated to this specific subscription.
    pub fn deposit_to_subscription(env: Env, subscription_id: u32, amount: i128) {
        let mut sub: Subscription = env
            .storage()
            .persistent()
            .get(&DataKey::SubscriptionKey(subscription_id))
            .unwrap_or_else(|| panic!());

        sub.subscriber.require_auth();

        if amount <= 0 {
            panic!();
        }

        // Transfer tokens from subscriber to contract
        let token = TokenClient::new(&env, &sub.token_contract);
        let contract_addr = env.current_contract_address();
        token.transfer(&sub.subscriber, &contract_addr, &amount);

        // Update subscription balance (isolated)
        sub.balance = sub.balance.saturating_add(amount);
        env.storage()
            .persistent()
            .set(&DataKey::SubscriptionKey(subscription_id), &sub);

        env.events().publish(
            (symbol_short!("sub_dep"), subscription_id),
            (sub.subscriber.clone(), amount, sub.balance),
        );
    }

    /// Create a subscription. Subscriber must authorize (require_auth).
    /// This model expects the subscriber to periodically ensure the contract has funds to perform the pull,
    /// or to have previously transferred allowance/escrow. The sponsor of payments (service owner) receives fixed amounts per interval.
    ///
    /// next_payment_time should typically be `now + interval_seconds` or now depending on desired behavior.
    pub fn create_subscription(
        env: Env,
        subscriber: Address,
        receiver: Address,
        token_contract: Address,
        amount_per_interval: i128,
        interval_seconds: u64,
        first_payment_time: u64,
        title: Option<String>,
        description: Option<String>,
    ) -> u32 {
        subscriber.require_auth();

        if amount_per_interval <= 0 || interval_seconds == 0 {
            panic!();
        }

        let mut next_id: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::NextSubscriptionId)
            .unwrap_or(1u32);
        let sub_id = next_id;

        let normalized_title = normalize_optional_text(title, MAX_TITLE_LEN);
        let normalized_description = normalize_optional_text(description, MAX_DESCRIPTION_LEN);

        let subscription = Subscription {
            id: sub_id,
            subscriber: subscriber.clone(),
            receiver: receiver.clone(),
            token_contract: token_contract.clone(),
            amount_per_interval,
            interval_seconds,
            next_payment_time: first_payment_time,
            active: true,
            balance: 0i128, // Start with zero balance - subscriber must deposit
            title: normalized_title.clone(),
            description: normalized_description.clone(),
        };

        env.storage()
            .persistent()
            .set(&DataKey::SubscriptionKey(sub_id), &subscription);
        next_id += 1;
        env.storage()
            .persistent()
            .set(&DataKey::NextSubscriptionId, &next_id);

        // Update user subscription indexes
        // Add to subscriber's subscriptions
        let subscriber_clone = subscriber.clone();
        let mut subscriber_subs: Vec<u32> = env
            .storage()
            .persistent()
            .get(&DataKey::UserSubscriptions(subscriber_clone.clone()))
            .unwrap_or_else(|| Vec::new(&env));
        subscriber_subs.push_back(sub_id);
        env.storage().persistent().set(
            &DataKey::UserSubscriptions(subscriber_clone),
            &subscriber_subs,
        );

        // Add to receiver's received subscriptions
        let receiver_clone = receiver.clone();
        let mut receiver_subs: Vec<u32> = env
            .storage()
            .persistent()
            .get(&DataKey::UserReceivedSubscriptions(receiver_clone.clone()))
            .unwrap_or_else(|| Vec::new(&env));
        receiver_subs.push_back(sub_id);
        env.storage().persistent().set(
            &DataKey::UserReceivedSubscriptions(receiver_clone),
            &receiver_subs,
        );

        env.events().publish(
            (symbol_short!("sub_crt"), sub_id),
            (
                subscriber,
                receiver,
                amount_per_interval,
                interval_seconds,
                first_payment_time,
                normalized_title,
                normalized_description,
            ),
        );

        sub_id
    }

    /// Charge (execute) a due subscription. Can be called by anyone (keep it open), but it will transfer
    /// tokens from contract -> receiver. This assumes the contract already holds the subscriber funds,
    /// or you have some pull authorization pattern (not implemented here).
    ///
    /// The typical pattern: a keeper checks subscriptions whose next_payment_time <= now and triggers this call.
    pub fn charge_subscription(env: Env, subscription_id: u32) {
        let mut sub: Subscription = env
            .storage()
            .persistent()
            .get(&DataKey::SubscriptionKey(subscription_id))
            .unwrap_or_else(|| panic!());

        if !sub.active {
            panic!();
        }

        let now: u64 = env.ledger().timestamp();
        if now < sub.next_payment_time {
            panic!();
        }

        // Determine how many intervals are due (in case of backlog)
        let mut due_intervals: u64 = 1;
        if now >= sub.next_payment_time + sub.interval_seconds {
            due_intervals = (now - sub.next_payment_time) / sub.interval_seconds + 1;
        }

        // total amount to transfer
        let amount_to_transfer =
            (sub.amount_per_interval as i128).saturating_mul(due_intervals as i128);

        // Check subscription balance (isolated per subscription)
        if sub.balance < amount_to_transfer {
            panic!();
        }

        // Transfer from contract to receiver
        let token = TokenClient::new(&env, &sub.token_contract);
        let contract_addr = env.current_contract_address();

        token.transfer(&contract_addr, &sub.receiver, &amount_to_transfer);

        // Deduct from subscription balance (isolated)
        sub.balance = sub.balance.saturating_sub(amount_to_transfer);

        // update next payment time
        sub.next_payment_time = sub.next_payment_time + due_intervals * sub.interval_seconds;
        env.storage()
            .persistent()
            .set(&DataKey::SubscriptionKey(subscription_id), &sub);

        env.events().publish(
            (symbol_short!("sub_chrg"), subscription_id),
            (
                sub.receiver.clone(),
                amount_to_transfer,
                sub.next_payment_time,
            ),
        );
    }

    /// Cancel a subscription (subscriber must auth)
    /// Refunds any remaining balance to the subscriber
    pub fn cancel_subscription(env: Env, subscription_id: u32) {
        let mut sub: Subscription = env
            .storage()
            .persistent()
            .get(&DataKey::SubscriptionKey(subscription_id))
            .unwrap_or_else(|| panic!());

        sub.subscriber.require_auth();

        let refund_amount = sub.balance;

        // Refund remaining balance to subscriber (if any)
        if sub.balance > 0 {
            let token = TokenClient::new(&env, &sub.token_contract);
            let contract_addr = env.current_contract_address();
            token.transfer(&contract_addr, &sub.subscriber, &sub.balance);
        }

        sub.balance = 0;
        sub.active = false;
        env.storage()
            .persistent()
            .set(&DataKey::SubscriptionKey(subscription_id), &sub);

        let now: u64 = env.ledger().timestamp();
        env.events().publish(
            (symbol_short!("sub_can"), subscription_id),
            (
                sub.subscriber.clone(),
                sub.receiver.clone(),
                refund_amount,
                now,
            ),
        );
    }

    // ===========================
    // RECIPIENT INFO QUERIES
    // ===========================

    /// Get detailed information about a specific recipient in a stream.
    /// Returns: (total_withdrawn, current_accrued, last_withdraw_time)
    pub fn get_recipient_info(env: Env, stream_id: u32, recipient: Address) -> (i128, i128, u64) {
        let stream: Stream = env
            .storage()
            .persistent()
            .get(&DataKey::StreamKey(stream_id))
            .unwrap_or_else(|| panic!());

        // Verify recipient is in the list
        let mut is_recipient = false;
        for i in 0..stream.recipients.len() {
            let r = stream.recipients.get(i).unwrap();
            if r == recipient {
                is_recipient = true;
                break;
            }
        }
        if !is_recipient {
            panic!(); // Not a recipient
        }

        let now = env.ledger().timestamp();

        // Get total withdrawn (default to 0)
        let total_withdrawn = stream
            .recipient_total_withdrawn
            .get(recipient.clone())
            .unwrap_or(0i128);

        // Get last withdrawal time (default to start_time)
        let last_withdraw = stream
            .recipient_last_withdraw
            .get(recipient.clone())
            .unwrap_or(stream.start_time);

        // Amount a withdrawal would pay right now (same calculation as `withdraw_stream`)
        let current_accrued = if stream.is_active {
            withdrawable_now(&stream, &recipient, now)
        } else {
            0i128
        };

        (total_withdrawn, current_accrued, last_withdraw)
    }

    /// Get information about all recipients in a stream.
    /// Returns a Vec of (Address, total_withdrawn, current_accrued, last_withdraw_time)
    pub fn get_all_recipients_info(env: Env, stream_id: u32) -> Vec<(Address, i128, i128, u64)> {
        let stream: Stream = env
            .storage()
            .persistent()
            .get(&DataKey::StreamKey(stream_id))
            .unwrap_or_else(|| panic!());

        let mut result = Vec::new(&env);
        let now = env.ledger().timestamp();

        for i in 0..stream.recipients.len() {
            let recipient = stream.recipients.get(i).unwrap();

            let total_withdrawn = stream
                .recipient_total_withdrawn
                .get(recipient.clone())
                .unwrap_or(0i128);

            let last_withdraw = stream
                .recipient_last_withdraw
                .get(recipient.clone())
                .unwrap_or(stream.start_time);

            // Amount a withdrawal would pay right now (same calculation as `withdraw_stream`)
            let current_accrued = if stream.is_active {
                withdrawable_now(&stream, &recipient, now)
            } else {
                0i128
            };

            result.push_back((
                recipient.clone(),
                total_withdrawn,
                current_accrued,
                last_withdraw,
            ));
        }

        result
    }

    // ===========================
    // QUERY HELPERS
    // ===========================
    pub fn get_stream(env: Env, stream_id: u32) -> Stream {
        env.storage()
            .persistent()
            .get(&DataKey::StreamKey(stream_id))
            .unwrap_or_else(|| panic!())
    }

    pub fn get_subscription(env: Env, subscription_id: u32) -> Subscription {
        env.storage()
            .persistent()
            .get(&DataKey::SubscriptionKey(subscription_id))
            .unwrap_or_else(|| panic!())
    }

    /// Get all stream IDs where the user is the sender
    pub fn get_user_sent_stream_ids(env: Env, user: Address) -> Vec<u32> {
        env.storage()
            .persistent()
            .get(&DataKey::UserSentStreams(user))
            .unwrap_or_else(|| Vec::new(&env))
    }

    /// Get all stream IDs where the user is the recipient
    pub fn get_user_received_stream_ids(env: Env, user: Address) -> Vec<u32> {
        env.storage()
            .persistent()
            .get(&DataKey::UserReceivedStreams(user))
            .unwrap_or_else(|| Vec::new(&env))
    }

    /// Get all streams where the user is the sender
    pub fn get_user_sent_streams(env: Env, user: Address) -> Vec<Stream> {
        let stream_ids = Self::get_user_sent_stream_ids(env.clone(), user);
        let mut streams = Vec::new(&env);
        for i in 0..stream_ids.len() {
            let stream_id = stream_ids.get(i).unwrap();
            if let Some(stream) = env
                .storage()
                .persistent()
                .get::<_, Stream>(&DataKey::StreamKey(stream_id))
            {
                streams.push_back(stream);
            }
        }
        streams
    }

    /// Get all streams where the user is the recipient
    pub fn get_user_received_streams(env: Env, user: Address) -> Vec<Stream> {
        let stream_ids = Self::get_user_received_stream_ids(env.clone(), user);
        let mut streams = Vec::new(&env);
        for i in 0..stream_ids.len() {
            let stream_id = stream_ids.get(i).unwrap();
            if let Some(stream) = env
                .storage()
                .persistent()
                .get::<_, Stream>(&DataKey::StreamKey(stream_id))
            {
                streams.push_back(stream);
            }
        }
        streams
    }

    /// Get all streams where the user is either sender or recipient
    /// Note: This may include duplicates if a stream has the same user as both sender and recipient
    pub fn get_user_streams(env: Env, user: Address) -> Vec<Stream> {
        let mut streams = Vec::new(&env);
        let mut seen_ids = Vec::new(&env);

        // Get sent streams
        let sent_ids = Self::get_user_sent_stream_ids(env.clone(), user.clone());
        for i in 0..sent_ids.len() {
            let stream_id = sent_ids.get(i).unwrap();
            if let Some(stream) = env
                .storage()
                .persistent()
                .get::<_, Stream>(&DataKey::StreamKey(stream_id))
            {
                streams.push_back(stream);
                seen_ids.push_back(stream_id);
            }
        }

        // Get received streams (skip if already added)
        let received_ids = Self::get_user_received_stream_ids(env.clone(), user);
        for i in 0..received_ids.len() {
            let stream_id = received_ids.get(i).unwrap();

            // Check if we've already added this stream
            let mut found = false;
            for j in 0..seen_ids.len() {
                if seen_ids.get(j).unwrap() == stream_id {
                    found = true;
                    break;
                }
            }
            if !found {
                if let Some(stream) = env
                    .storage()
                    .persistent()
                    .get::<_, Stream>(&DataKey::StreamKey(stream_id))
                {
                    streams.push_back(stream);
                    seen_ids.push_back(stream_id);
                }
            }
        }

        streams
    }

    /// Get all subscription IDs where the user is the subscriber
    pub fn get_user_subs_ids(env: Env, user: Address) -> Vec<u32> {
        env.storage()
            .persistent()
            .get(&DataKey::UserSubscriptions(user))
            .unwrap_or_else(|| Vec::new(&env))
    }

    /// Get all subscription IDs where the user is the receiver
    pub fn get_user_rcvd_subs_ids(env: Env, user: Address) -> Vec<u32> {
        env.storage()
            .persistent()
            .get(&DataKey::UserReceivedSubscriptions(user))
            .unwrap_or_else(|| Vec::new(&env))
    }

    /// Get all subscriptions where the user is the subscriber
    pub fn get_user_subscriptions(env: Env, user: Address) -> Vec<Subscription> {
        let subscription_ids = Self::get_user_subs_ids(env.clone(), user);
        let mut subscriptions = Vec::new(&env);
        for i in 0..subscription_ids.len() {
            let subscription_id = subscription_ids.get(i).unwrap();
            if let Some(subscription) = env
                .storage()
                .persistent()
                .get::<_, Subscription>(&DataKey::SubscriptionKey(subscription_id))
            {
                subscriptions.push_back(subscription);
            }
        }
        subscriptions
    }

    /// Get all subscriptions where the user is the receiver
    pub fn get_user_received_subscriptions(env: Env, user: Address) -> Vec<Subscription> {
        let subscription_ids = Self::get_user_rcvd_subs_ids(env.clone(), user);
        let mut subscriptions = Vec::new(&env);
        for i in 0..subscription_ids.len() {
            let subscription_id = subscription_ids.get(i).unwrap();
            if let Some(subscription) = env
                .storage()
                .persistent()
                .get::<_, Subscription>(&DataKey::SubscriptionKey(subscription_id))
            {
                subscriptions.push_back(subscription);
            }
        }
        subscriptions
    }

    /// Get all subscriptions where the user is either subscriber or receiver
    /// Note: This may include duplicates if a subscription has the same user as both subscriber and receiver
    pub fn get_user_subscriptions_all(env: Env, user: Address) -> Vec<Subscription> {
        let mut subscriptions = Vec::new(&env);
        let mut seen_ids = Vec::new(&env);

        // Get subscriptions where user is subscriber
        let subscriber_ids = Self::get_user_subs_ids(env.clone(), user.clone());
        for i in 0..subscriber_ids.len() {
            let subscription_id = subscriber_ids.get(i).unwrap();
            if let Some(subscription) = env
                .storage()
                .persistent()
                .get::<_, Subscription>(&DataKey::SubscriptionKey(subscription_id))
            {
                subscriptions.push_back(subscription);
                seen_ids.push_back(subscription_id);
            }
        }

        // Get subscriptions where user is receiver (skip if already added)
        let receiver_ids = Self::get_user_rcvd_subs_ids(env.clone(), user);
        for i in 0..receiver_ids.len() {
            let subscription_id = receiver_ids.get(i).unwrap();

            // Check if we've already added this subscription
            let mut found = false;
            for j in 0..seen_ids.len() {
                if seen_ids.get(j).unwrap() == subscription_id {
                    found = true;
                    break;
                }
            }
            if !found {
                if let Some(subscription) = env
                    .storage()
                    .persistent()
                    .get::<_, Subscription>(&DataKey::SubscriptionKey(subscription_id))
                {
                    subscriptions.push_back(subscription);
                    seen_ids.push_back(subscription_id);
                }
            }
        }

        subscriptions
    }

    // Admin utility to set/replace token contract default (if you use a global default)
    pub fn set_token_contract(env: Env, token: Address) {
        let admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::PlatformAdmin)
            .unwrap_or_else(|| panic!());
        admin.require_auth();
        env.storage()
            .persistent()
            .set(&DataKey::TokenContract, &token);
    }
}

#[cfg(test)]
mod test {
    extern crate std;

    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};
    use soroban_sdk::token::StellarAssetClient;

    const START: u64 = 1_000;

    /// Test fixture: a stellar-asset token, a funded sender and a deployed `Streamer`.
    struct Fixture {
        env: Env,
        streamer: Address,
        token: Address,
        sender: Address,
    }

    impl Fixture {
        fn new(sender_funds: i128) -> Self {
            let env = Env::default();
            env.mock_all_auths();
            env.ledger().with_mut(|l| l.timestamp = START);

            let token = env
                .register_stellar_asset_contract_v2(Address::generate(&env))
                .address();
            let sender = Address::generate(&env);
            StellarAssetClient::new(&env, &token).mint(&sender, &sender_funds);
            let streamer = env.register(Streamer, ());

            Fixture {
                env,
                streamer,
                token,
                sender,
            }
        }

        fn client(&self) -> StreamerClient<'_> {
            StreamerClient::new(&self.env, &self.streamer)
        }

        fn balance(&self, who: &Address) -> i128 {
            TokenClient::new(&self.env, &self.token).balance(who)
        }

        fn at(&self, seconds_after_start: u64) {
            self.env
                .ledger()
                .with_mut(|l| l.timestamp = START + seconds_after_start);
        }

        /// Opens a stream in which recipient `i` streams `rates[i]` tokens per second
        /// (period of 100 seconds, so `amount_per_period = rate * 100`).
        fn open(&self, recipients: &[Address], rates: &[i128], deposit: i128) -> u32 {
            let mut who = Vec::new(&self.env);
            let mut amounts = Vec::new(&self.env);
            for (r, rate) in recipients.iter().zip(rates.iter()) {
                who.push_back(r.clone());
                amounts.push_back(rate * 100);
            }
            self.client().create_stream(
                &self.sender,
                &who,
                &self.token,
                &amounts,
                &100u64,
                &deposit,
                &None,
                &None,
            )
        }
    }

    #[test]
    fn single_recipient_gets_the_accrued_amount_mid_stream() {
        let f = Fixture::new(1_000);
        let alice = Address::generate(&f.env);
        let id = f.open(core::slice::from_ref(&alice), &[1], 100);

        f.at(10);
        assert_eq!(f.client().withdraw_stream(&id, &alice), 10);
        assert_eq!(f.balance(&alice), 10);
    }

    #[test]
    fn single_recipient_can_claim_the_whole_deposit_after_it_is_exhausted() {
        let f = Fixture::new(1_000);
        let alice = Address::generate(&f.env);
        let id = f.open(core::slice::from_ref(&alice), &[1], 100);

        // The deposit runs out at t = 100; waiting longer must not strand the funds.
        f.at(250);
        assert_eq!(f.client().withdraw_stream(&id, &alice), 100);
        assert_eq!(f.balance(&alice), 100);
        assert_eq!(f.balance(&f.streamer), 0);
        assert!(!f.client().get_stream(&id).is_active);
    }

    #[test]
    fn single_recipient_is_paid_in_full_across_several_withdrawals() {
        let f = Fixture::new(1_000);
        let alice = Address::generate(&f.env);
        let id = f.open(core::slice::from_ref(&alice), &[1], 100);

        f.at(10);
        assert_eq!(f.client().withdraw_stream(&id, &alice), 10);
        f.at(60);
        assert_eq!(f.client().withdraw_stream(&id, &alice), 50);
        f.at(200);
        assert_eq!(f.client().withdraw_stream(&id, &alice), 40);
        assert_eq!(f.balance(&alice), 100);
        assert_eq!(f.balance(&f.streamer), 0);
    }

    #[test]
    fn two_recipients_never_withdraw_more_than_the_deposit() {
        let f = Fixture::new(1_000);
        let alice = Address::generate(&f.env);
        let bob = Address::generate(&f.env);
        // Combined outflow is 2 / s, so the 100 token deposit lasts 50 seconds.
        let id = f.open(&[alice.clone(), bob.clone()], &[1, 1], 100);

        f.at(30);
        assert_eq!(f.client().withdraw_stream(&id, &alice), 30);
        assert_eq!(f.client().withdraw_stream(&id, &bob), 30);

        f.at(1_000);
        assert_eq!(f.client().withdraw_stream(&id, &alice), 20);
        assert_eq!(f.client().withdraw_stream(&id, &bob), 20);

        assert_eq!(f.balance(&alice) + f.balance(&bob), 100);
        assert_eq!(f.balance(&f.streamer), 0);
        // Nothing is left to claim.
        assert!(f.client().try_withdraw_stream(&id, &alice).is_err());
    }

    #[test]
    fn withdrawal_order_does_not_change_what_each_recipient_receives() {
        let f = Fixture::new(1_000);
        let alice = Address::generate(&f.env);
        let bob = Address::generate(&f.env);
        // Rates 3 : 1 on a 100 token deposit: Alice's share is 75 and Bob's is 25.
        let id = f.open(&[alice.clone(), bob.clone()], &[3, 1], 100);

        f.at(500);
        // Bob withdraws first, then Alice: neither may starve the other.
        assert_eq!(f.client().withdraw_stream(&id, &bob), 25);
        assert_eq!(f.client().withdraw_stream(&id, &alice), 75);
        assert_eq!(f.balance(&f.streamer), 0);
    }

    #[test]
    fn early_withdrawals_do_not_shrink_what_is_owed_later() {
        let f = Fixture::new(1_000);
        let alice = Address::generate(&f.env);
        let bob = Address::generate(&f.env);
        let id = f.open(&[alice.clone(), bob.clone()], &[1, 1], 100);

        // Alice drains early and often; Bob waits until the end.
        for t in [10u64, 20, 30, 40, 50] {
            f.at(t);
            f.client().withdraw_stream(&id, &alice);
        }
        f.at(60);
        assert_eq!(f.balance(&alice), 50);
        assert_eq!(f.client().withdraw_stream(&id, &bob), 50);
        assert_eq!(f.balance(&f.streamer), 0);
    }

    #[test]
    fn rounding_dust_stays_in_the_contract_and_total_never_exceeds_the_deposit() {
        let f = Fixture::new(1_000);
        let a = Address::generate(&f.env);
        let b = Address::generate(&f.env);
        let c = Address::generate(&f.env);
        // 100 / 3 does not divide evenly: each share is floored to 33.
        let id = f.open(&[a.clone(), b.clone(), c.clone()], &[1, 1, 1], 100);

        f.at(10_000);
        let paid = f.client().withdraw_stream(&id, &a)
            + f.client().withdraw_stream(&id, &b)
            + f.client().withdraw_stream(&id, &c);
        assert_eq!(paid, 99);
        assert!(paid <= 100);
        assert_eq!(f.balance(&f.streamer), 1);
        assert!(!f.client().get_stream(&id).is_active);
    }

    #[test]
    fn stream_stays_active_until_every_recipient_has_been_paid() {
        let f = Fixture::new(1_000);
        let alice = Address::generate(&f.env);
        let bob = Address::generate(&f.env);
        let id = f.open(&[alice.clone(), bob.clone()], &[1, 1], 100);

        f.at(1_000);
        f.client().withdraw_stream(&id, &alice);
        // Bob has not claimed yet, so the stream must remain open for him.
        assert!(f.client().get_stream(&id).is_active);
        assert_eq!(f.client().withdraw_stream(&id, &bob), 50);
        assert!(!f.client().get_stream(&id).is_active);
    }

    #[test]
    fn recipient_info_reports_what_a_withdrawal_would_actually_pay() {
        let f = Fixture::new(1_000);
        let alice = Address::generate(&f.env);
        let bob = Address::generate(&f.env);
        let id = f.open(&[alice.clone(), bob.clone()], &[1, 1], 100);

        f.at(40);
        let (withdrawn, accrued, _) = f.client().get_recipient_info(&id, &alice);
        assert_eq!((withdrawn, accrued), (0, 40));

        f.at(500);
        let (_, accrued, _) = f.client().get_recipient_info(&id, &alice);
        assert_eq!(accrued, 50);
        assert_eq!(f.client().withdraw_stream(&id, &alice), accrued);

        // The bulk view agrees with the per-recipient view.
        let all = f.client().get_all_recipients_info(&id);
        let (who, withdrawn, accrued, _) = all.get(1).unwrap();
        assert_eq!((who, withdrawn, accrued), (bob, 0, 50));
    }

    #[test]
    fn non_recipient_cannot_withdraw() {
        let f = Fixture::new(1_000);
        let alice = Address::generate(&f.env);
        let mallory = Address::generate(&f.env);
        let id = f.open(&[alice], &[1], 100);

        f.at(50);
        assert!(f.client().try_withdraw_stream(&id, &mallory).is_err());
        assert_eq!(f.balance(&mallory), 0);
    }
}
