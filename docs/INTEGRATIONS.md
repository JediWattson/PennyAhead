# Integration checkpoints

## M1a — Local mock

No credentials are needed. The app reads a fixed synthetic snapshot through `BankDataProvider`. `MockAssistant` dispatches supported questions to backend balance, transaction, and M2 forecast calculations. It does not load Strands, call a model, or create transfers. The UI and API explicitly identify mock responses and synthetic data.

The fixture owner is a public, read-only demo identity, not an authenticated bank customer. The bank provider rejects other owner IDs; API routes choose the fixture identity on the server. There is no production authentication or durable chat storage in M1a.

## M1b — Live Strands (credential setup pending)

- [x] Select OpenAI as the initial provider, using Strands with a provider boundary that can support Amazon Bedrock later.
- [ ] Finish secure API-key setup and confirm a project-local secret destination. The setup picker was opened; a saved key and successful API access have not been verified.
- [ ] Install the Strands TypeScript SDK and implement the `Assistant` interface with narrow, server-scoped tools.
- [ ] Keep bank calculations in backend code and provide no browser/model parameter for changing the authenticated owner.
- [ ] Verify a model-selected balance tool call against the fixture provider and record its result.
- [ ] Make the UI identify live model responses separately from mock responses.

Do not count scripted dispatch or a direct test invocation as model-selected tool execution. No existing AWS profile was used, and no cloud account or credential was configured.

Reference: [Strands TypeScript quickstart](https://strandsagents.com/docs/user-guide/quickstart/typescript/).

## Plaid sandbox — Access still pending

- [ ] Obtain a project-specific Plaid Sandbox client ID and secret.
- [ ] Create a sandbox Item with test transactions and obtain its access token.
- [ ] Implement `BankDataProvider` using the Sandbox API, preserving integer cents, observation timestamps, transaction status, and pending-to-posted links.
- [ ] Distinguish provider sandbox records from the built-in synthetic fixtures.

These are setup prerequisites, not evidence of connected accounts. No Plaid API calls have been made.

Reference: [Plaid Sandbox overview](https://plaid.com/docs/sandbox/).

## Dwolla sandbox — Access still pending

- [ ] Obtain a sandbox application key and secret and verify OAuth access.
- [ ] Create a synthetic verified customer and two sandbox funding sources belonging to that customer.
- [ ] Implement backend approval binding, ownership checks, limits, and idempotency before exposing the transfer adapter.
- [ ] Implement `TransferProvider` against the sandbox endpoint and reconcile provider events.
- [ ] Record a real sandbox transfer ID and its lifecycle as M4 evidence.

The shared transfer contract is only a future integration boundary. There is no implemented transfer adapter, transfer endpoint, or local settlement simulation. Pending transfers must never increase spendable money before settlement.

Reference: [Dwolla me-to-me transfers](https://developers.dwolla.com/docs/transfer-money-me-to-me).
