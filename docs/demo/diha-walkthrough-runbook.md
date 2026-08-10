# DIHA walkthrough runbook

**Release candidate:** record the deployed commit, Vercel deployment ID, and tag in the release evidence log  
**Private tenant:** `diha-walkthrough@tenderpath.me`  
**Fixture:** `tenderpath-diha-walkthrough-v1`  
**Audience posture:** experienced public-sector and multilateral response teams  
**Chosen path:** include Submissions as a founder-assisted land motion inside the broader response-control story

The tenant and organisation are synthetic. The opportunities and source links are public. Never show or read the private password on screen.

## Seven-minute message spine

| Time | Screen | Say | Show | Next action |
|---|---|---|---|---|
| 0:00–0:45 | Homepage | Expensive response work is fragmented across notices, evidence, people, amendments and approvals. TenderPath augments the response team; it does not replace its judgment. | “Make the right ones count,” invite-only posture, monitored live sources. | Sign in to the private tenant. |
| 0:45–1:35 | Overview | The company file turns accessible evidence into a readiness view. A score is useful only with the blocker and evidence behind it. | Asteria’s 78/100 score, four dimensions, three owned gaps, and the single top move. | Open Matches. |
| 1:35–2:35 | Matches | A match is a qualification lead, not a promise. TenderPath shows the source, deadline, sector/type, reasons and caveats so expert review starts with context. | Ten ranked live opportunities; open the first match and its primary source. | Start the bid/no-bid read. |
| 2:35–3:35 | Decision read | No-bid is valuable. Response merit and market contestability answer different questions and are never blended. | Merit 82/100; contestability Mixed; conditional-bid recommendation; audited-financials caveat. | Open the top gap. |
| 3:35–4:25 | Readiness gaps | Administrative rejection risk is different from a scoring weakness. The next action has an owner and evidence ask. | Signed audit blocker, buyer-verifiable references, safeguarding review date. | Open Submissions. |
| 4:25–6:15 | Submission drawer | This assisted workflow keeps one order object across client and ops surfaces. Amendments and Q&A change the controlled response; revisions do not silently overwrite prior review snapshots. | Correct deadline, Amendment 1, answered Q&A, owned finance action, Revision 1 and latest Revision 2. | Open Revision 2, then return to drawer. |
| 6:15–7:00 | Submission boundary | TenderPath prepares and controls the response workspace. The supplier reviews, approves, signs and submits through the official agency channel. Outcomes feed calibration; cross-pursuit governed knowledge is future direction, not a shipped claim. | Review/approve controls and separate envelopes. Do not approve or submit live. | End on the conditional next action. |

Reserve two minutes after the spine for interruption or questions.

## Presenter annotations

| Screen | Why it matters | Why TenderPath reached this result | What the team does next |
|---|---|---|---|
| Overview | Makes missing evidence visible before bid effort compounds. | Synthetic company evidence supports strong delivery capacity but incomplete financial packaging. | Finance owner uploads the signed audit. |
| Matches | Converts a large feed into a defensible qualification queue. | Sector, capability, geography and primary-source metadata overlap the company file. | Verify buyer eligibility and run bid/no-bid. |
| Decision read | Protects the team from spending on an attractive but weakly contestable or non-compliant pursuit. | Merit is strong; market evidence is thin, so contestability conservatively remains Mixed. | Bid conditionally; resolve the administrative gate first. |
| Gaps | Separates automatic-rejection risk from scoring exposure and low-priority improvement. | Each gap traces to missing synthetic evidence, not an inferred absence presented as fact. | Assign owner and due date; add the evidence to the controlled file. |
| Submission | Keeps amendments, Q&A, versions, envelopes and approvals in one accountable workflow. | Amendment/Q&A are incorporated into Revision 2 while Revision 1 remains inspectable. | Expert reviews; supplier approves, signs and submits. |

## Claims not to make

- Do not promise an award, privileged access, buyer influence or statistical odds of winning.
- Do not describe “Mixed” as hidden knowledge about an incumbent; it is the conservative default when market evidence is thin.
- Do not say TenderPath replaces proposal, BD, legal, finance or technical staff.
- Do not say TenderPath signs declarations, stores portal credentials or performs final agency submission.
- Do not describe organisation collaboration, governed cross-pursuit reuse, repository integration, remote MCP, SSO or assurance features as shipped.
- If deep health is not green, do not say “refreshed daily”; say the recorded fixture remains available and sources are being monitored.
- Pilot timing and price are bounded assisted-delivery terms confirmed at intake, not an enterprise contract promise.

## Safe fixture operations

Run from the release worktree. The credential file remains local, mode `0600`, and is never printed.

```bash
npm run demo:diha:reset -- --credentials=.env.diha.local
npm run demo:diha:reset -- --credentials=.env.diha.local --apply --confirm-email=diha-walkthrough@tenderpath.me
```

The first command is the drift inspection. The second is the scoped restore. Never target `demo@tenderpath.me` or a customer account.

## Event-day route order

1. `https://www.tenderpath.me/`
2. `https://www.tenderpath.me/login`
3. `https://www.tenderpath.me/dashboard`
4. `https://www.tenderpath.me/dashboard/matches`
5. `https://www.tenderpath.me/dashboard/gaps`
6. `https://www.tenderpath.me/dashboard/proposals`

Open only these tabs. Do not run payment, model generation, email delivery, customer-file upload, approve, request-changes or final-submit actions during the stage path.

## Live-to-fallback switch

Switch to the offline walkthrough within 20 seconds if authentication, Neon, the selected primary source or a core dashboard route is unavailable. Use the hotspot once for a venue-network failure; do not debug production on stage. The stored fixture remains readable if AI, email, payment or the crawler worker is degraded, but do not repeat a freshness claim while deep health is red.

## Final 72-hour checklist

- Confirm the deployed tag and Vercel deployment ID against the release evidence log.
- Check shallow and deep health; record source freshness and open-tender count.
- Run the read-only fixture check and one browser walkthrough without reseeding.
- Confirm the selected first-match deadline remains at least 21 days away and its source resolves.
- Keep the offline walkthrough, this runbook, hotspot and tested display adapter with the presenter laptop.
- Disable OS/app updates and disruptive notifications.
- Permit only BLOCK-severity security, authentication, data-loss or demo-path fixes; rerun the entire rehearsal after any exception.

After the event, restore normal deployment cadence, preserve anonymised questions as discovery evidence, and rotate the private credential if it may have been exposed.
