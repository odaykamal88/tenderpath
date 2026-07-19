# First-client readiness audit — classic service-provider ICP

**Date:** 2026-07-19
**Environment:** Local development build, desktop viewport
**Test tender:** UNICEF RFPS-DAN-2021-503347 / UNGM notice 146988
**Objective:** Determine what blocks a founder-assisted direct service provider from reaching a trustworthy paid submission workflow.

## Executive read

TenderPath's procurement workspace is already differentiated enough to impress a classic ICP. The strongest moments are the RFP workflow, elimination-risk framing, official-notice grounding, and portal-readiness companion. A visual redesign is not the priority.

The current local journey is not ready for an external client because two production dependencies stop the core path:

- the active Anthropic account returned an insufficient-credit error during bid analysis;
- `BLOB_READ_WRITE_TOKEN` was not configured for a private Vercel Blob store, so the three-file tender pack could not finish processing.

The remaining high-priority issues are offer/claims consistency and recovery paths. Today, an AI failure ends in a generic retry message, and the submission workflow still shows free-beta/under-one-hour language that conflicts with the intended paid service.

## Journey audit

### 1. Landing first impression — Yellow

![TenderPath landing page](/Users/odaykamal/Desktop/TENDERPATH/audit/first-client-readiness-2026-07-19/01-landing-first-impression.png)

**Works:** The page is visually credible and specific enough to feel like a procurement product.
**Risk:** “Start winning,” “winning proposal,” “typical win rate,” and “under an hour” imply outcomes or operational guarantees that have not been established. The headline says “Paste any tender,” while the dominant interaction is an invite request.
**Fix:** Align the public promise with bid/no-bid quality, compliance control, evaluator-aligned review, and guided submission.

### 2. Sign-in — Green

![TenderPath sign-in](/Users/odaykamal/Desktop/TENDERPATH/audit/first-client-readiness-2026-07-19/02-sign-in.png)

**Works:** Clear, calm sign-in with magic link, password, and Google options.
**Verify in preview:** Actual email delivery, redirect behavior, and first-session continuity.

### 3. Empty workbench — Yellow

![TenderPath empty workbench](/Users/odaykamal/Desktop/TENDERPATH/audit/first-client-readiness-2026-07-19/03-empty-workbench.png)

**Works:** The reset account showed a genuinely clean state, avoiding demo-profile contamination.
**Risk:** The primary empty-state instruction is to run a company assessment. The classic ICP already has a tender and should be able to start there immediately.
**Fix:** Make tender intake the primary action and company assessment the secondary enrichment path.

### 4. Tender intake — Yellow

![TenderPath paste tender modal](/Users/odaykamal/Desktop/TENDERPATH/audit/first-client-readiness-2026-07-19/04-tender-intake.png)

**Works:** Procurement-specific, low-friction intake from an official notice or pasted content.
**Risk:** “Instant bid/no-bid” and “full paid analysis” do not expose the price, deliverable, turnaround, or fallback when automated analysis is unavailable.
**Fix:** State the exact next output and carry the user into the right format workspace.

### 5. Bid decision — Red

![TenderPath bid decision failure](/Users/odaykamal/Desktop/TENDERPATH/audit/first-client-readiness-2026-07-19/05-bid-decision-failure.png)

**Observed:** The UI returned “Couldn't analyse this tender right now. Please try again.” The server trace showed that the AI provider rejected the call because the account credit was too low.
**Risk:** A live prospect reaches a dead end and loses confidence even though TenderPath could still accept the tender for an assisted review.
**Fix:** Fund the provider and add a retained-data assisted fallback with a case reference and response expectation.

### 6. RFP workspace — Green/Yellow

![TenderPath RFP workspace](/Users/odaykamal/Desktop/TENDERPATH/audit/first-client-readiness-2026-07-19/06-rfp-workspace.png)

**Works:** This is the strongest “wow” moment. The five-step workflow, readiness framing, elimination risks, deliverables, and supplier-controlled sequence feel purpose-built for tender work.
**Risk:** “Free,” “no charge during beta,” and “draft in under 1 hour” conflict with the planned offer and could create an unfulfillable commitment.
**Fix:** Keep the interaction design and align the commercial/turnaround copy.

### 7. Portal companion and tender-pack upload — Yellow/Red

![TenderPath portal companion](/Users/odaykamal/Desktop/TENDERPATH/audit/first-client-readiness-2026-07-19/07-portal-companion.png)

**Works:** Official-notice grounding, the notice-specific channel, seven readiness checks, next-best action, and no-credential promise are all strong trust cues. The UI surfaced a terminal upload error instead of showing false progress.
**Observed:** An amendment PDF, revised TOR DOCX, and Q&A PDF were uploaded. All three failed because the private Blob token was absent.
**Risk:** The workflow cannot reach document extraction, amendment precedence, compliance mapping, payment, or final delivery. The workspace title also clips at this desktop viewport.
**Fix:** Configure private Blob in preview/production, re-run the real files, verify readable/partial/failed truth, then continue the dress rehearsal through payment and delivery.

## Health summary

| Area | Health | Evidence |
|---|---|---|
| Visual/product credibility | Green | RFP workspace and portal companion are procurement-specific and action-oriented. |
| Authentication UI | Green | Clear sign-in; production email delivery still requires verification. |
| Tender-first activation | Yellow | Intake exists, but empty state prioritizes company assessment. |
| Automated bid decision | Red | Provider call blocked by insufficient credit; no assisted fallback. |
| Private document intake | Red | Blob token absent; three real fixture files failed. |
| Amendment-aware workflow | Yellow | UI and contracts exist; could not verify end to end because upload failed. |
| Offer/payment continuity | Yellow | Workflow exists, but customer-facing copy and exact pilot price are inconsistent. |
| Portal handoff | Green/Yellow | Strong companion; final A–Z handoff awaits successful upload/payment/delivery. |
| Consultancy readiness | Red / deferred | Client-level tenancy and conflict boundaries are not implemented. |

## Technical verification

The following focused smoke suites passed locally:

- `npm run smoke:sprint1`
- `npm run smoke:sprint2`
- `npm run smoke:sprint3`
- `npm run smoke:sprint4`

This indicates the implemented contracts are present, but it does not replace the production-preview walkthrough. External dependencies remain the release gate.

## Accessibility and responsive limits

- Keyboard order, focus trapping, screen-reader labeling, and automated accessibility checks were not completed in this audit.
- Some small uppercase/monospace secondary labels appear low contrast and should be measured before external launch.
- The portal-workspace title clips at the tested desktop viewport.
- No mobile journey was tested. The proposed pilot is deliberately desktop-first.
- Payment, deliverable download, and final compliance-map states could not be audited because the upload/AI dependencies blocked the path.

No accessibility-compliance claim should be made from this visual audit alone.

## Recommendation

Freeze broad visual redesign and consultancy scope. Execute the six-gate workload in `docs/agents/first-client-assisted-pilot-workload.md`, then repeat this exact journey in production preview with a new account, the current tender, successful payment/credit, a versioned deliverable, and supplier-controlled portal handoff.
