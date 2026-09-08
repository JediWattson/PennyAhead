# PennyAhead

*Stay a step ahead of your bills.*

PennyAhead is a proposed U.S. consumer banking assistant for the [Agents for Humans hackathon](https://agentsforhumans.devpost.com/), in the Everyday Agents track. It watches upcoming bills, predicts account shortfalls, and helps move money between a user's own accounts within their approved rules.

## Project status

Project created September 8, 2026. The local application contains two synthetic accounts, recurring bill detection, a 14-day balance forecast, user corrections, and a clearly labeled mock assistant. OpenAI is selected as the initial Strands model provider, with a path to Amazon Bedrock; live model access is still pending. Bank integrations, transfers, background monitoring, and deployment are not yet implemented.

## Run locally

Use Node.js 22.13 or newer with npm. From the repository root:

```sh
npm --prefix web ci
npm --prefix web run dev
```

Open the local URL printed by the server (normally `http://localhost:3000`). No API keys, AWS credentials, or provider accounts are needed. If installation tries to compile Sharp against a system libvips, use `SHARP_IGNORE_GLOBAL_LIBVIPS=1 npm --prefix web ci` to use its packaged binary.

If a restricted environment reports `Watchpack Error: EMFILE` or repeatedly restarts the server, enable polling with `WATCHPACK_POLLING=true npm --prefix web run dev`. Normal local development can use the command above.

Try **What are my balances?**, **Why is my available balance lower?**, **Show recent transactions**, or **Will my bills be covered?** The mock reads backend fixture data and forecast calculations; its scripted responses are not live AI. Transfer requests are identified as unavailable.

The scenario selector demonstrates a shortfall, sufficient funds, uncertain payment dates, and stale data. Expand a bill to inspect its history or correct its amount/date. Corrections apply to this page's demo session and the assistant's next answer; reload or reset to return to the original data. The default scenario projects a **$35.36 shortfall**, first appearing **September 18**. See [the forecast contract](docs/FORECAST.md) for calculation rules and limitations.

The fixed September 8 snapshot contains checking with **$148.60 available** and **$179.10 current**, savings with **$1,850.00**, and 19 transactions, including three months of recurring merchant history. A **$30.50 pending debit** is already deducted from available checking. History is a sample, not a complete ledger for reconstructing balances. Reloading clears the browser's conversation; the read-only fixture itself is unchanged.

```sh
npm --prefix web test
npm --prefix web run typecheck
npm --prefix web run lint
npm --prefix web run build
```

The app uses **Next.js App Router**, **React**, **TypeScript**, **shadcn/ui**, and **Tailwind CSS**. The React UI is in `web/components/dashboard.tsx`. TypeScript backend routes are in `web/app/api`, shared provider contracts in `web/lib/contracts.ts`, and the fixture and mock implementations in `web/lib/server`. The development and production commands use standard Next.js on Node.js; public hosting remains an M5 decision.

To run the production build locally:

```sh
npm --prefix web run build
npm --prefix web start
```

Lint covers application code; the generated UI component library and its mobile helper retain the starter source and are excluded from lint. TypeScript checking includes those components. All 28 backend/API tests and four production-browser checks pass, along with typechecking, lint, and the production build. Coverage includes data isolation, recurrence evidence, shortfalls, uncertain dates/amounts, stale observations, pending reconciliation, user corrections, failed updates, and API validation. Desktop (1440px) and mobile (390px) layouts were inspected; neither has horizontal overflow.

To run the browser checks, install the Chromium test browser once, then build and test the production app. The test server uses port 3001, which must be free:

```sh
cd web
npx playwright install chromium --only-shell
npm run test:e2e
```

See [integration checkpoints](docs/INTEGRATIONS.md) for the deferred model setup and Plaid/Dwolla sandbox prerequisites. An optional `read_demo_accounts` WebMCP tool exposes the same visible synthetic snapshot in compatible browsers; ordinary browsers work without it. Its browser registration has not been verified in a supported WebMCP context.

## Initial scope

- U.S. checking and savings accounts belonging to the same user.
- Recurring subscription detection and a 14-day balance forecast.
- Background monitoring and alerts for meaningful projected shortages.
- A Strands agent that inspects account data and prepares funding proposals.
- Explicit transfer approval, followed by an optional revocable automation rule with an amount cap and savings minimum.
- Transfer status and a clear activity history.

Use synthetic financial data and clearly labeled sandbox transfers for the hackathon demonstration. During M1a, a clearly labeled deterministic mock assistant reads fixture balances without model credentials. Live Strands model decisions and tool calls are deferred to M1b and remain required for the final agent demonstration. Simulated data and settlement must remain identifiable. A provider sandbox integration and a local transfer simulation are different evidence levels.

## Demonstration

1. An upcoming subscription creates a projected checking-account shortfall.
2. Background monitoring alerts the user without requiring a chat message.
3. Strands checks account balances, the savings minimum, and expected transfer arrival.
4. The assistant proposes an exact amount, source, destination, and arrival estimate.
5. The user approves the proposal; the backend enforces its authorization and limits.
6. The app tracks the sandbox transfer through its resulting status.

Also demonstrate a savings-minimum restriction and a transfer that would arrive too late. The assistant must explain those cases without claiming the bill is covered.

## Proposed architecture

- **Interface:** account overview, upcoming bills, assistant, approval cards, and activity history.
- **Backend:** deterministic forecast calculations, per-user access controls, transfer authorization, idempotency, and status reconciliation.
- **Background worker:** scheduled monitoring and webhook processing, independent of chat.
- **Agent:** Strands Agents SDK with narrow tools for accounts, forecasts, funding proposals, and authorized actions.
- **Data integration candidate:** Plaid for account data and recurring transactions.
- **Transfer integration candidate:** Dwolla for transfers between the same customer's bank accounts.
- **Deployment target:** a judge-accessible application; evaluate Amazon Bedrock AgentCore once the complete flow is stable.

The application uses **TypeScript** for both frontend and backend, **Next.js App Router** for pages and API routes, and **React with shadcn/ui and Tailwind CSS** for the interface. The planned live agent uses the **Strands TypeScript SDK**, initially with **OpenAI**, while keeping provider selection separate so Amazon Bedrock can be added later. The current mock assistant needs no model access; credential setup and live integration remain pending in M1b. No API keys or real financial information belong in this repository.

Financial calculations and authorization belong in backend code. Approvals must bind to the exact accounts and amount. Retries and concurrent monitor runs must not duplicate a transfer. Pending transfers must not be presented as money received. Subscription dates and transfer arrival dates are estimates unless confirmed.

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
