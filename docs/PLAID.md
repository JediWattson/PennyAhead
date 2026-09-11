# Plaid Sandbox data in the app

The optional `/sandbox` view reads one operator-configured, synthetic Plaid Item. The original `/` view retains the complete deterministic demo and simulated transfer flow. The Sandbox view has no transfer or automation controls and does not run the synthetic monitor. Local settlement refuses provider observations.

The Bills tab provides a read-only suggestion from the same observation and bill corrections as its forecast. A potential savings top-up covers the larger expected/cautious shortage and considers only same-owner, same-currency savings with verified data after pending and detected savings commitments. It shows the earliest shortfall date and what would remain, asks the user to preserve their emergency reserve and other commitments, and does not assume a bank arrival time. Insufficient or unverified funds lead to review or other options. The scripted assistant explains the same calculation; requesting an explanation cannot create a transfer or pay a bill. No Dwolla integration is required for this suggestion workflow.

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

## Seeded demo activity

The local preview uses a custom Plaid Sandbox Item with the original two supported accounts, balances and 25 transactions, plus 18 operator-authored test transactions. These are returned by Plaid's APIs; the application does not inject them into a provider response. The September 10 seed adds three months of history for mobile, internet, gym and electric bills due September 12–21, recent checking activity, and a matching savings deposit and interest credit. The authored bill merchants are Cedar Wireless, Harbor Home Internet, Summit Athletics, and Northstar Electric. Shopping and income examples use Maple Street Market, Juniper Roasters, Oakridge Design Paycheck, and Riverton Labs Payroll. Savings entries are labeled Transfer to Savings and Savings Interest Credit; none are charges from PennyAhead. The available balances are intentionally fixed test values and do not change when seeding history.

The setup script prepares a private journal by default; `--activate` creates a custom Item, verifies its returned history and balances, then updates the ignored local environment file. It preserves the original Item's access token for recovery. Re-running resumes the recorded Item instead of duplicating it. Uncertain creation or exchange outcomes require reconciliation before retrying. Custom-user creation omits the optional schema version, because an explicit version was rejected by this Sandbox, and requests 180 days so the oldest monthly payment is included. The initial read may need to wait for the additional history.

```sh
node --experimental-strip-types --env-file=.env.local scripts/seed-plaid-activity.mjs
node --experimental-strip-types --env-file=.env.local scripts/seed-plaid-activity.mjs --activate
```

Restart the local app after activation, then refresh `/sandbox`. The seed is dated; it does not manufacture new activity on each page load. A later demo date needs a newly prepared scenario. The default synthetic demo is unchanged. See [Plaid custom test data](https://plaid.com/docs/sandbox/user-custom/) and [Sandbox history options](https://plaid.com/docs/api/sandbox/#sandboxpublic_tokencreate).

For the surplus demonstration, run the same script with `--surplus --activate`. It clones the active activity seed into another custom Sandbox Item with $1,500 available checking, preserving its transaction history and savings balance. It verifies that the planner produces a positive Roth preview before selecting the new Item. A separate ignored journal preserves the prior Item for recovery; it adds no duplicate transactions.

The surplus setup also enables `PENNYAHEAD_SANDBOX_SAMPLE_ROTH=true`. The UI explicitly labels Alex's sample profile: age 30, single, $60,000 annual compensation/modified AGI and $2,500 already contributed to a Roth IRA. These editable values are not supplied or inferred by Plaid. With the September 10 seed, the plan suggests $728.87 toward savings and $250 toward Roth, leaving $521.13 in checking. Normal Sandbox setups without this opt-in still start with unconfirmed Roth details. The weekly-income outlook described below is conditional; only money already available in checking is allocated.

## Data and forecast contract

- The adapter reads `/transactions/sync`, `/item/get` and `/accounts/balance/get`. Sync pages are applied to a candidate snapshot with additions, modifications and removals. A pagination mutation discards the candidate and restarts once from the original cursor; repeated mutation, loops, malformed data and more than 20 pages fail the read.
- Only USD depository checking/savings accounts and their transactions are exposed. The UI displays the supported account count; total and excluded counts remain in the observation metadata. The first supported checking account is named in the forecast; other checking accounts are not combined into it.
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

## Savings and retirement planning

The **Save & invest** tab is available for Sandbox accounts. It reads the same stored observation as balances, forecast and chat, and recalculates after a successful refresh or bill correction. Spending starts with an estimate from posted checking history, plus editable suggested buffers and savings targets. Income and IRA details are requested separately for Roth planning. The planner reserves spending and a checking buffer, then previews savings and Roth contributions. Missing or uncertain data pauses suggestions. This flow does not read investment holdings, open an IRA or execute contributions.


## Rename authored demo merchants

After the weekly-income setup, run `node --experimental-strip-types --env-file=.env.local scripts/seed-plaid-activity.mjs --rename-merchants --activate` from `web`. This clones the active 51-transaction test Item with the distinct descriptions above. It changes no dates, amounts, balances, or transaction counts. Before activation, the script verifies exact returned descriptions, dates and amounts, preserved balances, the four renamed recurring bills, weekly income, and the Roth preview. Its separate ignored journal makes retries resume the same Item and retains the previous token for recovery. Restart the local preview and refresh Sandbox after activation. These names are authored sample data returned by Plaid, not display substitutions in the adapter.

## Weekly income demo

After the surplus seed, run `node --experimental-strip-types --env-file=.env.local scripts/seed-plaid-activity.mjs --weekly-income --activate` from `web`. It creates a new custom Item with eight $500 Friday payroll credits strictly before the setup date, retains the prior 43 transactions and balances, and verifies a detected weekly stream before changing local configuration. The separate ignored journal preserves the preceding Item for recovery. This seed contains 51 transactions; its available checking balance is still $1,500. Seeding test history does not simulate bank settlement.

The adapter retains the provider transaction description as well as the normalized merchant name. Weekly detection needs at least four payroll-like credits, six to eight days apart, with amounts within a 25% range. Median amounts and seven-day recurrence produce explicit future dates. Refunds, transfers and interest descriptions are excluded. Stale/incomplete data, matching pending pay and overdue paydays pause the affected stream. This is a local inference from transaction history, not Plaid's income-verification product, a guarantee of future pay, or proof of Roth eligibility.

Bills shows a separate blue line for expected pay, alongside the original bill-only baseline and daily values. Save & invest shows 30-day incoming pay and the difference from planned spending. Chat uses those same server-computed amounts and dates. Future deposits do not reduce funding gaps or increase today's savings/Roth allocation. The September 11 observation estimates $1,000 over 14 days and $2,500 over 30 days; counts change with the observation date. Once a payday passes without a new posted paycheck, refresh shows that the stream needs review rather than inventing another deposit.

## Clean savings activity

After merchant renaming, run `node --experimental-strip-types --env-file=.env.local scripts/seed-plaid-activity.mjs --clean-savings --activate`. This clones the active Item while preserving checking history and both account balances. Savings receives matching credits for the checking account's authored transfers, labeled `Transfer from Checking`, and one `Monthly Savings Interest` credit of $0.67 at each of the last three completed month ends. This is an authored sample amount, not a calculated yield. The unrelated default credit-card debits and mixed interest entries are removed from the test configuration.

The resulting September 11 seed has 43 checking transactions and four savings transactions (47 total). Exact returned history, balances, recurring bills, weekly income, and the Roth preview are verified before activation. The ignored private journal retains the previous Item for recovery. Updating an existing AWS deployment also requires selecting the verified token in its runtime secret and recreating the container with the refreshed environment. The app continues to display the actual Plaid response without relabeling or hiding transactions.
