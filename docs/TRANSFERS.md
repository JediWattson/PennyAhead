# Approval and simulated settlement

The executable flow is **local simulation only**. Setting `PENNYAHEAD_TRANSFER_PROVIDER=dwolla_sandbox` fails closed; it cannot silently create a simulated provider result. There is no Dwolla API adapter or webhook endpoint yet.

## Approval contract

A proposal has a server-generated ID. The checkbox and request bind that ID, configuration revision, exact integer-cent amount, savings source and checking destination. The server recomputes the plan against the effective session snapshot, compares it with the offered plan, and atomically verifies revision/check count, freshness (20 seconds), status, eligibility and the $500 maximum. Browser-supplied owner IDs are never used. Account ownership, spendability, savings commitments/floor and arrival constraints are checked by deterministic backend calculations.

SQLite `BEGIN IMMEDIATE` serializes approval. The idempotency key derives from the session and proposal IDs. An identical retry returns the original record; a changed amount or account fails. Another pending transfer blocks a new proposal. A declined unchanged proposal stays declined across checks. A stale worker cannot overwrite financial mutations. Fifty transfer records per session bound demo storage.

The session token is a random bearer capability in page memory, with a 24-hour lifetime. It is demo isolation, not production identity verification. Reloading creates a new isolated session. No real bank account should use this authorization scheme.

## Outcome and balances

Pending simulation reserves the source's available savings exactly once. It does **not** increase available checking or resolve the shortfall. Only explicit **Simulate success** adds a posted debit and credit to the session ledger and updates accounts, activity, forecast and future assistant reads. **Simulate failure** releases the reservation and records failure without a credit. Terminal outcomes cannot be overwritten. Repeating the same terminal outcome is harmless.

A scenario reset cancels local pending simulations, ends the automatic rule and starts a new ledger generation. History remains visible, but prior generations cannot affect new balances. Changing scenarios also resets simulated money. No fixture file is mutated. The UI clears prior chat when ledger outcomes change; a late assistant reply from an earlier ledger is discarded.

The ledger and rules survive server/database reopen. Session expiry remains 24 hours; local pending records are retained for operator inspection but are no longer accessible through an expired bearer session. Provider lifecycles require a separate durable identity and outbox before enabling Dwolla.

## Optional rule

Explicit authorization binds savings → checking, a total budget of at most $500, and the displayed savings floor. Each automatic approval consumes the budget atomically; failures do not refund it. The effective floor is the higher of the captured rule floor and current preference. Pause prevents new automatic approvals; revoke takes effect before the next approval but cannot undo an already submitted transfer. Failure revokes the rule and never automatically retries. No language-model tool can authorize or edit a rule.

## Provider integration still required

Before enabling Dwolla, verify a sandbox customer owns both funding sources, tie bank observations to those exact sources, and implement a persistent submission outbox with stable idempotency keys. Reconcile signed webhooks by fetching the provider resource's current state; handle duplicate/out-of-order events and uncertain create responses without resubmitting a different transfer. Never treat a local simulation, webhook receipt, or provider completion as a fresh bank available-balance observation. Record real sandbox IDs and lifecycle evidence in the milestone ledger.
