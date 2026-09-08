# PennyAhead milestone plan

**Status: M1a, M2 and the local M3a monitoring/proposal flow are implemented.** Live Strands integration (M1b/M3b) awaits credential setup; provider sandbox access and M4–M6 remain open. Dates are targets established on September 8, 2026, not completion claims.

## M1 — Runnable foundation and demo accounts

**Target: September 8**

- [x] Create the repository, license, README, and application skeleton. The Next.js/TypeScript app with shadcn/ui runs locally.
- [x] M1a: Build a local mock assistant that reads balances through the bank-data interface. Clearly label its deterministic responses as mock behavior; no model credentials are required.
- [ ] M1b (credential setup pending): Configure the Strands TypeScript SDK and live model access, replace the mock assistant, and verify a model-selected balance tool call. OpenAI is the selected initial provider, with a provider boundary for Amazon Bedrock later; the secure-key setup flow is not yet verified complete.
- [x] Seed synthetic checking and savings accounts and transaction history with three months of recurring merchant payments. Schedule detection remains in M2.
- [x] Define bank-data and transfer interfaces shared by fixtures and future provider sandboxes. Transfer execution is not implemented.
- [ ] Start Plaid and Dwolla sandbox setup to expose access problems early. [Setup prerequisites](docs/INTEGRATIONS.md) are documented; credentials and live sandbox verification remain pending.

**Local foundation criterion (M1a):** A user can open the app, see two synthetic accounts, and ask the mock assistant about their balances. The UI identifies mock responses and synthetic data.

**Local verification:** The foundation was verified with eight backend/API tests and development/production HTTP checks. The current M3a build passes 44 backend/API tests, nine production checks, TypeScript checking, application lint, and the Next.js production build. Desktop and mobile screenshots have been inspected.

**Live integration criterion (M1b, credential setup pending):** A user can ask the Strands assistant about balances through an actual model-selected tool call. M1a does not count as live Strands verification. M2 and local M3 development may proceed using the mock while M1b remains open; complete M1b before claiming the working agent in the final demonstration.

## M2 — Upcoming bills and shortage forecasting

**Target: September 9. Depends on M1.**

- [x] Detect recurring payments from transaction history.
- [x] Display estimated dates and amounts, with user corrections.
- [x] Calculate a 14-day balance forecast using available funds and upcoming activity.
- [x] Reconcile pending activity without counting it twice.
- [x] Show the projected shortage and the underlying evidence.

**Completion criterion:** A repeatable scenario correctly predicts a subscription shortfall. Focused tests cover sufficient funds, insufficient funds, uncertain dates, and stale account data.

**Verified scenario:** Five inferred monthly bills total $183.96 against $148.60 available checking, producing the first shortfall on September 18 and a maximum shortage of $35.36. Corrections update the chart and mock assistant together. Sufficient-funds, date-uncertainty, stale-data, reconciliation, and invalid-input tests pass. See [the forecast contract](docs/FORECAST.md) for the monthly-only detector, pending semantics, and fixed demo clock.

## M3 — Proactive monitoring and funding proposals

**Target: September 10. Depends on M2.**

- [x] M3a: Run local server monitoring independently of the chat interface, with persisted isolated demo monitors.
- [x] Generate an in-app alert when a meaningful shortage appears.
- [ ] M3b: Give Strands tools to inspect forecasts, compare funding accounts, and check transfer timing. Read-only domain functions are implemented and tested; SDK registration and model-selected calls await M1b.
- [x] Produce a deterministic demo proposal containing amount, source, destination, expected arrival, and remaining savings.
- [x] Suppress duplicate alerts for an unchanged situation, including overlapping checks and local server restarts.

**Completion criterion:** An upcoming bill triggers an alert without user prompting, and the assistant proposes a transfer that respects the user's savings minimum.

**Local demo scope:** The background timer checks every five seconds; the default proposal is $35.36 with $1,814.64 remaining savings. Savings-floor and delayed-arrival cases block the proposal. Alert acknowledgement is not approval. The local flow uses mock decisions and simulated timing, and does not complete the live Strands criterion. See [monitoring and proposal contracts](docs/MONITORING.md) for persistence, concurrency, timing assumptions and deployment limits.

## M4 — Approved sandbox transfers

**Target: September 11. Depends on M3 and provider sandbox access.**

- [ ] Connect the transfer flow to Dwolla's sandbox.
- [ ] Bind approval to exact accounts and amount.
- [ ] Enforce account ownership, available funds, and limits in backend code.
- [ ] Prevent duplicates from repeated clicks, retries, and overlapping monitor runs.
- [ ] Track pending, completed, and failed transfers through provider events.

**Completion criterion:** Approval creates a sandbox transfer whose progress is visible. Declined approvals and duplicate requests cannot create additional transfers.

**Integration checkpoint:** Label any remaining simulation. A local simulation does not complete the provider-integration milestone.

## M5 — Complete product experience and deployment

**Target: September 12–13. Depends on M4.**

- [ ] Finish account overview, bill calendar, approval cards, and activity history.
- [ ] Add an optional revocable automatic-transfer rule with an amount cap and savings floor.
- [ ] Deploy a judge-accessible demo; evaluate AgentCore after the core flow is stable.
- [ ] Provide isolated demo sessions and a resettable scenario.
- [ ] Demonstrate a shortage that is covered.
- [ ] Demonstrate a savings limit that prevents a transfer.
- [ ] Demonstrate a transfer that would arrive too late and requires an alert.

**Completion criterion:** Someone unfamiliar with the project can complete the experience, understand each decision, and distinguish simulated money from real money.

## M6 — Submission package and final verification

**Target: September 13–14. Depends on a demonstrable M5 build.**

- [ ] Freeze features and fix demonstration blockers.
- [ ] Verify installation from the public README.
- [ ] Complete the architecture diagram and project description.
- [ ] Record a public YouTube or Vimeo video of at most five minutes showing the problem, audience, and working flow.
- [ ] Complete the Devpost submission with AWS Builder ID before September 14, 8 p.m. Eastern.
- [ ] Verify every submission link and keep the functioning demo or test build available through October 8.
- [ ] Publish an optional Builder Center post for bonus points after the core submission is ready.

**Completion criterion:** The entry is submitted, every link works, and the video's claims match the implementation.

## Priorities and checkpoints

- Preserve the complete path: background detection → funding proposal → approval → sandbox transfer → outcome.
- If time gets tight, cut automatic transfers, extra notification channels, and visual extras first.
- An agent cannot promise that an external transfer initiated shortly before a charge will arrive in time.
- Keep synthetic records, local simulations, and provider sandbox evidence distinct in the demo and submission.
- Request hackathon AWS credits by **September 11, 2026 at 3 p.m. Eastern / noon Pacific**, while available.
- Event requirements and deadlines: [rules](https://agentsforhumans.devpost.com/rules), [FAQ](https://agentsforhumans.devpost.com/details/faqs), [resources](https://agentsforhumans.devpost.com/resources).
