# M2 forecast contract

The forecast is deterministic TypeScript executed on the server. The mock assistant reads the same calculations, scenario, and corrections as the dashboard. No model does arithmetic, authorizes a transfer, or changes bank balances.

## Repeatable scenarios

All scenarios use a clearly labeled fixed demo clock: **September 8, 2026, 16:00 UTC**. This is not the current wall clock or a live bank connection.

| Scenario | Expected result |
| --- | --- |
| Subscription shortfall | $148.60 available; $183.96 in estimated bills; first negative balance September 18; ending balance -$35.36. |
| Sufficient funds | $500 available; ending balance $316.04; no projected shortage. |
| Uncertain payment dates | Adobe's observed dates vary from the 16th through the 19th. Expected shortfall begins September 18; the cautious timing can bring it forward to September 16. |
| Stale account data | The account observation is 72 hours behind the demo clock. The projection is displayed with a refresh warning, not presented as actionable current data. |

## Recurring-payment detection

- Reconcile duplicate transaction IDs and pending-to-posted links first. Conflicting copies of the same ID fail validation.
- Group posted debits by account and normalized merchant name. Credits and pending records are not recurrence evidence.
- Require one payment in each of three consecutive months, with no additional same-merchant payments in those months.
- Allow observed payment dates to differ by at most seven days, and the largest amount to be at most 125% of the smallest.
- Use the median date and amount as the estimate. The earliest observed day and largest observed amount define the cautious estimate.
- Preserve end-of-month billing across different month lengths and year boundaries.
- Expose the three underlying transaction IDs, dates, and amounts in the UI. Inferred payments remain estimates, not confirmed subscriptions.

The initial detector handles monthly payments only. Weekly/annual billing, multiple subscriptions at one merchant, merchant identity changes, sparse history, and more complex schedules require later work. A missing past-due payment is flagged for verification and reserved today rather than silently advanced to another month.

## Balance calculation and pending activity

Start with the provider's **available** checking balance. Do not replay historical posted debits against it; they are already reflected in the snapshot. The horizon is 14 calendar days including the demo date, September 8–21 inclusive, in UTC.

Each pending record explicitly declares its effect on the available balance:

- A pending debit already included in available funds is not deducted again.
- A pending debit excluded from available funds is deducted once at the beginning of the forecast.
- A pending incoming credit is excluded from spendable money; if the provider included it in available funds, subtract it from the forecast starting balance.
- Unknown pending treatment makes the forecast incomplete, preventing a sufficient-funds claim.
- A matching pending subscription is not also scheduled as a future debit. Matching uses account, normalized merchant, date proximity (five days), and amount proximity (the larger of $1 or 10%). This is an estimate, not a provider confirmation of bill identity.
- A posted replacement removes only the referenced pending transaction for the same account.

All amounts and arithmetic use safe integer cents. Account and snapshot observation timestamps determine freshness; more than 24 hours old is stale, and future observation timestamps are incomplete. The cautious path uses earlier dates and higher observed bill amounts. No predicted or pending transfer is treated as received money.

## User corrections

A correction binds to an existing detected bill ID and includes an amount, a calendar date, and whether to include the bill. The server rejects unknown/duplicate IDs, invalid dates, fractional or nonpositive cents, amounts over $1,000,000, and dates more than 62 days from the demo clock.

Corrections live in the current browser page's state and are sent with each forecast or assistant request. They are not written to a shared server store, a bank account, or another visitor's session. Changing scenarios clears corrections. Changing scenarios or corrections clears prior chat responses to avoid displaying answers derived from old assumptions. A failed update leaves the previous forecast intact. Reloading resets the demo.

## Evidence boundary

The chart covers detected bills and explicitly reconciled pending activity. It does not predict discretionary spending, fees, unrecorded bills, or future income. A positive result means those detected charges fit the supplied balance; it is not a guarantee that an account will remain positive.

M2 does not complete live Strands integration, independent background monitoring, funding proposals, or provider transfers. The local monitoring and proposal follow-on is documented in [the M3 contract](MONITORING.md); live model access and provider transfers remain separate integration milestones.


## Conditional weekly-pay outlook

The forecast also detects stable payroll-like weekly credit streams from the reconciled checking history. It returns an income schedule and a separate balance-with-income series. The bill-only balances, shortfall status and cautious funding calculation remain the basis for protecting cash already available. The UI's blue line adds expected pay; it is conditional on those deposits arriving. Detection rules and the repeatable provider test setup are documented in [Plaid weekly income](PLAID.md#weekly-income-demo).
