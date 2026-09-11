# Strands assistant

The app installs `@strands-agents/sdk` 1.17.0 and registers read-only tools with strict empty input schemas. The synthetic view has seven: `get_growth_plan`, `get_accounts`, `get_transactions`, `get_forecast`, `compare_funding_accounts`, `check_transfer_timing`, and `get_funding_proposal`. The Plaid Sandbox view has five: `get_growth_plan`, `get_accounts`, `get_transactions`, `get_forecast`, and `get_bill_suggestion`. It never registers the synthetic transfer-proposal or arrival-timing tools. Context binds the displayed observation and owner on the server. Neither prompts nor tool parameters can select an owner or approve money movement.

`PENNYAHEAD_ASSISTANT` explicitly selects `mock` (default), `openai`, or `bedrock`. Copy `web/.env.example` to a private `web/.env.local` and finish secure credential setup before enabling a provider. OpenAI uses the Responses API, `store: false`, a fresh agent per request and the `OPENAI_MODEL` setting (default `gpt-5.4-mini`). Bedrock requires an explicit `BEDROCK_MODEL_ID` and an appropriately restricted AWS credential/role chain. A configured provider failure returns a visible error; it does not masquerade as a successful mock answer.

No client or public environment variable contains a credential. Live execution is bounded to five agent turns, 4,000 output tokens and a 30-second cancellation deadline. Model client timeout is 25 seconds for OpenAI. The public demo request guards are documented in [deployment](DEPLOYMENT.md). Errors do not expose upstream exception bodies.

The UI labels each response's mode and displays an execution trace populated only inside successful tool callbacks. The language model explains evidence; deterministic backend code computes money, feasibility, approval and settlement. A tool trace proves which callback executed, not that every sentence the model generated is correct.

## Evidence boundary

The test suite exercises the **real SDK agent loop with a scripted model fixture**: the model stream requests a tool, Strands dispatches it, then the model receives the result and emits text. A forged owner parameter fails schema validation and is absent from the execution trace. These tests verify wiring and scoping, **not live model reasoning or provider access**.

A local Nova 2 Lite request successfully selected and executed `get_accounts` through Strands and returned the displayed Plaid Sandbox balances. An earlier direct Converse request was denied while AWS verified the account; subsequent app requests succeeded. This proves local Bedrock access and tool execution, not production deployment or general answer accuracy. Additional local browser checks exercised savings-plan, bill and attempted-transfer questions, with completed read-tool traces and no execution capability. Retained local evidence is under `web/work/bedrock-*.json`; repeat these checks when changing the model or prompt. Never count the fixture model as a hackathon live-agent demonstration.

References: [Strands TypeScript quickstart](https://strandsagents.com/docs/user-guide/quickstart/typescript/), [OpenAI provider](https://strandsagents.com/docs/user-guide/concepts/model-providers/openai/), [OpenAI libraries](https://developers.openai.com/api/docs/libraries).

## Savings and retirement focus

`get_growth_plan` reads the same deterministic allocation as the primary dashboard: reviewed spending reserve, cash buffer, savings target and limited 2026 Roth contribution room. The model cannot write these inputs or select securities through the tool. Missing or unsupported details produce review states. Scripted chat uses the same calculation and explains hypothetical allocations; neither path opens accounts or contributes money. See [growth planning](GROWTH.md).

`get_investment_plan` reads the same investment preview displayed below the contribution plan: selected horizon/risk, backend-calculated dollar allocations, example ETFs, optional observed Roth holdings and an explicit unconnected execution state. The model explains these examples; it cannot supply its own ticker, amount, price, order or buying power. Proposed contributions are not settled Roth cash. Observed holdings are not contribution records. See [investment scope](INVESTMENTS.md).

## Local Bedrock testing

The ignored `web/.env.local` selects `PENNYAHEAD_ASSISTANT=bedrock`, `BEDROCK_MODEL_ID=us.amazon.nova-2-lite-v1:0`, `AWS_REGION=us-east-1`, and `AWS_PROFILE=pennyahead`. Both chat views use this server-selected provider; the interface labels live replies as AI and distinguishes Plaid Sandbox data from synthetic fixtures. AWS credentials stay in the existing CLI credential chain. On AWS, omit the local profile and grant the application workload role only the required Bedrock invocation permissions.

If the local login expires, run `aws login --profile pennyahead`, then restart the Next.js server. To restore scripted chat, set `PENNYAHEAD_ASSISTANT=mock` and restart. Browser regression tests explicitly select mock mode, independent of the local provider setting.

Refresh the local Sandbox page and try:

- “What are my balances, and which account has the most available?”
- “Explain my savings and Roth plan, including the next few weekly paychecks.”
- “Can my current balance cover the upcoming bills?”
- “Move $250 to my Roth now.” The agent has no execution tool and must explain that it cannot move money.

Successful live answers include the actual executed tool trace. Requests are independent: each question receives the current displayed snapshot and planner inputs, but earlier chat messages are not sent to the model. Both routes share process-local limits of three concurrent requests, a three-second cooldown per session/observation and 200 requests per UTC day; each request retains the five-turn, 4,000-output-token and 30-second bounds. These are demo limits, not a distributed spending cap.

Tool evidence converts integer-cent fields to formatted USD strings before sending them to the model, and the growth tool includes the deterministic explanation and explicit current-cash versus expected-income labels. This followed live tests that exposed incorrect scaling of raw cent values. Application calculations still use integer cents.

The UI reports AWS account verification separately from a generic provider failure, without exposing upstream details or substituting a mock answer. AWS's rejection says verification normally takes less than two hours and directs the account owner to `aws-verification@amazon.com` if it persists longer. See [Bedrock model access](https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html) and [Nova 2 Converse](https://docs.aws.amazon.com/nova/latest/nova2-userguide/using-converse-api.html).
