# Plaid Sandbox data in the app

The optional `/sandbox` view reads one operator-configured, synthetic Plaid Item. The original `/` view retains the complete deterministic demo and simulated transfer flow. The Sandbox view has no transfer or automation controls and does not run the synthetic monitor. Local settlement refuses provider observations.

## Setup

Keep these server-only settings in ignored `web/.env.local`:

```dotenv
PENNYAHEAD_PLAID_SANDBOX_ENABLED=true
PLAID_ENV=sandbox
PLAID_CLIENT_ID=<private Sandbox client ID>
PLAID_SECRET=<private Sandbox secret>
PLAID_ACCESS_TOKEN=<private test Item access token>
```

The private setup script in [integration checkpoints](INTEGRATIONS.md) can create a test Item. Restart the server after setting or rotating credentials. The default application and deployment need no Plaid credentials and leave this view disabled. No credential is sent to the browser or included in the Docker build context.

This is a read-only public test-data demo, not customer authentication. The owner and Item are fixed by server configuration; browser inputs cannot choose another owner, Item, token or provider URL. Every provider request targets `https://sandbox.plaid.com`, refuses redirects and uses a 35-second total read deadline. Production tokens are rejected.

## Data and forecast contract

- The adapter reads `/transactions/sync`, `/item/get` and `/accounts/balance/get`. Sync pages are applied to a candidate snapshot with additions, modifications and removals. A pagination mutation discards the candidate and restarts once from the original cursor; repeated mutation, loops, malformed data and more than 20 pages fail the read.
- Only USD depository checking/savings accounts and their transactions are exposed. The UI displays the selected count and total linked count. The first supported checking account is named in the forecast; other checking accounts are not combined into it.
- Decimal dollar values become exact safe integer cents. Plaid debits become negative amounts and credits positive amounts. Null balances, fractional cents and unsafe values fail the read; current balance is never substituted for available balance.
- A posted transaction replaces only its linked pending record. Remaining pending records have `availableBalanceEffect: unknown`: a typical institution convention is insufficient evidence that a particular hold is included. The forecast flags these cases as incomplete and does not silently subtract them twice or count pending income as confirmed money.
- Balance observation time is the read start, or an explicit provider balance update timestamp when available. The last successful Transactions update is retained separately and participates in forecast freshness. Missing/incomplete history and absence of detected monthly bills prevent a confident sufficiency verdict. Completed sync does not establish that every bill or unrecorded expense is known.
- Corrections change the forecast only. They never write to Plaid. Reload or refresh resets corrections and chat; the date basis is the observation's actual evaluation time, rather than the synthetic demo's fixed September 8 clock.

## Consistent reads and failure behavior

New observations are cached for one minute with concurrent requests sharing one in-flight read. A failed read has a ten-second retry cooldown and never publishes a partial snapshot. Up to 16 immutable observations are retained in process memory for 15 minutes. The browser sends an opaque observation ID with corrections and chat; the server looks up that snapshot and never accepts client-provided balances or transactions. These IDs are not Plaid credentials.

An expired observation or server restart requires refresh. Failed refresh leaves the previous observation visible with an explicit error, retaining its original timestamps. The app never replaces failed Plaid reads with fixture balances. Corrections and scripted chat use the same observation and evaluation time. `/sandbox` currently uses the mock assistant even if the synthetic demo has a live model configured; live Sandbox Strands verification remains pending.

## Verification

Backend tests cover money conversion, owner binding, account filtering, complete pagination, mutation recovery, pending replacement, missing balances, stale/incomplete history, immutable observations, refresh failures, correction/chat consistency, and refusal to apply simulated transfers to provider balances. Default browser tests use explicit test responses and never call Plaid.

To run the additional browser check against the configured **actual Sandbox API**, build the app and run from `web` with Chromium installed and port 3003 free:

```sh
npm run build
npx playwright test --config playwright.sandbox.config.ts
```

This opt-in check loads actual test balances and transactions, corrects a detected bill locally, checks agreement between forecast and chat, resets corrections, and inspects desktop/mobile overflow. Screenshots are written to ignored `web/work/plaid-sandbox-1440.png` and `web/work/plaid-sandbox-390.png`. The standard test Item must contain a supported checking account and recurring history.

References: [Plaid account and balance semantics](https://plaid.com/docs/api/accounts/), [Transactions Sync](https://plaid.com/docs/api/products/transactions/#transactionssync), [Item update status](https://plaid.com/docs/api/items/#itemget).
