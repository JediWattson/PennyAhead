# Alpaca Broker Sandbox connection

The application supports read-only connection checks using Alpaca's OAuth client-credentials flow. Open **Save & invest → Brokerage connection → Check Alpaca connection**. A working credential connection is distinct from a verified Roth account and from order execution.

Keep these settings in ignored `web/.env.local`, never a `NEXT_PUBLIC_` variable:

```dotenv
PENNYAHEAD_ALPACA_SANDBOX_ENABLED=true
ALPACA_BROKER_SANDBOX_KEY_ID=your_oauth_client_id
ALPACA_BROKER_SANDBOX_SECRET_KEY=your_oauth_client_secret
# Required if the correct Roth cannot be identified uniquely:
# ALPACA_BROKER_ROTH_ACCOUNT_ID=account_uuid
```

Despite the key/secret variable names retained from initial setup, the current credentials are OAuth client credentials. Basic authentication returned 401; exchanging them at `https://authx.sandbox.alpaca.markets/v1/oauth2/token` succeeded. The app caches the short-lived access token in server memory, coalesces concurrent token requests and refreshes it before expiry. Secrets and tokens never appear in API responses or browser state.

The adapter hardcodes Sandbox hosts and only reads accounts and account trading details. There is no production-host option or order/transfer method. `/api/broker` requires judge access when configured and a current demo-session or Sandbox-observation capability. The browser cannot choose arbitrary account IDs. The account must be independently verified as `account_type=ira`, `account_sub_type=roth`; cash observations never become permission to spend.

Run the read-only check from `web`:

```sh
node --env-file=.env.local --experimental-strip-types scripts/check-alpaca-sandbox.ts
```

## Verified provider state

On September 10, 2026 (September 11 UTC), OAuth token exchange and `GET /v1/accounts` returned 200. The account list was empty. A clearly labeled synthetic Roth test-account creation using `POST /v1/accounts`, `account_type=ira`, `account_sub_type=roth` and `enabled_assets=[us_equity]` returned:

```json
{"code":40310000,"message":"request is forbidden"}
```

The creation request and result are recorded in ignored `web/work/alpaca-roth-creation.json`. No account was created. Do not retry creation blindly after an uncertain response; reconcile the account list and creation journal first. There is no test contribution or order to reconcile yet.

An explicitly requested retry on September 11 UTC first reauthenticated and reconciled the empty account list (both HTTP 200), then returned a clearer account-creation error:

```json
{"code":40010001,"message":"IRA accounts are not allowed for this correspondent"}
```

This HTTP 422 confirms that IRA accounts need to be enabled for the Sandbox correspondent. The retry journal is retained under ignored `web/work/alpaca-roth-retry-*.json`. No account was created. Changing authentication to legacy credentials does not resolve this feature restriction. A support request is prepared below; it has not been sent by PennyAhead.

> Please enable Roth IRA account creation for my Broker API Sandbox correspondent. We are testing PennyAhead, a savings and retirement planning application. Client-credentials token exchange and GET /v1/accounts both succeed with HTTP 200, but creating a synthetic account with account_type=ira, account_sub_type=roth and enabled_assets=[us_equity] returns HTTP 422, code 40010001, “IRA accounts are not allowed for this correspondent.” We only need Sandbox access at this stage.

While waiting, use **Save & invest → Practice with test money** on the synthetic demo (`/`). This local practice ledger needs no credentials and supports contribution arrival/failure and purchase fills/rejection. It is not an Alpaca account or provider execution. See [practice instructions](INVESTMENTS.md#practice-with-test-money).

After access is enabled, verify or create the test Roth, store its account ID if needed, and re-run the connection check. Contribution funding, settled-cash verification, order review and submission remain subsequent steps. The existing Plaid bank Item, sample recommendations and contribution limits are unaffected.

References: [Alpaca authentication](https://docs.alpaca.markets/us/docs/authentication), [IRA enablement](https://docs.alpaca.markets/us/docs/ira-accounts-overview), [account creation](https://docs.alpaca.markets/us/reference/createaccount).
