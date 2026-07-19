# First-client assisted pilot workload

**Status:** Production-preview release rehearsal passed; only the first consented live case remains
**Target user:** A direct provider of professional services bidding as one legal entity
**Delivery mode:** Desktop-first, founder-assisted, one live tender at a time
**Estimated workload:** Technical release work complete; founder delivery target remains within one business day after complete intake

## Verification snapshot — 2026-07-19

The first-client path was exercised locally with the Vercel development environment and the public UNICEF RFPS-DAN-2021-503347 fixture:

- A fresh demo session entered through the tender-first dashboard rather than being forced through company assessment.
- Pasted-notice bid/no-bid analysis returned a conservative evidence-based result and carried the tender into the RFP workspace.
- Three fixture documents—a revised TOR, Q&A, and amendment—uploaded to private Blob storage, extracted, and remained readable only through owner-authorized download routes.
- Filename inference preserved the revised TOR as a TOR and correctly identified the Q&A and amendment.
- The compliance-map provider call is now bounded to 35 seconds with no automatic retries. The interactive scan uses the faster model, balanced document excerpts, structured JSON, exact-quote verification, and a conservative rules fallback.
- The final rehearsal produced four source-verified requirements in under 30 seconds, rejected eight unverifiable model candidates, and truthfully labeled the result `partial`.
- All seven official-notice / portal-handoff checks persisted, and the workflow continued into technical intake with the tender and private pack intact.
- Generic 80-point / 70% RFP scoring claims, assumed 120-day validity, assumed third-expert CV, and other notice-specific defaults were removed. Rubric weights, validity, security, tax treatment, and submission mechanics must now come from the published notice or user confirmation.

### Production-preview release verification — 2026-07-19

The final Preview (`tenderpath-i10kl910h-odaykamal-9099s-projects.vercel.app`)
passed the repeatable `rehearsal:first-client` gate with short-lived customer A,
competing customer B, and admin accounts. The rehearsal proved:

- password authentication for all three roles;
- one and only one founder-issued $0 submission credit, with SLA clock, case
  reference, work order, and non-empty receipt;
- an owner-scoped calibration row at commissioning, including tender metadata,
  system compliance state, vendor action, and a pending outcome hook;
- 404 isolation for competitor order, export, receipt, and access-grant attempts;
- super-admin content denial until the customer grants access to the exact work
  order, plus immediate denial again after revocation;
- two awaited/idempotent review-ready emails recorded as accepted;
- immutable Revision 1 and Revision 2 snapshots, lineage to the customer's
  revision request, and independent downloads for both versions;
- admin email-health configuration and accepted-send visibility;
- cleanup of every tagged customer, order, grant, and test-delivery row.

The deployed browser walkthrough also passed the login → tender-first empty
dashboard → Submissions surface with no client-console errors. A final magic-
link send was accepted by Resend and recorded in the delivery ledger with the
reply-to/unsubscribe metadata path enabled; the restricted send-only Resend key
does not permit provider-side message retrieval.

Still required before accepting the first paid live delivery:

- replace the UNICEF rehearsal with the first consented live tender and representative company evidence pack.
- have the founder approve the customer-specific draft before it is released;
- confirm the supplier completes the final portal checklist, signs, submits,
  and records the official receipt/outcome.

## Confirmed first-10 operating policy — 2026-07-19

- The pilot offer ladder is approved: free shallow compliance check, approximately $150 deep review, $250 RFQ/ITB assisted package, and $400 RFP assisted package. EOI remains a subscription benefit rather than a standalone fee.
- The customer-facing delivery target is **within one business day after the tender pack and company evidence are complete and intake is confirmed**.
- The founder is the sole delivery operator and approves every first-10 deliverable; the dashboard is the shared system of record.
- Service recovery is approved: a late committed draft or a submission rejected because of a compliance error introduced by TenderPath receives a full service-fee refund. Supplier omissions, agency changes after the cutoff, portal outages, late supplier submission, and award outcome are outside this guarantee.
- Self-serve overlap is allowed; a deep managed service is exclusive to one customer per tender lot after acceptance.
- Payment will not block the pilot build. The first cases may use a founder-authorized credit or separately agreed invoice while in-product checkout remains disabled.
- Anthropic, private Vercel Blob, Resend, and submission price variables are confirmed in Preview and Production. A variable being present is not a functional check; each service still needs a live preview exercise.
- Customer-facing contact is `odey@tenderpath.me` with `info@tenderpath.me` as the general, support, privacy, and security contact already reflected in the legal pages.
- Until outreach produces a consented live case, the UNICEF RFPS-DAN-2021-503347 fixture is the release rehearsal.
- The application keeps super admins content-blind until a customer grants
  time-boxed access to one work order. This is an application/operations
  boundary, not a claim that raw database or cloud-platform operators are
  cryptographically unable to access data. Per-tenant envelope encryption and
  external key custody remain a later architecture step.

## Decision

