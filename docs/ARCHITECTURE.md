# PennyAhead architecture

```mermaid
flowchart TD
  User[User in a browser] --> UI[Next.js dashboard: savings and retirement plan, accounts, bill protection]
  User --> Gate[Private invitation and signed browser session]
  Gate --> UI
  UI --> Growth[Growth planning API]
  Growth --> Budget[Reviewed 30-day spending, cash goals and 2026 Roth inputs]
  Growth --> Context
  Budget --> Allocation[Deterministic allocation preview]
  Context --> Allocation
  Forecast --> Allocation
  Allocation --> UI
  Tools --> Allocation
  UI --> Session[Random session bearer capability]
  UI --> Chat[Assistant API]
  Chat --> Mode{Configured mode}
  Mode --> Mock[Deterministic mock]
  Mode --> Agent[Strands TypeScript agent]
  Agent --> Model[OpenAI or Amazon Bedrock model adapter]
  Agent --> Tools[Seven read-only tools]
  Mock --> Context[Server-bound session snapshot]
  Tools --> Context
  Fixture[Synthetic bank fixtures] --> Context
  Ledger[Session transfer ledger in SQLite] --> Context
  Context --> Forecast[Deterministic recurrence and 14-day forecast]
  Timer[Independent five-second Node timer] --> Forecast
  Forecast --> Policy[Savings floor, source spendability, arrival and amount checks]
  Policy --> Proposal[Persisted proposal and deduplicated alert]
  Proposal --> UI
  UI --> Approval[Exact approval or explicit bounded rule]
  Approval --> Transaction[SQLite atomic authorization and idempotency]
  Transaction --> Ledger
  UI --> Settlement[Explicit simulated success or failure]
  Settlement --> Ledger
  Ledger --> UI
  UI --> Sandbox[Optional read-only Sandbox view and API]
  Plaid[Plaid Sandbox balances, Transactions Sync and Item status] --> Observations[Bounded immutable provider observations]
  Sandbox --> Observations
  Observations --> Forecast
  Sandbox --> SandboxChat[Scripted chat bound to the displayed observation]
  SandboxChat --> Observations
  Future[Pending: Dwolla sandbox adapter] -.-> Context
  Future -.-> Ledger
```

Only solid-line paths are implemented. The model adapters and Strands runtime are implemented but live model execution awaits credential verification. The Sandbox view reuses the deterministic forecast; it does not enter the synthetic monitor, approval or settlement paths. Dashed Dwolla connections are planned, not operational.

For AWS, the prepared template routes browser HTTPS through CloudFront to a single EC2 container. SQLite is mounted on persistent encrypted host storage. There is no production account authentication, provider outbox, live webhook processing or AgentCore deployment. See [deployment](DEPLOYMENT.md), [forecast](FORECAST.md), [monitoring](MONITORING.md), [agent](AGENT.md) and [transfers](TRANSFERS.md) for the exact boundaries.

Savings and Roth suggestions are calculated from the session context plus entered assumptions. No growth-contribution ledger or provider execution exists yet. Growth planning is synthetic-only; the optional Plaid page remains separate. See [growth planning](GROWTH.md).
