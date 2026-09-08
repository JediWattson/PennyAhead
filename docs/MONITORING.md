# M3 local monitoring and proposal contract

M3a implements a **deterministic local demo**. Strands tools are now registered; live model execution remains unverified. Monitoring proposes funding; the separate [approval and local simulation flow](TRANSFERS.md) controls movement.

## Running and demonstrating

Run the usual `npm --prefix web run dev` or production `npm --prefix web start`. Next.js instrumentation starts a server-side timer that evaluates due monitors every five seconds. Opening a page registers an isolated demo monitor. After registration, evaluation continues without chat, browser polling, or an open page. The app polls stored results every two seconds; its GET route never runs a forecast or creates an alert.

The server must remain running. This is a local long-running Node deployment, not a durable cloud scheduler or a serverless background-task guarantee. Before deployment, replace the timer with a scheduled worker and move the state to shared durable storage appropriate to that deployment.

Try these flows:

1. Open the default scenario and wait up to seven seconds. A $35.36 proposal appears without sending a message. It proposes Rainy day savings → Everyday checking, an estimated September 11 arrival before the September 18 shortage, and $1,814.64 remaining in savings above the default $1,000 minimum.
2. Mark the alert as read. Further unchanged checks increment the check counter without creating a new alert or clearing the acknowledgement.
3. Open **Monitoring preferences** and set the savings minimum to $1,850. The proposal becomes blocked; no partial transfer is offered.
4. Restore the minimum to $1,000 and choose delayed timing. The September 22 estimate is too late, so no actionable proposal is displayed.
5. Select sufficient funds to resolve the current risk, or stale data to require a refresh. Corrections and preferences replace obsolete proposals. Pause/resume controls only monitoring, not money movement.
6. Ask **How can I cover the shortfall?** The mock reads the same deterministic funding functions using the visible scenario, corrections, savings minimum, and timing preference.

## Clocks, timing and balances

Monitoring timestamps and retention use wall-clock time. Financial data, forecasts and timing use the fixed September 8, 2026, 16:00 UTC demo clock. Repeated checks deliberately do not advance that financial snapshot.

The synthetic arrival model adds three weekdays for standard timing or ten for delayed timing. It skips weekends only. It does not model holidays, cutoffs, transfer fees, provider availability or actual settlement. These are explicitly labeled demo assumptions, not Dwolla estimates. Arrival must be strictly before the earliest projected shortage date; same-day arrival is rejected because intraday ordering is unknown.

The proposal amount is the larger of the expected and cautious maximum shortages, in integer cents. Any positive shortage is meaningful in this demo; there is no dollar threshold or repeated notification on every check. Date uncertainty uses the earliest projected shortage. Stale or incomplete checking data prevents a proposal even when the old projection appears sufficient.

Funding candidates must be savings accounts owned by the server-scoped demo identity and use the destination's currency. Freshness, integer money, and pending treatment are checked. Pending incoming money is not treated as received; excluded pending debits and the savings account's own detected commitments are reserved. The chosen account must cover the entire shortage while preserving the configured savings floor. Insufficient or unreconciled sources are ineligible. Account fixtures and forecast balances remain unchanged by proposals.

## Persistence, isolation and concurrency

State lives in `web/work/monitor.sqlite` when using the documented npm commands, which set the working directory to `web`. It is ignored by Git. Set `PENNYAHEAD_MONITOR_DB` to an absolute path when running from another directory or coordinating multiple local processes. Browser tests use a separate database. Node 22.13+ includes the built-in SQLite API used here; Node 22 may print its experimental SQLite warning.

Each page receives a random bearer capability for a separate synthetic monitor; the token stays in page memory and is sent through the Authorization header, never a URL. API responses disable caching. Tokens permit reading, configuring and acknowledging only their own monitor. This is local demo isolation, not bank authentication or production authorization. The server chooses the fixed synthetic identity; supplied owner, balance, source or destination fields cannot redirect a proposal.

Reload starts a new demo, consistent with M2's page-scoped corrections. Existing monitors survive a server restart and remain eligible for checks for 24 hours after creation, unless paused. Expired monitors cannot be read or updated and are cleaned up when a new monitor is created. The local demo caps retained monitors at 1,000 and history at 20 alerts per monitor. Pause a monitor before leaving if you want its checks to stop immediately.

SQLite transactions atomically commit the result, next-check time and deduplication fingerprint. Results must match both the configuration revision and prior check counter. Two overlapping workers may calculate the same result, but only one can commit it. Out-of-order configuration revisions are ignored. Changed settings immediately invalidate the current proposal, and an earlier in-flight check cannot reinstate it.

The fingerprint includes the funding decision, amounts, dates, accounts, savings constraints and source eligibility, and excludes check timestamps. Identical results retain their alert and read state. Changed results supersede older alerts; sufficient funds resolves active risk without adding a shortage alert. If the shortage later recurs, it produces a new alert. Pausing clears the proposal and supersedes active alerts.

Failed checks hide the previous proposal and retry on the next interval. A recovered identical result retains its prior alert. The UI hides proposals on failed status reads, failed setting writes, or a heartbeat over 20 seconds old. History remains historical evidence, not a current approval card.

## Read-only agent boundary

`createFundingTools` exposes `inspectForecast`, `compareFundingAccounts` and `checkTransferTiming` against a server-bound owner, snapshot and configuration. `buildFundingPlan` composes those operations and is shared by the monitor and deterministic mock. The Strands adapter now wraps these calculations in read-only tools. Fixture-model SDK-loop tests pass; actual provider-selected calls remain required before claiming live agent behavior.

M4 must independently revalidate exact amount/account approval, ownership, funds, freshness, arrival timing, authorization and idempotency when creating a provider transfer. A displayed proposal or alert acknowledgement is never transfer authorization.

## Verification

Backend/API tests cover funding constraints, timing boundaries, pending income, ownership, source commitments, persistence, concurrency, stale revisions, pause/expiry, isolation, alert resolution/recurrence and error recovery. Production-browser checks cover automatic proposals, preferences, late arrival, acknowledgement, failed writes, mock agreement and responsive layout. An HTTP integration check creates a session, makes no requests for 11 seconds, then observes at least two server checks and exactly one alert.
