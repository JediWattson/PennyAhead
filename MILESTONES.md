# PennyAhead milestone plan

All milestones are initially **not started**. Dates are targets established on September 8, 2026, not completion claims.

## M1 — Runnable foundation and demo accounts

**Target: September 8**

- [ ] Create the repository, license, README, and application skeleton. Project documents are present; the application is not yet implemented.
- [ ] Configure Strands and model access.
- [ ] Seed synthetic checking and savings accounts, transaction history, and subscription schedules.
- [ ] Define bank-data and transfer interfaces shared by fixtures and provider sandboxes.
- [ ] Start Plaid and Dwolla sandbox setup to expose access problems early.

**Completion criterion:** A user can open the app, see two accounts, and ask the Strands assistant about balances through an actual tool call.

## M2 — Upcoming bills and shortage forecasting

**Target: September 9. Depends on M1.**

- [ ] Detect recurring payments from transaction history.
- [ ] Display estimated dates and amounts, with user corrections.
- [ ] Calculate a 14-day balance forecast using available funds and upcoming activity.
- [ ] Reconcile pending activity without counting it twice.
- [ ] Show the projected shortage and the underlying evidence.

**Completion criterion:** A repeatable scenario correctly predicts a subscription shortfall. Focused tests cover sufficient funds, insufficient funds, uncertain dates, and stale account data.

## M3 — Proactive monitoring and funding proposals

**Target: September 10. Depends on M2.**

- [ ] Run monitoring independently of the chat interface.
- [ ] Generate an in-app alert when a meaningful shortage appears.
- [ ] Give Strands tools to inspect forecasts, compare funding accounts, and check transfer timing.
- [ ] Produce a proposal containing amount, source, destination, expected arrival, and remaining savings.
- [ ] Suppress duplicate alerts for an unchanged situation.

**Completion criterion:** An upcoming bill triggers an alert without user prompting, and the assistant proposes a transfer that respects the user's savings minimum.

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
