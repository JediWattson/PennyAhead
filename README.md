# PennyAhead

*A little saved. A future built.*

PennyAhead helps people turn available cash into progress toward savings and retirement goals. It combines balances, spending commitments and user-selected goals into an explainable savings and Roth IRA contribution plan. Bill forecasting protects the cash needed for everyday life. It is built for the [Agents for Humans hackathon](https://agentsforhumans.devpost.com/), in the Everyday Agents track.

## Project status

Created September 8, 2026; product focus updated September 10. The main experience is **Save and invest**: a synthetic 30-day spending-reserve plan with cash-buffer protection, a high-yield savings goal, limited 2026 Roth contribution checks, editable assumptions, and matching agent explanations. Contributions are previews, with a separate local Roth practice simulation using test money. The supporting bill forecast, monitoring, approved transfer simulations and revocable automation remain available. Chat defaults to a labeled mock assistant and supports live Bedrock when configured. See [the growth-planning contract](docs/GROWTH.md).

The optional [Plaid Sandbox view](docs/PLAID.md) reads actual provider-generated test accounts into balances, transaction history, bill forecasts, savings/Roth planning and selectable mock or live chat. Bills suggests possible savings top-ups, shows what would remain, and explains when to review other options; users decide whether to act in their bank app. This recommendation flow needs no transfer provider. Sandbox spending is estimated from transaction history, with editable suggested buffers and savings targets; Roth income and contribution details are entered separately. The Strands SDK and OpenAI/Bedrock adapters are implemented and tested with a fixture model; **local Bedrock access and model-selected tool calls are verified**. AWS deployment files validate but no public deployment is claimed. [Milestones](MILESTONES.md) distinguish implementation from live integration evidence.

## Run locally

Use Node.js 22.13 or newer with npm. From the repository root:

```sh
npm --prefix web ci
npm --prefix web run dev
```

Open the local URL printed by the server (normally `http://localhost:3000`). No API keys, AWS credentials, or provider accounts are needed. If installation tries to compile Sharp against a system libvips, use `SHARP_IGNORE_GLOBAL_LIBVIPS=1 npm --prefix web ci` to use its packaged binary.

If a restricted environment reports `Watchpack Error: EMFILE` or repeatedly restarts the server, enable polling with `WATCHPACK_POLLING=true npm --prefix web run dev`. Normal local development can use the command above.

The dashboard opens on **Overview**, combining account balances and recent activity, with **Save & invest** and **Bills** tabs beside the chat panel. Select an account card to see its latest transactions; accounts without loaded transactions show an empty state. Switching tabs preserves the selected account, plan inputs, the current demo session and chat.

The default **Save and invest** scenario shows $3,500 available checking and $1,850 savings. Alex's sample profile reserves $2,700 for the next 30 days and $300 as a checking buffer. The plan suggests $150 toward the cash-reserve target and $250 toward the entered Roth goal, leaving $100 extra in checking. Select the **Save & invest** tab, open **Why these amounts?**, ask **How much can I save or invest?**, or edit the plan assumptions to see the decisions change. A planning preview does not change balances or place a contribution.

Roth calculations cover a limited set of ordinary 2026 direct contributions using entered income, age, filing status and contributions across all IRAs. Missing information and phase-out cases require review. The synthetic example uses an entered 30-day budget; Sandbox estimates it from transaction history with optional overrides. The detected-bill chart still covers 14 days. Savings APY is illustrative. The Roth investment preview adds an illustrative stock/bond mix based on reviewed time horizon and risk preferences, with example ETFs and matching chat explanations. It splits the proposed new contribution only; it does not promise returns, rebalance existing holdings, or place orders. [Investment scope and direct-trading path](docs/INVESTMENTS.md). To try a complete local practice flow without brokerage credentials, open **Save & invest → Practice with test money** in the synthetic demo; [practice instructions](docs/INVESTMENTS.md#practice-with-test-money).

Choose **Subscription shortfall**, or open `/?scenario=shortfall`, and select the **Bills** tab to exercise the existing bill-protection flow. Five inferred bills total $183.96 against $148.60 checking, producing a $35.36 shortage. The monitor independently proposes funding subject to a protected savings floor. Explicit approval creates a local simulation; **Simulate success** updates checking to $183.96, and **Simulate failure** releases the reservation. These are not provider transfers. See [monitoring](docs/MONITORING.md), [forecasting](docs/FORECAST.md), and [transfer contracts](docs/TRANSFERS.md).

The other scenarios demonstrate sufficient funds, uncertain payment dates and stale observations. Users can correct bill amounts/dates, exclude a detected bill, change cash-protection settings, inspect activity and reset the simulation. New savings and retirement suggestions are withheld when the balances or spending picture cannot support them.

```sh
npm --prefix web test
npm --prefix web run typecheck
npm --prefix web run lint
npm --prefix web run build
```

The app uses **Next.js App Router**, **React**, **TypeScript**, **shadcn/ui**, and **Tailwind CSS**. The React UI is in `web/components/dashboard.tsx`. TypeScript backend routes are in `web/app/api`, shared provider contracts in `web/lib/contracts.ts`, and the fixture and mock implementations in `web/lib/server`. The development and production commands use standard Next.js on Node.js; the [AWS deployment](docs/DEPLOYMENT.md) uses a persistent host behind CloudFront HTTPS.

Production requires private judge invitations and stays locked when they are not configured. See [private judge access](docs/DEPLOYMENT.md#private-judge-access) for generating links, seven-day browser sessions, and revocation. The gate protects pages and data APIs; it does not enable live AI or money movement.

To run the production build with open access for trusted local testing:

```sh
npm --prefix web run build
PENNYAHEAD_ACCESS_MODE=disabled npm --prefix web start
```

Lint covers application code; the generated UI component library and its mobile helper retain the starter source and are excluded from lint. TypeScript checking includes those components. Validation covers backend/API tests, production browser checks, typechecking, lint, and the production build. The actual Plaid Sandbox check is opt-in. Coverage includes data isolation, recurrence evidence, shortfalls, uncertain dates/amounts, stale observations, pending reconciliation, user corrections, failed updates, API validation, funding constraints, independent monitoring, persistence, concurrency, and alert deduplication. Browser checks include desktop (1440px) and mobile (390px) layouts.

To run the browser checks, install the Chromium test browser once, then build and test the production app. The primary test server uses port 3001; the invitation suite uses port 3003:

```sh
cd web
npx playwright install chromium --only-shell
npm run test:e2e
```

See [integration checkpoints](docs/INTEGRATIONS.md) for model and Dwolla setup. To use the configured Plaid test Item, enable the server-only Sandbox setting and open `/sandbox`; [setup and data boundaries](docs/PLAID.md) describe its separate read-only flow. An optional `read_demo_accounts` WebMCP tool exposes the same visible fixture or Sandbox snapshot in compatible browsers; ordinary browsers work without it. Its browser registration has not been verified in a supported WebMCP context.

## Initial scope

- U.S. checking and savings accounts belonging to the same user.
- Recurring subscription detection and a 14-day balance forecast.
- Background monitoring and alerts for meaningful projected shortages.
- A Strands agent that inspects account data and prepares funding proposals.
- Explicit transfer approval, followed by an optional revocable automation rule with an amount cap and savings minimum.
- Transfer status and a clear activity history.

Use synthetic financial data and clearly labeled sandbox transfers for the hackathon demonstration. During M1a, a clearly labeled deterministic mock assistant reads fixture balances without model credentials. Local M1b verification now includes live Bedrock model-selected tool calls; the public deployment still needs separate validation. Simulated data and settlement must remain identifiable. A provider sandbox integration and a local transfer simulation are different evidence levels.

## Demonstration

1. An upcoming subscription creates a projected checking-account shortfall.
2. Background monitoring alerts the user without requiring a chat message.
3. Strands checks account balances, the savings minimum, and expected transfer arrival.
4. The assistant proposes an exact amount, source, destination, and arrival estimate.
5. The user approves the proposal; the backend enforces its authorization and limits.
6. The current app tracks a clearly labeled local simulated transfer through its resulting status. Provider sandbox verification remains open.

Also demonstrate a savings-minimum restriction and a transfer that would arrive too late. The assistant must explain those cases without claiming the bill is covered.

## Architecture

- **Interface:** account overview, upcoming bills, assistant, approval cards, and activity history.
- **Backend:** deterministic forecast calculations, per-user access controls, transfer authorization, idempotency, and status reconciliation.
- **Background worker:** scheduled monitoring independent of chat; provider webhook processing remains planned.
- **Agent:** Strands Agents SDK with narrow tools for accounts, forecasts, funding proposals. The agent has no money-movement tools.
- **Data integration:** Plaid Sandbox for test balances and transactions; the backend detects monthly bills from this history.
- **Transfer integration candidate:** Dwolla for transfers between the same customer's bank accounts.
- **Deployment target:** a judge-accessible application; evaluate Amazon Bedrock AgentCore once the complete flow is stable.

The application uses **TypeScript** for both frontend and backend, **Next.js App Router** for pages and API routes, and **React with shadcn/ui and Tailwind CSS** for the interface. The implemented live adapter uses the **Strands TypeScript SDK** with explicit **OpenAI** or **Amazon Bedrock** selection. The default mock needs no credentials; local Bedrock tool calls are verified. See [agent setup](docs/AGENT.md) and `web/.env.example`. No API keys or real financial information belong in this repository.

Financial calculations and authorization belong in backend code. Approvals must bind to the exact accounts and amount. Retries and concurrent monitor runs must not duplicate a transfer. Pending transfers must not be presented as money received. Subscription dates and transfer arrival dates are estimates unless confirmed.

See the [architecture diagram](docs/ARCHITECTURE.md), [approval contract](docs/TRANSFERS.md), and [submission draft and video script](docs/SUBMISSION.md).

## Plan and submission

See [MILESTONES.md](MILESTONES.md) for deliverables and completion criteria. Target submission: **September 14, 2026 before 8 p.m. Eastern / 5 p.m. Pacific**.

The submission requires a public licensed repository with setup instructions, a project description, an architecture diagram, AWS Builder ID, and a public demonstration video of at most five minutes. Keep the functioning demo or test build available for judging through October 8. Recheck event requirements before submitting.

## References

- [Hackathon rules](https://agentsforhumans.devpost.com/rules)
- [Hackathon FAQ and synthetic-data guidance](https://agentsforhumans.devpost.com/details/faqs)
- [Hackathon resources and AWS credit request](https://agentsforhumans.devpost.com/resources)
- [Strands Agents SDK](https://strandsagents.com/docs/user-guide/quickstart/overview/)
- [Strands approval interrupts](https://strandsagents.com/docs/user-guide/concepts/interrupts/)
- [Plaid recurring transaction API](https://plaid.com/docs/api/products/transactions/)
- [Plaid Transfer restrictions](https://plaid.com/docs/transfer/creating-transfers/#peer-to-peer-transfers): the documented Transfer product excludes transfers between two accounts held by the same person.
- [Dwolla me-to-me transfers](https://developers.dwolla.com/docs/transfer-money-me-to-me)
- [Dwolla transfer timing](https://developers.dwolla.com/docs/transfer-processing-times)

## License

[MIT](LICENSE).
