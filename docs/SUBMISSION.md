# Submission preparation

## Draft description

**PennyAhead — stay a step ahead of your bills.**

For people whose subscription dates do not line up neatly with their checking balance, PennyAhead makes the next two weeks visible. It detects recurring payments from transaction history, shows the evidence and estimated dates, and raises a proactive alert when available checking may run short. Users can correct estimates and set the savings balance they want to protect.

The demonstration starts with $148.60 available checking and five upcoming bills totaling $183.96. The backend proposes $35.36 from savings, subject to a $1,000 floor and arrival before the shortage. The user reviews the exact amount and accounts before approving. Pending money remains pending; the forecast changes only when simulated settlement succeeds. A late arrival or savings restriction blocks the proposal with an explanation. Optional automatic funding uses an explicit, revocable total budget.

The TypeScript application combines Next.js, shadcn/ui, deterministic forecasting, SQLite persistence, and read-only Strands tools. OpenAI and Amazon Bedrock adapters are implemented. **Live model access has not yet been verified, and the currently demonstrated assistant is scripted. Bank data and transfer outcomes are synthetic local simulations; no Plaid or Dwolla sandbox is connected.** Update this paragraph only after evidence exists. A simulated transfer must not be described as a provider sandbox transaction.

## Four-minute video script

| Time | On-screen flow | Narration |
|---|---|---|
| 0:00–0:25 | Accounts and fixed demo label | “Bills can arrive before the money in checking is ready. PennyAhead looks ahead at recurring payments and explains the gap. All accounts in this demonstration are synthetic.” |
| 0:25–0:55 | Forecast and bill evidence | “Five detected bills total $183.96. Checking has $148.60 available; its pending debit is already included. The forecast shows a $35.36 shortage. Dates are estimates and can be corrected.” |
| 0:55–1:30 | Background proposal, then assistant | “The monitor checks without a chat message. It proposes a transfer with exact accounts, amount, savings left and estimated arrival.” Show a verified Strands trace only once live access works; otherwise explicitly call this the mock assistant and disclose the incomplete integration. |
| 1:30–2:10 | Checkbox, approve, pending, simulate success | “Approval is separate from chat. Pending money does not cover the bill. This is local simulated settlement, not a bank transfer. Success updates both balances and the forecast.” |
| 2:10–2:50 | Reset, $1,850 savings floor, delayed timing | “The backend refuses a transfer that breaks the savings floor or arrives too late. The warning remains visible instead of pretending the bill is covered.” |
| 2:50–3:20 | Automatic rule and revoke | “Optional automation requires a capped budget and savings floor. It can be revoked, and failure stops automatic retries.” |
| 3:20–4:00 | Architecture and repository | “Read-only agent tools explain backend evidence. Transactional approval handles races and retries. Provider sandbox integration and production identity remain the next steps.” |

## Required actions before claiming submission complete

- [x] Public MIT repository and local setup instructions: [JediWattson/PennyAhead](https://github.com/JediWattson/PennyAhead).
- [x] Architecture diagram and draft project description prepared.
- [ ] Verify live Strands provider execution and record model-selected tools.
- [ ] Connect and verify the Dwolla sandbox lifecycle, or disclose the missing integration in the final submission.
- [ ] Verify the deployed HTTPS demo, or provide working judge test instructions.
- [ ] Record the final demonstration with claims matching that build; upload a public YouTube or Vimeo video of at most five minutes.
- [ ] Supply the entrant's AWS Builder ID and complete Devpost's required fields/attestations.
- [ ] Verify every submitted URL while signed out and retain the functioning demo or test build through October 8.
- [ ] Submit before September 14, 2026, 8 p.m. Eastern. Recheck the rules before final submission.

No video has been published and no Devpost entry has been submitted by this repository. The optional Builder Center post is deferred until the core entry is ready. The hackathon AWS-credit request deadline is September 11, 3 p.m. Eastern, while credits remain available.

References checked September 8: [rules](https://agentsforhumans.devpost.com/rules), [FAQ](https://agentsforhumans.devpost.com/details/faqs), [resources](https://agentsforhumans.devpost.com/resources).

## Reproducible local walkthrough

With the local production server running, install Playwright Chromium and run `node scripts/record-demo.mjs` from `web`. It records a captioned walkthrough to ignored `web/work/demo-video/pennyahead-local-walkthrough.webm`. This is a silent local draft showing the current simulation, not the final live-agent submission video. Inspect the recording before publishing it.
