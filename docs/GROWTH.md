# Savings and retirement planning

## Product direction

PennyAhead helps people turn available cash into progress toward savings and retirement goals. Its central question is: **What can I put toward my goals while keeping enough money available for spending?** Bill detection and shortage protection support that decision. They remain part of the product and the demonstration.

The **Save & invest** tab provides an explainable allocation preview for both the synthetic demo and Plaid Sandbox balances. The synthetic example uses the **Save and invest** scenario, offers editable assumptions, calculates a cash-reserve contribution and a Roth IRA contribution, and lets the assistant explain the same backend result. It does not open an account or execute these contributions. The [investment preview](INVESTMENTS.md) illustrates how a proposed Roth contribution could be invested after arrival. Existing bill-funding simulations are separate.

## Repeatable example

Alex's illustrative profile has $3,500 available checking and $1,850 savings. The entered spending budget is $2,700 for the next 30 days, with an additional $300 checking buffer and a $2,000 cash-reserve target. After reserving spending money, $500 remains. The plan proposes $150 toward high-yield savings and $250 toward the entered Roth goal, leaving $100 extra in checking. Total checking after those hypothetical allocations would be $3,100. No ledger changes occur.

The sample Roth profile is age 30, single, $60,000 eligible compensation and modified AGI, with $2,500 of 2026 Roth contributions and no traditional IRA contributions. The modeled remaining contribution room is $5,000. Inputs are visibly labeled illustrative; they are not inferred from a bank feed or from the current user's finances.

## Calculation contract

- Use the current session's server-loaded synthetic balances, including existing simulated transfer reservations and settlement.
- Start from the lower of reported available checking and the forecast's reconciled starting balance. Pending income is never added; unresolved pending debits are reserved by the forecast.
- Reserve the larger of the entered full 30-day spending/extra-commitment total and the cautious detected commitments. The 30-day budget already includes bills, so the bill amount is not added a second time. This is a spending reserve, using entered amounts or the transaction-based estimate described below; the daily bill chart remains a separate 14-day forecast.
- Preserve the entered checking buffer. Only cash above these reserves can be allocated. No existing savings is withdrawn to fund a Roth contribution, and no future paycheck is assumed.
- Evaluate savings freshness and its own detected commitments. Subtract savings earmarked for other goals before counting the rest toward the cash reserve. The effective reserve target is at least the existing monitoring savings minimum.
- Allocate surplus toward the remaining cash-reserve gap first. Then limit a Roth proposal to the remaining surplus, the user's entered contribution goal for this plan, and modeled remaining IRA room. Keep any unused amount in checking.
- Manual synthetic profiles require budget review. The Sandbox starts from automatic estimates without a budget checkbox; short history, stale balances or unreconciled coverage still suppress allocations. Missing retirement details or unreviewed debt/workplace-match priorities suppress only the Roth amount while preserving an otherwise valid savings preview.
- Calculations use integer cents. The illustrative APY applies only to the proposed new savings deposit for one unchanged year, before taxes/fees. It is not a bank quote, a product recommendation, or an investment-return forecast.

## Transaction-based starting budget

Plaid Sandbox defaults to a server-calculated spending estimate from the displayed observation. The estimate uses up to 90 days of posted checking outflows and requires at least 30 days of history. It chooses the largest of the latest 30 days of outflows, all observed outflows scaled to 30 days, and cautious detected bills due within the next 30 days. These amounts are compared, not added. Bill corrections apply to the upcoming-bill floor. Historical debits remain in the cash-outflow estimate even if a bill is disabled.

The estimator deduplicates provider records, excludes future/pending transactions and other accounts, and never subtracts income or refunds from spending. Transfers, debt payments and one-off purchases remain in outflows because the current feed does not establish which can safely be excluded. This conservative starting estimate may overstate ongoing spending and may miss obligations outside the linked checking account. Its evidence count and calculation are visible.