The next release should not try to match the breadth of Loopio, AutogenAI, or RFPIO. It should make one classic TenderPath customer feel that their tender has been understood, de-risked, and converted into an executable submission workflow.

Pause the broader Sprint 5/6 roadmap until this paid path is green. In particular:

- onboard direct service providers first;
- do not sell the consultancy/multi-client workflow before client-level tenancy is implemented;
- do not store supplier-portal credentials or submit on the customer's behalf;
- do not promise a win or present a statistical win probability;
- sell better bid decisions, stronger compliance, evaluator-aligned review, and a controlled submission process;
- preserve human approval: the supplier signs and submits.

## The first-client promise

TenderPath turns a live tender and the supplier's evidence into:

1. a documented bid/no-bid recommendation;
2. an amendment-aware compliance and elimination-risk map;
3. a rubric-aligned review or submission package with cited evidence;
4. a prioritized fix list with owners and dates;
5. a portal-readiness checklist and final supplier-controlled handoff.

The product improves the quality and control of the pursuit. It does not guarantee an award.

## “Slam-dunk” acceptance journey

The first client is ready to invite only when a new account can complete this journey in production preview:

1. Open a founder-sent link and sign in without help.
2. Start with the tender they already have; a company assessment is helpful but is not a prerequisite.
3. Paste the official notice and upload the tender pack into private, owner-scoped storage.
4. See a truthful first read: fit, hard gates, missing documents, amendment state, and why the tender matters.
5. If the AI provider is unavailable, continue through an explicit assisted-review fallback instead of reaching a dead end.
6. See the exact offer, price, turnaround, deliverables, review rounds, and refund/service-credit boundary.
7. Pay or redeem a founder-issued first-submission credit and receive a receipt, case reference, and delivery timeline.
8. Receive a versioned, evidence-cited deliverable and prioritized fixes inside the same work order.
9. Approve the package, complete the portal-readiness checks, and submit through the official supplier portal.
10. Record the outcome and debrief so every pursuit improves calibration.

## Workload

### Gate 0 — Founder decisions and production inputs

**Effort:** Same day once decisions are available
**Owner:** Founder, with TenderPath implementation support

- Confirm the pilot offer, price, turnaround, included revisions, and refund/service-credit rule.
- Fund the active AI provider key for at least 20 instrumented end-to-end runs and set a spend alert.
- Connect a private Vercel Blob store in Preview and Production; sync local development through the normal Vercel environment workflow.
- Confirm the low-ticket payment rail and production price IDs. Card, USDT, or Whish are acceptable; do not require a wire for the subscription or review.
- Confirm the customer-facing support/reply-to address and the operator who approves deliverables.
- Approve the conflict policy for two customers pursuing the same tender or lot.
- Supply one current tender and one representative company evidence pack through a private channel, using synthetic or consented data.

**Recommended pilot offer:**

- Free: shallow compliance-gap check.
- Approximately $150: deep services-RFP adjudication review.
- $250 RFQ/ITB or $400 RFP: assisted drafting/submission package.
- $27/$49 monthly subscription: matching, bid/no-bid, and bundled EOI allowance as already defined by the first-revenue sprint.
- A $3k–$10k founding “bid desk” package should remain a founder-sold custom engagement until one single-tender delivery has proved the workflow. Do not make it the public product yet.

### Gate 1 — Production dependencies green

**Effort:** 0.5–1 day
**Exit:** The health checks and a real preview account prove that authentication, AI, private storage, email, and payment are working.

- Replace or replenish the rejected Anthropic credential.
- Verify private Blob writes, owner-only reads, work-order access grants, and customer-visible access logs.
- Verify magic-link delivery and reply-to behavior through Resend.
- Create and connect the exact Stripe products/prices used by the pilot, or configure the first-submission-credit seam.
- Verify `/api/admin/private-storage-health` and `/api/admin/payment-health` in preview.
- Capture traceable errors and case references for every customer-facing failure.

### Gate 2 — Offer and claims alignment

**Effort:** 0.5–1 day
**Exit:** Every public and in-product promise matches what the team can actually deliver.

- Remove or qualify “winning proposal,” “typical win rate,” and “under an hour” claims that are not evidenced or operationally guaranteed.
- Replace “free beta/no charge” submission copy with the approved pilot offer.
- Put price, turnaround, included deliverables, approval responsibilities, and service-recovery terms next to the purchase decision.
- State that TenderPath augments expert judgment; the supplier remains responsible for approval, signature, and submission.

### Gate 3 — Tender-first continuity

**Effort:** 1–2 days
**Exit:** A prospect arriving with a live tender never has to guess what to do next.

- Make the empty dashboard's primary action start tender intake; keep company assessment as a secondary path.
- Carry pasted notice data into the correct EOI/RFQ/ITB/RFP workspace.
- When automated analysis fails or evidence is thin, offer an assisted-review route with a case reference, response expectation, and retained tender data.
- Show exact next-best actions rather than generic retry messages.
- Preserve the official notice and notice-specific submission channel as authoritative.

