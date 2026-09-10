# Submission preparation

## Draft description

**PennyAhead — A little saved. A future built.**

People often know they should save for emergencies or retirement but do not know how much they can set aside without leaving themselves short. PennyAhead turns that uncertainty into an explainable next step. It combines account balances, a reviewed spending reserve, cash goals, and Roth contribution details to show how much can go toward savings and retirement. Bill forecasting protects the money needed for everyday life.

The main synthetic example starts with $3,500 available checking and $1,850 savings. After reserving $2,700 for 30 days of spending and a $300 checking buffer, the plan identifies $500 for goals. It proposes $150 toward the cash-reserve target and $250 toward the entered Roth goal, leaving $100 extra in checking. Users can edit the assumptions and ask the assistant to explain the exact same calculation. Missing budget information, stale balances, or unclear Roth eligibility cause the relevant suggestions to pause.

The supporting shortage scenario shows how bill protection works: a $35.36 forecast shortfall produces a separate, explicitly approved funding simulation. Users can inspect pending, completed and failed outcomes. Chat cannot authorize money movement. Savings and Roth allocations are planning previews; they do not open accounts, choose investments or create contributions.

The application uses Next.js, React, TypeScript, shadcn/ui, deterministic calculations, SQLite and seven read-only Strands tools. **The current assistant is scripted. Strands wiring is tested with a fixture model; live model execution remains unverified. The growth planner and transfer demonstrations use synthetic data. A separate read-only Plaid Sandbox view is connected; Dwolla and retirement-provider execution are not connected.** The final video and submission must accurately reflect whatever is verified at that time.

## Four-minute video script

| Time | On-screen flow | Narration |
|---|---|---|
| 0:00–0:25 | Save and invest panel and sample-profile label | “What can I put toward my future without leaving myself short? PennyAhead turns your goals and cash commitments into an explainable next step. This demonstration uses synthetic money.” |
| 0:25–1:00 | Three allocation cards and why section | “$3,500 in checking, $2,700 reserved for spending, and a $300 buffer leave $500. The entered plan directs $150 toward emergency savings and $250 toward a Roth goal, while keeping $100 flexible.” |
| 1:00–1:40 | Ask for plan explanation; edit Roth goal | “The assistant reads the same backend calculation as the dashboard. Changing a goal updates the amounts and clears outdated explanations.” Show an actual Strands trace only after live verification; otherwise disclose the mock. |
| 1:40–2:15 | Unknown filing status, missing budget review | “The app does not infer retirement eligibility from a bank balance. Unclear Roth details pause the Roth amount. An incomplete spending picture pauses the entire allocation.” |
| 2:15–3:00 | Shortfall scenario and bill-funding controls | “Bill forecasting protects the plan. A shortage holds back new contributions. The existing funding simulation requires explicit approval, and pending money stays pending until simulated settlement.” |
| 3:00–3:35 | Return to growth, contribution rules and preview notice | “These are amounts toward user-selected goals. The planner does not select securities or move money. The first version covers a limited set of 2026 direct Roth contribution cases.” |
| 3:35–4:00 | Architecture, public repository and private demo access | “The model explains evidence; backend calculations determine the amounts. Private judge access protects the hosted experience. Live integrations and future contribution execution are separate milestones.” |

## Required actions before claiming submission complete

- [x] Public MIT repository and local setup instructions: [JediWattson/PennyAhead](https://github.com/JediWattson/PennyAhead).
- [x] Growth-focused architecture and local project-description draft.
- [x] Private judge access with reusable tokens and revocable browser sessions.
- [ ] Verify live Strands execution, including the growth-plan tool, and record actual model-selected calls.
- [ ] Verify the deployed HTTPS demo, or provide working judge test instructions.
- [ ] Include a reusable invitation in the submission's testing instructions after confirming the field's visibility. Ensure the sponsor, administrator and all assigned judges can enter.
- [ ] Keep the judging credential and working application available free of charge throughout judging, through October 8, 2026, at 8 p.m. Eastern. Seven-day browser sessions can be renewed with the same invitation.
- [ ] Record the final demonstration and publish a YouTube or Vimeo video of at most five minutes. Keep credentials out of the public video and project story.
- [ ] Supply the entrant's AWS Builder ID and complete Devpost's required fields/attestations.
- [ ] Verify every submitted URL while signed out.
- [ ] Submit before September 14, 2026, at 8 p.m. Eastern. Recheck the rules before final submission.

This is a local submission draft. No video or updated Devpost entry is published by these edits. The optional Builder Center post remains deferred until the core entry is ready. The AWS-credit request deadline is September 11, 3 p.m. Eastern, while credits remain available.

References checked September 10: [rules](https://agentsforhumans.devpost.com/rules), [FAQ](https://agentsforhumans.devpost.com/details/faqs), [resources](https://agentsforhumans.devpost.com/resources).

## Earlier local recording

`web/scripts/record-demo.mjs` records the older bill-shortfall walkthrough using `/?scenario=shortfall`. It remains useful for that supporting flow. It does not record the new growth-focused story above and is not the final submission video.