The suggested checking buffer is seven days of estimated spending; the suggested reserve target is three months. These are editable product heuristics, not inferred preferences or a universal recommendation. The [CFPB emergency-fund guide](https://www.consumerfinance.gov/an-essential-guide-to-building-an-emergency-fund/) emphasizes that an appropriate target depends on individual circumstances. Extra commitments and earmarked savings remain editable. Choose **Use my own amounts** to override all three inferred/suggested values, or **Estimate from transactions** to recalculate after refresh. Roth eligibility, tax income and existing IRA contributions are never inferred from deposits.

The plan and chat use the same backend calculation. This change does not add an LLM budget-estimation call or change the separate 14-day bill chart.

For an explicitly selected Sandbox surplus demonstration, `PENNYAHEAD_SANDBOX_SAMPLE_ROTH=true` starts with Alex's labeled, editable sample Roth profile. The [surplus seed](PLAID.md#seeded-demo-activity) uses $1,500 available checking and retains the existing transaction history. This opt-in is separate from income inference: ordinary Sandbox setups still leave Roth details unconfirmed, and no future paychecks are included in available cash. A detected weekly-pay pattern now supplies a separate 30-day income and net-cash-flow outlook; the agent can explain that outlook without allocating unreceived pay.

## Roth scope and sources

The planner supports ordinary direct Roth contributions for **tax year 2026**, using entered compensation and contributions across all traditional and Roth IRAs. The general combined limit is $7,500, or $8,600 at age 50+, capped by eligible compensation. Income at or above the start of the applicable phase-out produces a review requirement; the planner does not calculate reduced limits. Above the upper threshold, no direct Roth amount is proposed. Married filing separately, unknown details and cases requiring spousal eligibility also require review.

This deliberately limited model does not handle conversions, backdoor Roth strategies, rollovers, excess-contribution corrections, or personalized portfolio optimization. A Roth IRA is the account; contributing cash is separate from investing it.

Sources checked September 10, 2026: [IRS contribution limits](https://www.irs.gov/retirement-plans/plan-participant-employee/retirement-topics-ira-contribution-limits), [IRS 2026 income thresholds](https://www.irs.gov/newsroom/401k-limit-increases-to-24500-for-2026-ira-limit-increases-to-7500), [CFPB emergency-fund guide](https://www.consumerfinance.gov/an-essential-guide-to-building-an-emergency-fund/).

## Agent, access and consistency

`get_growth_plan` is a read-only Strands tool. Its inputs come from reviewed form values and the server-bound demo session; the model cannot supply account balances or change eligibility flags through the tool. Scripted chat calls the same calculation and labels its result as a preview. Local Bedrock tool execution is verified separately; fixture-model tests do not establish live model behavior.

The invite gate protects `/api/growth`; the handler also requires the existing random monitor capability. The endpoint reads current balances and settings and checks that they match the displayed context. The browser hides prior suggestions when the context or applied inputs change, waits for monitor settings to synchronize, aborts superseded requests, and rejects late results. Changing plan assumptions clears old chat explanations. API errors show a retry state rather than old allocation amounts.

Plan assumptions are held in the current page and sent only to this app's server for calculation; they reset on reload. No growth plan is saved to the ledger, and repeated previews cannot produce duplicate contributions. The Plaid Sandbox page uses the same planner through `/api/sandbox/growth`, protected by judge access and the current observation capability. Both planning and chat read server-stored balances and corrections for that observation; they never accept browser-supplied balances or create a monitoring/transfer session. Expired observations require a refresh. Sandbox spending, buffer and reserve target start in estimate mode, with income and contribution amounts unconfirmed; bank data is not treated as proof of Roth eligibility. No savings account, stale data or unknown pending effects withhold allocations. A savings account does not need recurring bill history to count toward the reserve, but its freshness, pending effects and overall history coverage are still checked.

## Next milestones

1. Verify the live agent explaining and re-evaluating this plan through actual tool calls.
2. Add saved goals and progress history, with deliberate handling of changing income and obligations.
3. Add explicitly authorized contribution simulation, separate from the existing bill-funding ledger, with destination-specific receipts and pending/failed reconciliation.
4. Connect supported provider accounts and reconcile real observations before claiming provider contributions.

The Roth investment preview now offers illustrative allocations and example securities. Real-money contributions and trading remain unconnected. See [investment scope](INVESTMENTS.md).
