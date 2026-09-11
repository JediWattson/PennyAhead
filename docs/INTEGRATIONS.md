# Integration checkpoints

## M1a — Local mock

No credentials are needed. The app reads a fixed synthetic snapshot through `BankDataProvider`. `MockAssistant` dispatches supported questions to backend balance, transaction, and M2 forecast calculations. In mock mode it does not call a model or create transfers; explicit approval separately creates a local simulation. The UI and API explicitly identify mock responses and synthetic data.

The fixture owner is a public, read-only demo identity, not an authenticated bank customer. The bank provider rejects other owner IDs; API routes choose the fixture identity on the server. There is no production authentication or durable chat storage in M1a.

## M1b — Live Strands (credential setup pending)

- [x] Select OpenAI as the initial provider, using Strands with a provider boundary that can support Amazon Bedrock later.
- [ ] Finish secure API-key setup and confirm a project-local secret destination. The setup picker was opened; a saved key and successful API access have not been verified.
- [x] Install the Strands TypeScript SDK and implement a live adapter with seven narrow, server-scoped tools, including the savings and retirement plan.
- [x] Keep bank calculations in backend code and provide no browser/model parameter for changing the authenticated owner.
- [ ] Verify a model-selected balance tool call against the fixture provider and record its result.
- [x] Make the UI identify live model responses separately from mock responses.

Do not count scripted dispatch or a direct test invocation as model-selected tool execution. The real SDK loop has been exercised using a fixture model. AWS profile `pennyahead` authenticates in `us-east-1`; this is hosting access, not evidence of live model access. See [agent configuration and evidence](AGENT.md).

Reference: [Strands TypeScript quickstart](https://strandsagents.com/docs/user-guide/quickstart/typescript/).

## Plaid sandbox — Read-only app integration

- [x] Obtain a project-specific Plaid Sandbox client ID and secret.
- [x] Create a sandbox Item with test transactions and obtain its access token.
- [x] Verify balance and transaction reads against Plaid Sandbox.
- [x] Implement `BankDataProvider` using the Sandbox API, preserving integer cents, observation timestamps, transaction status, and pending-to-posted links.
- [x] Distinguish provider sandbox records from the built-in synthetic fixtures.

On September 8, 2026 (Eastern), the Sandbox API returned 14 accounts and 50 transactions with `HISTORICAL_UPDATE_COMPLETE`. The app adapter selects two USD checking/savings accounts and their 25 transactions. The current observation provides $100 available checking and $200 available savings, with three detected monthly bills. These are Plaid-generated test records; no real bank or provider transfer is connected.

Set `PENNYAHEAD_PLAID_SANDBOX_ENABLED=true` in private `web/.env.local`, restart the app, and open `/sandbox` (also linked from the synthetic demo when enabled). The read-only view displays provider balances, activity, forecasts and corrections. Its scripted assistant reads the exact displayed observation. Live Strands on Sandbox data, independent Sandbox monitoring and provider transfers remain separate work. See [the Plaid adapter contract](PLAID.md).

Credentials and the test Item access token are stored only in ignored `web/.env.local`; setup journals and the verification summary are in ignored `web/work/private/`. The setup script writes these files with owner-only permissions and never logs credentials or raw API responses. The first institution returned `ITEM_LOGIN_REQUIRED` at Item creation; the successful setup uses Plaid's documented First Platypus Bank test institution.

To verify an existing Sandbox Item, run from `web`:

```sh
node --env-file=.env.local scripts/plaid-sandbox.mjs
```

For initial setup only, add `--create-item`. The script reuses a saved token and journals creation/exchange attempts so an ambiguous response cannot silently create another Item. If transactions are not ready, rerun the verification later; it does not create another Item. A creation or exchange with an uncertain outcome requires manual reconciliation in the Plaid dashboard before another creation attempt.

References: [Plaid Sandbox overview](https://plaid.com/docs/sandbox/), [test credentials and institution](https://plaid.com/docs/sandbox/test-credentials/), [Sandbox API](https://plaid.com/docs/api/sandbox/).

## Optional Dwolla execution — Access still pending

The current Bills experience suggests actions for the user to consider in their own bank app. It does not require Dwolla. The steps below apply only if direct money movement is added later.

- [ ] Obtain a sandbox application key and secret and verify OAuth access.
- [ ] Create a synthetic verified customer and two sandbox funding sources belonging to that customer.
- [x] Implement and test backend approval binding, synthetic ownership checks, limits and idempotency; provider-specific ownership mapping remains required.
- [ ] Implement `TransferProvider` against the sandbox endpoint and reconcile provider events.
- [ ] Record a real sandbox transfer ID and its lifecycle as M4 evidence.

The approval endpoint and local settlement simulation are implemented. The provider adapter and signed webhook reconciliation remain open; selecting Dwolla currently fails closed. Pending transfers must never increase spendable money before settlement.

Reference: [Dwolla me-to-me transfers](https://developers.dwolla.com/docs/transfer-money-me-to-me).
