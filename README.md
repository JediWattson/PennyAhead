# PennyAhead

*Stay a step ahead of your bills.*

PennyAhead is a proposed U.S. consumer banking assistant for the [Agents for Humans hackathon](https://agentsforhumans.devpost.com/), in the Everyday Agents track. It watches upcoming bills, predicts account shortfalls, and helps move money between a user's own accounts within their approved rules.

## Project status

Project created September 8, 2026. This repository currently contains the project brief and milestone plan. The application, bank integrations, model access, and deployment have not been implemented or configured.

## Initial scope

- U.S. checking and savings accounts belonging to the same user.
- Recurring subscription detection and a 14-day balance forecast.
- Background monitoring and alerts for meaningful projected shortages.
- A Strands agent that inspects account data and prepares funding proposals.
- Explicit transfer approval, followed by an optional revocable automation rule with an amount cap and savings minimum.
- Transfer status and a clear activity history.

Use synthetic financial data and clearly labeled sandbox transfers for the hackathon demonstration. Model decisions and tool calls should run for real; simulated data and settlement must remain identifiable. A provider sandbox integration and a local transfer simulation are different evidence levels.

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

Stack and model configuration remain to be selected. No API keys or real financial information belong in this repository.

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
