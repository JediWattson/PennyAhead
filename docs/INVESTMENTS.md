# Roth investment recommendations

The **Save & invest** tab now follows the contribution plan with an investment preview. The current $250 sample contribution becomes $90 in U.S. stocks, $60 in international stocks and $100 in U.S. bonds. VTI, VXUS and BND are linked examples of these categories, not an optimized or exclusive fund selection. The preview offers brokerage instructions and a target-date-fund alternative. It does not create contributions or orders.

## Practice with test money

Open the synthetic demo at `/`, choose **Save & invest**, and scroll to **Practice with test money**. No brokerage keys or IRA enablement are needed for this local simulation.

1. **Create practice Roth** starts a fictional account at zero, separate from Alex's existing sample holdings.
2. **Review test contribution → Confirm test contribution** records a pending contribution using the current reviewed plan amount.
3. **Simulate contribution arrival** credits test cash; **Simulate contribution failure** leaves cash unchanged and allows another review.
4. **Review simulated purchases → Confirm simulated purchases** reserves settled test cash for the displayed ETF dollar amounts.
5. **Simulate purchase fills** moves reserved cash into sample investments. **Simulate purchase rejection** releases it so the user can review and retry. Buying investments never counts as another IRA contribution.

The default $250 example results in $90 VTI, $60 VXUS and $100 BND. The practice activity list records each attempt and result. Repeated or out-of-order transitions cannot credit funds twice. The UI uses a browser-only ledger without fetches, provider hooks or persistence. Reset, reload, leaving the panel, or changing the plan/session clears progress. Test activity never changes the source forecast, contribution limits, sample holdings or assistant context. The practice panel appears only for synthetic bank data; Plaid Sandbox and Alpaca observations retain their actual provider state.

This is a product-flow simulation, not an Alpaca sandbox execution. It assumes fractional dollar purchases and zero fees and does not model prices, share quantities, partial fills, KYC or provider settlement timing. Real account binding, execution and reconciliation remain unimplemented.

Local practice validation passed 114 unit/API tests and six focused investment browser checks, plus lint, type checking and the production build. Browser checks verified failure/retry, plan-change/reload reset, unchanged forecast values, no POST requests during practice, and desktop/mobile layouts. Screenshots are retained in ignored `web/work/roth-practice-*.png`.

## Calculation and evidence

The backend takes the contribution amount exclusively from the existing cash-first growth plan. It never uses total Roth assets, expected income, cash-equivalent holdings or remaining annual contribution room as buying power. Investment assets live separately from the checking/savings account model and cannot fund bills or change contribution eligibility.

Users review their investment horizon, comfort with losses and other retirement investments. The synthetic demo uses Alex's labeled sample preferences; ordinary Sandbox profiles start unreviewed. These preferences cannot be inferred from bank deposits. Preferences reset on reload, alongside existing plan inputs.

Illustrative model portfolios use 30%, 60% or 80% stocks for cautious, balanced or growth preferences, with the remainder in bonds. Stock exposure is capped at 40% for horizons from five to nine years; horizons shorter than five years require review and show no purchase amounts. Stock dollars are split approximately 60/40 between U.S. and international exposure. These weights are product policy examples, not published optimal allocations or a suitability determination. Largest-remainder rounding conserves every cent. A missing/review profile or zero proposed contribution suppresses purchase amounts.

The same backend result is exposed through `get_investment_plan` to mock chat and Strands. The model has no trading tools. Existing context validation, observation capabilities and cancellation behavior keep old results from being reused after a change. The preview allocates new contribution money only; it does not account for existing positions when choosing weights or rebalance the whole portfolio. Users must review overlap and their full portfolio at the brokerage.

Local validation passed 105 backend/API tests, 36 browser checks, lint, type checking and the production build. Two final local Bedrock browser responses selected `get_investment_plan`, quoted the preview amounts, and explained that contributions and purchases happen at the brokerage. These are sampled live responses, not a guarantee of all model answers. Evidence is retained in ignored `web/work/investment-live-bedrock.json`; no brokerage execution tool exists.

## Holdings

The synthetic growth scenario includes a separate $12,000 sample Roth account, including $500 in cash and cash equivalents. These values are not quotes or real balances. They are never added to the $250 proposed contribution.

For a Sandbox Item linked with Plaid's `investments` product, set `PENNYAHEAD_PLAID_INVESTMENTS=true` alongside the existing Sandbox configuration. The bank adapter requests `/investments/holdings/get`, validates the Item, filters Roth accounts, and joins securities to holdings. It preserves price dates, distinguishes retrieval time from price freshness and rounds fractional-cent valuations for display only. Unsupported currencies, duplicate records and missing securities produce an unavailable holdings state. An Item with no investment accounts produces a disconnected state. Holdings failures are isolated from the checking/savings forecast; no synthetic fallback is inserted into provider data.

The current locally configured Sandbox Item returned `NO_INVESTMENT_ACCOUNTS` in a live read. The parser, successful recorded responses, error isolation and UI are tested; a successful live provider Roth observation is still unverified. The optional flag remains off by default. Plaid observations do not establish settled cash, executable prices or buying power, and investment transactions/history are not loaded in this version.

## Direct trading path

Plaid Investments supplies holdings and activity data; an order-capable brokerage connection is a separate integration. Alpaca documents Roth and traditional IRA support through its Broker API, but IRA functionality must be enabled for the partner account, including Sandbox. Production also has onboarding and commercial requirements. The local project now has working Sandbox OAuth client credentials. Live token exchange and `GET /v1/accounts` both returned 200, with no accounts present. The initial synthetic Roth creation request returned 403. An explicitly requested retry after reconciling the empty account list returned HTTP 422, code `40010001`, `IRA accounts are not allowed for this correspondent`. This confirms the current IRA enablement blocker. No account or order was created. See [Alpaca connection setup](ALPACA-SETUP.md).

The read-only connection adapter and capability-protected `/api/broker` endpoint are implemented. The next provider step is to enable IRA account creation in the brokerage Sandbox. Keep bank-to-IRA contributions and purchases as separate operations. Before an order can be submitted, the server must bind the selected Roth to the authenticated user, verify account/asset eligibility and settled buying power, and produce an expiring price/order preview. The user then reviews the exact account, ticker and amount. Submission needs a unique order identity and reconciliation for pending, partial, rejected, canceled and filled states; a filled purchase must not be recorded as another IRA contribution. Brokerage minimums and fractional-share availability must be checked independently of this dollar-allocation preview. No direct-trading endpoint exists. The practice controls described above operate only on their separate fictional ledger.

Sources checked September 10, 2026:

- [SEC: asset allocation and diversification](https://www.investor.gov/introduction-investing/getting-started/asset-allocation).
- [SEC: target-date funds](https://www.investor.gov/introduction-investing/general-resources/news-alerts/alerts-bulletins/investor-bulletins/target-date-funds-investor-bulletin).
- [Vanguard: ETF portfolio building blocks](https://investor.vanguard.com/investment-products/etfs/etf-investment-options).
- [Plaid: Investments and Sandbox testing](https://plaid.com/docs/investments/).
- [Alpaca: IRA accounts and enablement](https://docs.alpaca.markets/us/docs/ira-accounts-overview).
