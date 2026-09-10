# Strands assistant

The app installs `@strands-agents/sdk` 1.17.0 and registers seven read-only tools with strict empty input schemas: `get_accounts`, `get_transactions`, `get_forecast`, `compare_funding_accounts`, `check_transfer_timing`, and `get_funding_proposal`. Context binds the session snapshot and owner on the server. Neither prompts nor tool parameters can select an owner or approve money movement.

`PENNYAHEAD_ASSISTANT` explicitly selects `mock` (default), `openai`, or `bedrock`. Copy `web/.env.example` to a private `web/.env.local` and finish secure credential setup before enabling a provider. OpenAI uses the Responses API, `store: false`, a fresh agent per request and the `OPENAI_MODEL` setting (default `gpt-5.4-mini`). Bedrock requires an explicit `BEDROCK_MODEL_ID` and an appropriately restricted AWS credential/role chain. A configured provider failure returns a visible error; it does not masquerade as a successful mock answer.

No client or public environment variable contains a credential. Live execution is bounded to five agent turns, 4,000 output tokens and a 30-second cancellation deadline. Model client timeout is 25 seconds for OpenAI. The public demo request guards are documented in [deployment](DEPLOYMENT.md). Errors do not expose upstream exception bodies.

The UI labels each response's mode and displays an execution trace populated only inside successful tool callbacks. The language model explains evidence; deterministic backend code computes money, feasibility, approval and settlement. A tool trace proves which callback executed, not that every sentence the model generated is correct.

## Evidence boundary

The test suite exercises the **real SDK agent loop with a scripted model fixture**: the model stream requests a tool, Strands dispatches it, then the model receives the result and emits text. A forged owner parameter fails schema validation and is absent from the execution trace. These tests verify wiring and scoping, **not live model reasoning or provider access**.

Live verification is still pending credentials. To close it, enable the selected provider, ask about balances and the funding plan, and retain the response with its actually executed tool trace. Test a prompt asking the agent to bypass approval; verify no transfer is created. Never count the fixture model as a hackathon live-agent demonstration.

References: [Strands TypeScript quickstart](https://strandsagents.com/docs/user-guide/quickstart/typescript/), [OpenAI provider](https://strandsagents.com/docs/user-guide/concepts/model-providers/openai/), [OpenAI libraries](https://developers.openai.com/api/docs/libraries).

## Savings and retirement focus

`get_growth_plan` reads the same deterministic allocation as the primary dashboard: reviewed spending reserve, cash buffer, savings target and limited 2026 Roth contribution room. The model cannot write these inputs or select securities through the tool. Missing or unsupported details produce review states. Scripted chat uses the same calculation and explains hypothetical allocations; neither path opens accounts or contributes money. See [growth planning](GROWTH.md).