### Gate 4 — Trustworthy document intake

**Effort:** 1 day
**Exit:** A real tender pack can be uploaded, read, and explained without silent partial success.

- Verify PDF and DOCX upload/extraction in preview against the representative fixture.
- Prioritize corrigenda and Q&A before scoring the original call.
- Label each document as readable, partially readable, or failed; never silently treat an unreadable file as complete.
- Provide safe replace/retry behavior and operator-visible failure logs.
- Re-run the compliance map whenever a relevant amendment changes.

### Gate 5 — Payment and service delivery

**Effort:** 1–2 days
**Exit:** One paid work order can be accepted, delivered, revised, downloaded, and closed without an off-system workaround.

- Resolve price from one source of truth across marketing, checkout, receipts, and operations.
- Create the work order and SLA clock after successful payment or first-submission credit.
- Use the existing proposal-package output contract and shared PDF renderer for all customer deliverables.
- Keep the review versioned; revisions must not overwrite prior output.
- Give the operator the minimum required, expiring work-order access and log every access.
- Send payment, work-started, delivery-ready, and revision-complete notifications.
- Maintain a manual conflict register until consultancy-grade tenancy and conflict controls exist.

### Gate 6 — Production-preview dress rehearsal

**Effort:** 1 day
**Exit:** Founder signs the release checklist after a fresh-user walkthrough.

- Create a new real account.
- Paste the current official tender notice.
- Upload the representative pack, including amendment and Q&A.
- Complete automated analysis or the assisted fallback.
- Purchase/redeem the exact offer.
- Produce, review, revise, and download the deliverable.
- Complete the portal companion checklist and supplier handoff.
- Confirm calibration logging for tender metadata, system output, vendor action, disqualifier caught, founder reasoning, and outcome hook.
- Test one recoverable failure at each external seam: AI, storage, email, and payment.

## Release gates

All must be true before inviting the first external customer:

- [x] A customer cannot access another customer's match, profile, draft, submission, work order, or proposal package.
- [x] Private documents are not readable through a public Blob URL.
- [x] The tender-first route works from sign-in through official-portal handoff.
- [x] An AI failure has a useful assisted-service fallback.
- [x] An unreadable amendment cannot be mistaken for a reviewed amendment.
- [x] Price, scope, turnaround, revisions, and service recovery are consistent everywhere.
- [x] The credited/paid order is visible to both customer and operator.
- [x] The delivered output is versioned, intake-evidenced, and rendered through the shared proposal-package primitives.
- [x] The supplier approval/signature/submission sequence is guarded in the workflow.
- [x] Every commissioned submission creates an owned calibration record.
- [x] One complete production-preview dress rehearsal has passed from fresh accounts.

## Deliberately deferred

Do not build these before they block a paid case or appear in at least three customer sessions:

- consultancy/multi-client tenancy;
- supplier-portal credential custody or automated final submission;
- CRM, SharePoint, Word, or broad answer-library integrations;
- KMS/envelope-encryption architecture beyond the existing private owner-scoped controls;
- portfolio analytics or generic dashboard modules;
- broad mobile redesign;
- a new crawler/browser stack when guided upload is sufficient for the pilot;
- a multi-provider AI gateway refactor solely for theoretical flexibility.

## Founder input checklist

Return these decisions without sending credentials or customer documents in chat:

1. **Offer:** exact first sellable SKU, price, turnaround, revisions, and deliverables.
2. **Service capacity:** who performs and who approves the review, plus the maximum live cases per week.
3. **Service recovery:** refund, rework, or credit rule when TenderPath misses its own deadline or introduces a compliance error.
4. **Conflict policy:** recommended starting rule is self-serve overlap allowed; deep managed service exclusive per tender lot after payment.
5. **Payment:** Stripe/card, USDT, Whish, or first-submission credit for the first case; no low-ticket wire.
6. **Production configuration:** active AI funds, private Blob, Resend, Stripe price IDs, and Vercel Preview/Production environment status.
7. **Support identity:** customer-facing email, reply-to, legal entity/contact details, and the named delivery owner.
8. **Test case:** one current tender plus a synthetic or consented company evidence pack shared through a private channel.
9. **First live lead:** once outreach produces interest, share only the tender URL, company URL, buyer objections, and desired deadline until a consented secure workspace exists.

## Success measures for the first ten cases

- Time from sign-in to first credible tender read.
- Percentage completing upload without operator repair.
- Bid/no-bid recommendation accepted or overridden, with reason.
- Disqualifier or compliance gap caught before submission.
- Time from payment to first deliverable.
- Rework rounds and cause.
- Supplier-reported usefulness and trust.
- Submitted, shortlisted, won, lost, cancelled, or disqualified outcome when known.
- Month-2 active status for subscribers.

Awards remain a lagging, externally controlled outcome. Early product success is a faster, better-evidenced decision and a submission with fewer preventable failures.
