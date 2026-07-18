# TenderPath Paid Services Sprint Wave

Date: 2026-05-13
Owner: Product Validation Lead + Tender Assessment Agent + Tender Dashboard Agent

## Goal

Move Bid/No-Bid, Proposal Draft, and Roster Fast-Track from useful analysis to procurement leverage.

Target service quality: 8.5-9/10.

The 9/10 standard is not "better AI writing." It is:

- The system carries company, tender, evidence, document, deadline, and gap context end to end.
- Paid outputs are grounded in actual source documents and visible evidence.
- Weak inputs trigger honest evidence requests, disqualification, or redirection.
- The dashboard keeps the user inside a procurement workflow, not a report archive.
- Every paid output removes low-value procurement work and leaves only human judgment, pricing, and sign-off.

## Current Honest Baseline

Based on the 15-vendor validation panel:

| Service | Current rating | Current launch position |
| --- | ---: | --- |
| Bid/No-Bid | 7/10 | Controlled paid beta with human QA |
| Proposal Draft | 4.5/10 | Concierge/manual design-partner only |
| Roster Fast-Track | 5.5/10 | Narrow beta for UNGM and supported agencies |

## Principles For The Sprint Wave

1. Context before polish.
   If assessment, match, tender, uploaded docs, and service intake do not land in the same work order, the paid output will feel generic.

2. Evidence before confidence.
   The product must distinguish verified evidence, inferred capability, and missing proof.

3. Document parsing before proposal promises.
   Proposal Draft cannot be premium until uploaded TOR/RFP/vendor guide content drives the compliance matrix and draft structure.

4. Agency/category specificity before Roster pricing.
   Roster Fast-Track must know the target agency, category, portal, documents, caveats, and submission steps.

5. Human QA until automation earns trust.
   The first paid wave should be concierge-backed even where generation is automatic.

## Sprint Wave Overview

Recommended cadence: 6 focused sprints, 1 week each.

| Sprint | Theme | Outcome |
| --- | --- | --- |
| 0 | Validation harness and beta controls | We can measure service quality repeatedly and safely sell beta outputs |
| 1 | Assessment-to-pipeline continuity | Every completed assessment produces dashboard-ready match context |
| 2 | Evidence and document ingestion | Uploaded TOR/RFP/vendor docs become structured service inputs |
| 3 | Bid/No-Bid to 8.5 | Decision memos become source-grounded, sector-aware, and actionable |
| 4 | Proposal Draft to 7.5-8 | Proposal packages become TOR-compliance driven, not generic drafts |
| 5 | Roster Fast-Track to 7.5-8 | Agency/category packs become specific enough for premium beta |
| 6 | Paid-output QA, ops, and launch hardening | Services are observable, reviewable, and safe to charge for |

## Sprint 0: Validation Harness And Beta Controls

### Objective

Make the validation process repeatable before making the product more complex.

### Why This Comes First

The existing `scripts/prospect-match-smoke.ts` is conceptually useful, but during validation it stalled locally without enough bounded progress. We need a fast, non-mutating audit harness that can run against real prospect panels and produce comparable scoring.

### Scope

- Build a deterministic service-validation CLI.
- Add per-profile timeouts and progress logs.
- Output JSON and XLSX/CSV summaries.
- Use the 15-vendor validation panel as the first fixture.
- Add a beta safety flag for paid services.
- Add admin visibility for paid work orders awaiting human QA.

### Likely Files

- `scripts/prospect-match-smoke.ts`
- `scripts/phase4-launch-qa.ts`
- `scripts/`
- `src/app/admin/work-orders/page.tsx`
- `src/app/api/admin/work-orders/route.ts`
- `src/lib/work-orders.ts`

### Acceptance Criteria

- `npm run validation:paid-services -- --panel path.csv` completes within a bounded time.
- Output shows assessment quality, match count, actionable top matches, service context completeness, and failure category.
- Each profile has a clear result: coverage issue, metadata issue, scoring issue, context issue, or service-output issue.
- Admin can filter work orders by plan, payment status, generation status, and QA status.

### Product Gate

No broader paid rollout until the validation harness can score a real 15-vendor panel in one pass.

### Kickoff Status - 2026-05-13

Implemented:

- Added `scripts/paid-services-validation.ts`, a non-mutating paid-service validation harness with per-profile live-match timeouts, static mode, JSON output, and CSV output.
- Added the frozen 15-vendor validation fixture at `data/validation/paid-services-panel.csv`.
- Added `npm run validation:paid-services` and `npm run validate:paid-services`.
- Added admin work-order filters for plan, payment status, generation status, and derived QA status.

First runs:

- Full static panel: `outputs/paid-services-validation/sprint0-full-static.json`
  - 15 checked
  - 1 ready for beta
  - 13 need human review
  - 1 blocked
  - Median paid-service readiness: 7.2/10
  - Median procurement effort collapsed: 6.6/10
- Live first-wave sample: `outputs/paid-services-validation/sprint0-live-first3.json`
  - VP-01 blocked because live matches were actionable but off-profile
  - VP-02 blocked by bounded live-match timeout
  - VP-03 ready for beta as a logistics Bid/No-Bid case
  - Sprint 0 live gate did not pass yet

Immediate Sprint 0 follow-up:

- Tighten broad consulting match scoring so ReliefWeb/job-style tenders do not over-rank for institutional vendors.
- Make live matching consistently finish inside the validation timeout.
- Push selected tender source URL, match reasons, deadline, and caveats into paid work-order context.
- Keep Proposal Draft and Roster Fast-Track behind human QA until document extraction and agency packs land.

### Sprint 0 Progress - Matching And Runtime Fixes

Implemented after kickoff:

- Separated institutional consulting procurements from individual/job-feed consulting roles.
- Demoted broad consulting matches unless the tender also hits distinctive domain terms.
- Removed grant matching from paid-service validation by default.
- Added `--ids=VP-07,VP-09` targeted harness runs.
- Added validation-time `skipEnrichment` and `skipAdjacent` match options so the service harness measures tender relevance without external source-page fetches or invented adjacent preferences.
- Slimmed broad keyword DB searches so descriptions are queried only for more specific terms.

Updated first-wave live result:

- Output: `outputs/paid-services-validation/sprint0-live-first9-after-runtime-fixes.json`
- VP-01 to VP-09 completed with no timeouts.
- 1 ready for beta, 6 need human review, 2 blocked.
- Bid/No-Bid median paid-service readiness: 8.4/10.
- Proposal Draft median paid-service readiness: 6.7/10.
- Roster Fast-Track median paid-service readiness: 7.0/10.

Interpretation:

- Bid/No-Bid is the only service showing an 8+ path now, but still needs selected tender context and compliance evidence before broader paid rollout.
- Proposal Draft is still not paid-ready because live matching cannot compensate for missing TOR/RFP parsing.
- Roster Fast-Track runtime is no longer the immediate blocker; agency/category pack specificity is.

## Sprint 1: Assessment-To-Pipeline Continuity

### Objective

Make a completed assessment reliably produce visible, actionable dashboard state.

### User Promise

"I finished my assessment and immediately see the tenders that matter, why they match, and what to do next."

### Scope

- Auto-seed top matched tenders into `pipeline_items` after assessment claim/login.
- Preserve source URL, deadline, value, score, match reasons, caveats, geography mode, and assessment ID.
- Add first-dashboard continuity state:
  - latest assessment found,
  - matches persisted,
  - pipeline seeded,
  - empty/no-match state with refresh path.
- Add telemetry for:
  - `assessment_completed`
  - `matches_persisted`
  - `pipeline_seeded`
  - `dashboard_landed`
  - `service_context_started`
- Add explicit no-match diagnostics.

### Likely Files

- `src/lib/assessment/run.ts`
- `src/app/api/assessment/latest-matches/route.ts`
- `src/app/api/dashboard/pipeline/route.ts`
- `src/app/dashboard/page.tsx`
- `src/app/dashboard/pipeline/page.tsx`
- `src/lib/telemetry/funnel.ts`

### Acceptance Criteria

- A user with a completed assessment sees at least the top persisted matches in dashboard/pipeline without manual refresh.
- Each pipeline card includes deadline, agency, source, fit score, why matched, caveats, and next action.
- Paid service CTAs inherit `pipeline_item_id`, tender title, agency, source URL, assessment ID, and match reasons.
- No completed assessment can silently produce an empty dashboard without a visible diagnostic.

### Product Gate

Bid/No-Bid cannot move beyond controlled beta unless this sprint passes.

## Sprint 2: Evidence And Document Ingestion

### Objective

Make uploaded and linked procurement documents first-class inputs.

### User Promise

"TenderPath actually read the TOR/RFP/vendor guide and used it to produce the paid output."

### Scope

- Parse uploaded PDF, DOCX, and XLSX files from Vault/service intake.
- Extract:
  - eligibility requirements,
  - evaluation criteria,
  - deliverables,
  - submission format,
  - required documents,
  - deadlines,
  - financial template requirements,
  - disqualification rules,
  - agency-specific instructions.
- Store extracted document text and structured requirements.
- Link extracted requirements to work orders and proposal packages.
- Add source coverage status:
  - no source doc,
  - source URL only,
  - uploaded but not parsed,
  - parsed with low confidence,
  - parsed and requirement-ready.
- Show evidence used and missing inputs in service intake before checkout.

### Likely Files

- `src/app/api/dashboard/vault/upload/route.ts`
- `src/app/api/dashboard/vault/route.ts`
- `src/lib/proposal-package/context.ts`
- `src/lib/bid-no-bid/generate.ts`
- `src/lib/bid-no-bid/llm.ts`
- `src/lib/proposal-package/llm.ts`
- `src/lib/db.ts`

### Acceptance Criteria

- Uploading a TOR/RFP makes extracted requirements available to Bid/No-Bid and Proposal Draft generation.
- Service pages show whether TenderPath has enough tender evidence before payment.
- Proposal Draft cannot claim "ready" without source requirements or an explicit low-context warning.
- Extraction failures are persisted and visible from admin/work-order views.

### Product Gate

Proposal Draft cannot be sold as automated until this sprint passes.

## Sprint 3: Bid/No-Bid To 8.5

### Objective

Turn Bid/No-Bid into the first truly paid-ready TenderPath service.

### User Promise

"TenderPath tells me whether this tender deserves my week, and why."

### Scope

- Add a strict pursue / conditional / skip rubric.
- Add source-grounded memo sections:
  - decision,
  - confidence,
  - fit evidence,
  - eligibility blockers,
  - effort estimate,
  - missing proof,
  - why not stronger,
  - next action.
- Add sector-specific intake modules:
  - logistics,
  - M&E/research,
  - health/medical,
  - food/commodity,
  - engineering/construction,
  - ICT/GIS,
  - energy.
- Use extracted tender requirements, pipeline match evidence, and company assessment together.
- Add honest no-bid behavior for weak/ambiguous profiles.
- Add dashboard actions after memo:
  - move to preparing,
  - archive/no-bid,
  - order proposal package,
  - request human review.

### Likely Files

- `src/lib/bid-no-bid/llm.ts`
- `src/lib/bid-no-bid/types.ts`
- `src/lib/bid-no-bid/pdfDoc.tsx`
- `src/lib/bid-no-bid/generate.ts`
- `src/app/dashboard/work-orders/[id]/BidNoBidPanel.tsx`
- `src/app/dashboard/services/ServiceIntakeForm.tsx`

### Acceptance Criteria

- VP-01 to VP-03 style scenarios score at least 60/70 in repeat validation.
- Memo includes quoted or summarized evidence from company profile and tender source.
- Weak inputs produce conditional/no-bid recommendations rather than optimistic language.
- A user can act from the memo without re-entering tender context.

### Product Gate

Bid/No-Bid can become a paid beta SKU when this passes, still with human QA on first cohort.

## Sprint 4: Proposal Draft To 7.5-8

### Objective

Move Proposal Draft from "structured AI draft" to "requirements-driven proposal workbench."

### User Promise

"TenderPath gives me the working proposal package, compliance structure, and missing-doc list so my team can review and finalize."

### Scope

- Build a requirement-to-section compliance matrix.
- Generate technical approach from evaluation criteria and deliverables.
- Add proposal package sections by service type:
  - M&E methodology,
  - health systems technical approach,
  - logistics implementation plan,
  - engineering/construction work plan,
  - ICT/GIS delivery and support model,
  - food safety/product compliance.
- Add company evidence vault integration:
  - capability statement,
  - project references,
  - staff CVs,
  - certifications,
  - policies,
  - financials.
- Produce editable outputs with source notes:
  - technical proposal DOCX,
  - cover letter DOCX,
  - compliance matrix PDF or XLSX,
  - financial template XLSX.
- Add review warnings for unsupported or low-context drafts.

### Likely Files

- `src/lib/proposal-package/generate-proposal.ts`
- `src/lib/proposal-package/llm.ts`
- `src/lib/proposal-package/docx.ts`
- `src/lib/proposal-package/xlsx.ts`
- `src/lib/proposal-package/pdfDocs.tsx`
- `src/app/dashboard/work-orders/[id]/ProposalPackagePanel.tsx`
- `src/app/dashboard/vault/page.tsx`

### Acceptance Criteria

- VP-04 and VP-05 style scenarios reach at least 55/70 after implementation.
- Draft has a visible compliance matrix tied to extracted TOR requirements.
- Output distinguishes completed draft sections, placeholders, assumptions, and missing user-supplied evidence.
- If no TOR/RFP is parsed, service page blocks automated checkout or labels the order as concierge-only.

### Product Gate

Proposal Draft remains concierge-backed until validation consistently reaches 60/70.

## Sprint 5: Roster Fast-Track To 7.5-8

### Objective

Make Roster Fast-Track agency-specific and category-specific enough to justify premium beta pricing.

### User Promise

"TenderPath tells me exactly where to register, what category to choose, what documents to prepare, and what gaps block approval."

### Scope

- Expand agency packs:
  - WHO,
  - FAO,
  - UNOPS,
  - World Bank,
  - AfDB,
  - ADB,
  - GIZ,
  - optional: UNHCR and UNFPA.
- Add category playbooks:
  - food safety advisory,
  - vaccine/cold-chain products,
  - logistics/freight,
  - health systems consulting,
  - M&E/research,
  - renewable energy,
  - GIS/remote sensing,
  - construction/engineering.
- Add UNSPSC/category code recommendations.
- Add unsupported-agency warnings before payment.
- Add roster readiness checklist with:
  - required docs,
  - optional docs,
  - evidence available,
  - evidence missing,
  - submission route,
  - expected friction.
- Produce agency/category-specific capability statement and submission instructions.

### Likely Files

- `src/lib/proposal-package/roster-packages.ts`
- `src/lib/proposal-package/generate-roster.ts`
- `src/lib/proposal-package/llm.ts`
- `src/lib/proposal-package/docx.ts`
- `src/lib/proposal-package/pdfDocs.tsx`
- `src/app/dashboard/work-orders/[id]/RosterWorkspacePanel.tsx`
- `src/app/dashboard/services/ServiceIntakeForm.tsx`

### Acceptance Criteria

- VP-07 to VP-09 style scenarios reach at least 55/70 after implementation.
- MEFOSA routes to FAO/WFP/UNGM food-safety categories without inventing commodity supply capacity.
- PowerGen routes to UNDP/UNOPS/energy categories with developer vs supplier distinctions.
- Beyond Wireless routes to UNICEF/WHO/PQS-aware product evidence requirements.
- Unsupported agencies are blocked or routed to concierge review before payment.

### Product Gate

Roster Fast-Track can be sold only for supported agency/category pairs until coverage expands.

## Sprint 6: Paid-Output QA, Ops, And Launch Hardening

### Objective

Make paid service delivery observable, reviewable, and safe.

### User Promise

"If I paid, I know what is happening, what was produced, what failed, and what to do next."

### Scope

- Add QA status to proposal packages/work orders:
  - generated,
  - human review needed,
  - approved,
  - delivered,
  - needs user input,
  - failed.
- Add admin review queue by service type.
- Add failure dashboards:
  - no assessment,
  - no pipeline item,
  - no source document,
  - parse failed,
  - generation failed,
  - upload failed,
  - email failed.
- Add user-facing work-order states with concrete next action.
- Add regenerate/review controls with attempt limits.
- Add paid output scorecard for internal QA:
  - evidence grounding,
  - compliance coverage,
  - decision clarity,
  - missing inputs,
  - actionability.
- Add post-delivery feedback:
  - useful,
  - missing requirement,
  - wrong fit,
  - too generic,
  - saved time.

### Likely Files

- `src/lib/work-orders.ts`
- `src/lib/proposal-package/persist.ts`
- `src/app/api/dashboard/work-orders/[id]/route.ts`
- `src/app/dashboard/work-orders/[id]/page.tsx`
- `src/app/dashboard/work-orders/[id]/*Panel.tsx`
- `src/app/admin/work-orders/page.tsx`
- `src/lib/email/*`
- `src/lib/telemetry/funnel.ts`

### Acceptance Criteria

- No paid order can fail silently.
- Admin can see every stuck order and why it is stuck.
- User sees a precise status and next action.
- Paid-output feedback is stored and visible for learning review.
- Weekly learning review includes service-output failures, not only match failures.

## Cross-Sprint Data Model Needs

These can be implemented incrementally, but the target model should support:

- `assessment_confidence`
- `crawl_final_url`
- `crawl_render_method`
- `identity_confidence`
- `evidence_snippets`
- `document_extractions`
- `work_order_context_snapshot`
- `service_context_completeness`
- `qa_status`
- `qa_notes`
- `human_review_required`
- `output_scorecard`
- `unsupported_agency_reason`
- `missing_inputs`

## Quality Scorecard For 8.5-9

Every paid output should be scored internally against:

| Dimension | 9/10 standard |
| --- | --- |
| Assessment accuracy | Company identity, sector, capabilities and geography are evidence-backed |
| Context continuity | Assessment, tender, source URL, docs and intake are all present |
| Evidence grounding | Output shows what evidence was used and what was inferred |
| Procurement specificity | Output reflects sector, agency, document and eligibility realities |
| Actionability | User can take the next step without re-reading everything from scratch |
| Trustworthiness | Caveats and confidence are visible, not hidden |
| Effort collapsed | TenderPath removed search, triage, checklist, and first-draft work |

## Beta Packaging During The Sprint Wave

### Bid/No-Bid

Sell as:

"AI-assisted bid/no-bid memo with human QA during beta."

Do not claim:

"Fully automated win decision."

### Proposal Draft

Sell only as:

"Concierge proposal draft for design partners."

Do not self-serve sell until:

- uploaded docs are parsed,
- compliance matrix maps to actual TOR,
- QA state is visible,
- output reliably reaches 60/70 in validation.

### Roster Fast-Track

Sell only as:

"Supported-agency roster readiness beta."

Do not sell broad $749 promise until:

- agency is supported,
- category is supported,
- document gaps are specific,
- submission instructions are portal-specific.

## Immediate Next 10 Tickets

1. Add service-validation harness with per-profile timeout and JSON output.
2. Add `service_context_completeness` calculation for work orders.
3. Auto-seed latest assessment matches into pipeline after dashboard claim/login.
4. Persist source URL and match evidence into `pipeline_items`.
5. Parse uploaded PDF/DOCX/XLSX into `document_extractions`.
6. Feed parsed requirements into Bid/No-Bid and Proposal Draft generation.
7. Add source-coverage warning to service intake pages before checkout.
8. Add sector-specific Bid/No-Bid intake modules.
9. Expand roster agency packs with WHO, FAO and UNOPS first.
10. Add admin QA queue and user-facing stuck/needs-input work-order states.

## Recommended Build Order

1. Sprint 0 and Sprint 1 together if capacity allows.
2. Sprint 2 before any Proposal Draft paid automation.
3. Sprint 3 before broader Bid/No-Bid launch.
4. Sprint 5 before pushing Roster Fast-Track at premium price.
5. Sprint 6 before any public paid push beyond hand-held beta.

## Definition Of Done For The Wave

The wave is successful when:

- The original 15-vendor validation panel can be re-run.
- Strong-fit Bid/No-Bid scenarios score 60+/70.
- Strong-fit Proposal Draft scenarios score 55+/70 and show TOR compliance mapping.
- Adjacent-fit scenarios produce conditional guidance, not optimistic generic outputs.
- Weak/ambiguous scenarios trigger evidence-gated states or honest no-go outputs.
- Every paid work order has visible context, generation status, artifact status, email status, and next action.
- The team can honestly say TenderPath removes procurement work, not just procurement thinking.

## Sprint 0 Progress: Service Handoff Context

Implemented the first paid-service continuity fix: every service order now carries a `service_context` packet inside `work_orders.intake`.

The packet preserves:

- selected pipeline item and source URL,
- tender title, agency, deadline, value, sector and stage,
- saved dashboard match reasons, caveats, fit score and evidence coverage,
- linked assessment profile, capabilities, readiness score and gaps,
- missing inputs needed before fulfillment can be trusted,
- context quality status and score.

This closes a major handoff break from assessment/dashboard into checkout and fulfillment. The generators now receive a concise saved-context summary instead of losing the dashboard rationale, and the admin work-order queue exposes whether the order has source, assessment, and match-reason continuity.

Verification:

- `npm run lint -- src/lib/service-context.ts src/lib/service-orders.ts src/lib/work-orders.ts src/lib/bid-no-bid/generate.ts src/lib/proposal-package/context.ts src/app/admin/work-orders/page.tsx`
- `npx tsc --noEmit --pretty false`

## Sprint 1/2 Progress: Proposal Evidence Guardrails

Implemented the first Proposal Draft quality lift: source evidence is now scored before generation and carried into the paid output.

What changed:

- Added a proposal evidence profile that checks for TOR/RFP depth, source URL, deadline, scope, deliverables, eligibility, required documents, evaluation criteria, submission format, and financial-template signals.
- Fed the evidence profile into requirement extraction and proposal generation so weak source inputs produce conservative drafts with missing-input warnings instead of false confidence.
- Added guardrails that demote compliance status when the source is thin, preserve missing requirements, and add source-quality next steps.
- Increased service-context and intake excerpt depth so uploaded TOR/RFP text can actually influence Proposal Draft output.
- Replaced the older proposal generation API path with the production fulfillment pipeline so dashboard-triggered generation reuses service context, extracted documents, payment state, and package persistence.
- Added source-quality visibility to the proposal dashboard, DOCX output, and compliance-matrix PDF.

Validation snapshot:

- Static first-wave run: `outputs/paid-services-validation/sprint1-static-after-proposal-evidence-guardrails.json`
- VP-01 to VP-09 checked with live matching skipped.
- Median paid-service readiness: 7.8/10.
- Median procurement effort collapsed: 7.4/10.
- Bid/No-Bid median paid-service readiness: 7.8/10.
- Proposal Draft median paid-service readiness moved to 7.3/10 in the static harness.
- Roster Fast-Track median paid-service readiness: 8.1/10.
- Result interpretation: better source honesty and handoff continuity, but not yet enough for self-serve Proposal Draft automation. The remaining gate is full requirement extraction from real TOR/RFP documents plus checkout blocking or concierge routing when source coverage is insufficient.

Verification:

- `npm run lint -- src/lib/proposal-package/evidence.ts src/lib/proposal-package/llm.ts src/lib/proposal-package/generate-proposal.ts src/lib/proposal-package/types.ts src/lib/proposal-package/docx.ts src/lib/proposal-package/pdfDocs.tsx src/lib/service-context.ts src/lib/service-orders.ts src/app/api/proposals/generate/route.ts src/app/dashboard/proposals/[workOrderId]/page.tsx`
- `npx tsc --noEmit --pretty false`
- `npm run validation:paid-services -- --skip-live-matching --limit=9 --out=outputs/paid-services-validation/sprint1-static-after-proposal-evidence-guardrails.json`
- `npx -y -p node@22 -c 'node node_modules/next/dist/bin/next build --webpack'`

Build note:

- The first build failed inside Next/webpack hashing because of stale `.next/cache` minification entries. Clearing the generated cache fixed it; the clean Node 22 build passed.

## Sprint 0 Progress: Pre-Checkout Evidence Warning

Implemented the next continuity guard: service intake now loads the selected dashboard pipeline item before checkout and shows a live fulfillment-context review.

The review warns on:

- missing pipeline tender for bid/proposal services,
- missing source URL,
- missing saved dashboard match evidence,
- missing eligibility/evaluation criteria for Bid/No-Bid,
- missing TOR/RFP detail for Proposal Draft,
- missing deadline,
- missing target agency or agency guide for Roster Fast-Track,
- broken saved source links.

This does not block all orders, because beta fulfillment can still recover some cases manually. It does make the quality risk visible before payment, which is essential for trust and for keeping weak service outputs from being hidden behind optimistic checkout language.

Verification:

- `npm run lint -- src/app/api/dashboard/pipeline/[id]/route.ts src/app/dashboard/services/ServiceIntakeForm.tsx`
- `npx tsc --noEmit --pretty false`

## Sprint 2/6 Progress: Paid Fulfillment Gates

Converted pre-checkout warnings into enforceable service gates.

Changes:

- Added `src/lib/service-fulfillment-gates.ts` as the shared source of truth for paid-service readiness.
- Proposal Draft checkout now blocks if no service intake/work order exists or if source coverage is too thin for a paid draft.
- Proposal Draft orders with partial source coverage can still be paid, but they are routed to human QA and are not auto-generated.
- Roster Fast-Track checkout now blocks unsupported or missing target agencies; supported but weak-context roster orders route to human QA.
- Bid/No-Bid orders without selected tender/source context can be paid but no longer auto-generate without review.
- Card checkout, legacy proposal checkout, USDT verification, dashboard generation, and Stripe webhook fulfillment all use the same gate.
- The checkout page now calls `/api/pay/readiness` and disables card/USDT payment when source context is blocked.
- Direct post-analysis CTAs now route to the service intake page instead of bypassing intake and jumping straight to payment.

Why it matters:

- This closes one of the most damaging trust gaps: TenderPath can no longer accept a Proposal Draft payment and quietly produce a generic output when the TOR/RFP package is missing.
- It also preserves revenue-path continuity for legitimate partial cases: pay is allowed, but fulfillment is marked as human-review instead of pretending automation is ready.

Verification:

- `npm run lint -- src/lib/service-fulfillment-gates.ts src/app/api/pay/checkout/route.ts src/app/api/pay/readiness/route.ts src/app/api/pay/verify-usdt/route.ts src/app/api/proposals/checkout/route.ts src/app/api/proposals/generate/route.ts src/lib/work-orders.ts src/app/pay/page.tsx src/app/dashboard/services/ServiceIntakeForm.tsx src/app/dashboard/analysis/[tenderId]/page.tsx src/proxy.ts`
- `npx tsc --noEmit --pretty false`
- `rm -rf .next/cache && npx -y -p node@22 -c 'node node_modules/next/dist/bin/next build --webpack'`
- `npm run validation:paid-services -- --skip-live-matching --limit=9 --out=outputs/paid-services-validation/sprint2-static-after-fulfillment-gates.json`
- Browser sanity check: `/pay?plan=proposal-draft` now shows blocked fulfillment readiness without a work order and disables card payment.

## Sprint 0 Progress: Assessment To Pipeline Activation

Implemented automatic stored-match pipeline seeding for users whose latest assessment has matched tenders but whose dashboard pipeline is empty.

Changes:

- extracted shared pipeline seeding into `src/lib/pipeline/seed.ts`,
- preserved source URLs and structured match reasons when creating/updating `pipeline_items`,
- added a no-refresh seed path to `/api/assessment/latest-matches`,
- made `/api/dashboard/pipeline` auto-seed from the latest stored assessment before returning an empty pipeline.

This targets the launch-critical activation guarantee: a completed assessment should lead to visible, actionable dashboard state without requiring a hidden refresh action.

Verification:

- `npm run lint -- src/lib/pipeline/seed.ts src/app/api/assessment/latest-matches/route.ts src/app/api/dashboard/pipeline/route.ts`
- `npx tsc --noEmit --pretty false`

## Sprint 0 Progress: Uploaded Document Extraction

Implemented a first extraction layer for uploaded service/vault documents.

What works now:

- PDF text extraction through `pdf-parse`, capped to the first 40 pages per upload,
- DOCX extraction through zipped Word XML,
- XLSX/XLS extraction through ExcelJS workbook reads,
- persisted `document_extractions` records linked by user and file URL,
- vault document linking when a user saves an uploaded file to the document vault,
- service context packet includes extracted document excerpts and extraction caveats,
- bid/proposal/roster generation prompts receive extracted excerpts through the saved service context,
- uploaded requirement document excerpts are appended to tender text before requirement extraction, so compliance matrices and bid/no-bid requirements can use the TOR text,
- intake UI tells users when an upload was extracted, unsupported, empty, or failed.

Important limitation:

- Scanned/image-only PDFs can still return `empty`; images remain `unsupported`. The UI and service context preserve that caveat instead of pretending the file was read.

Verification:

- `npm run lint -- src/lib/documents/extract.ts src/app/api/dashboard/vault/upload/route.ts src/app/api/dashboard/vault/route.ts src/lib/service-context.ts src/app/dashboard/services/ServiceIntakeForm.tsx src/lib/db.ts scripts/migrate.mjs`
- `npx tsc --noEmit --pretty false`
- Smoke-tested PDF extraction against `tenderpath_opportunity_strategy.pdf`: `status=extracted`, `charCount=12354`.

## Sprint 0 Progress: Roster Pack Coverage

Expanded supported Roster Fast-Track agency packs to cover first-wave validation gaps.

Added:

- FAO,
- UNOPS,
- WHO.

Improved:

- free-form agency inference now recognizes FAO, UNOPS, and WHO,
- roster generation now receives agency registration steps and operational caveats, not only required documents and category hints,
- intake placeholder names the newly supported agencies so users know what the beta can handle.

This directly targets the VP-07 to VP-09 failure pattern: roster outputs were not broken because the concept was weak; they were weak because supported-agency context was too narrow and the generator lacked enough agency-specific operating detail.

Verification:

- `npm run lint -- src/lib/proposal-package/roster-packages.ts src/lib/proposal-package/generate-roster.ts src/app/dashboard/services/ServiceIntakeForm.tsx`
- `npx tsc --noEmit --pretty false`

## Sprint 0 Progress: Dependency Security Pass

Patched production advisories surfaced during Sprint 0.

Changes:

- upgraded `next` from `16.2.3` to `16.2.6`,
- upgraded `eslint-config-next` to `16.2.6` to match the framework version,
- upgraded `@anthropic-ai/sdk` to `0.96.0`,
- added an npm override forcing `postcss` to `8.5.10` because Next `16.2.6` still pins a vulnerable nested `postcss@8.4.31`,
- kept `pdf-parse@^2.4.5` from the document extraction work.

Verification:

- `npm audit --omit=dev` -> `found 0 vulnerabilities`,
- targeted ESLint on Anthropic/paid-service/PDF extraction touchpoints,
- `npx tsc --noEmit --pretty false`,
- `npm run build` completed successfully on Next `16.2.6`,
- `npm run validation:paid-services -- --skip-live-matching --limit=3 --out=outputs/paid-services-validation/sprint0-static-post-dependency-patch.json`.

Residual note (resolved in the Sprint 0 confidentiality release):

- The app and Vercel project now both target Node `24.x`, matching the local release runtime.

## Sprint 0 Progress: First-Wave Match Guardrails And Roster Validation

Re-ran the VP-01 to VP-09 live paid-services validation and fixed the measurement/matching issues that were distorting the score.

Changes:

- validation harness now reads supported roster agencies from the real `AGENCY_PACKAGES` catalogue instead of hard-coding FAO, UNOPS and WHO as unsupported,
- Roster Fast-Track validation now treats live tenders as secondary context and judges the paid service on agency/category/document readiness,
- Bid/No-Bid and Proposal Draft validation now require one actionable selected tender, not two generic dashboard matches,
- matching now suppresses ReliefWeb `/job/` sources from company paid-service matching,
- matching now gates narrow profiles by domain: policy/research, M&E, health systems, food safety, SBC/media and cold-chain monitoring,
- generic keyword-only matches such as development, UNGM registration, capacity building and PFM noise no longer create paid-service optimism,
- office-equipment maintenance no longer counts as hard engineering work,
- validation live matching can pass bounded candidate limits so niche scenarios do not stall the sprint gate.

Final first-wave checkpoint:

- Output: `outputs/paid-services-validation/sprint0-live-first9-final-sprint0-checkpoint.json`
- Checked: 9
- Ready for beta: 2
- Needs human review: 7
- Blocked: 0
- Median paid-service readiness: 7.4/10
- Median procurement effort collapsed: 6.8/10
- Bid/No-Bid median readiness: 8.6/10
- Proposal Draft median readiness: 6.5/10
- Roster Fast-Track median readiness: 7.3/10

Interpretation:

- Bid/No-Bid is closest to beta-ready, but still needs selected tender/TOR/capacity evidence to move from useful analysis to decisive paid output.
- Proposal Draft remains the weakest track. The honest blocker is no longer broad match noise; it is missing parsed TOR/RFP requirements and evidence-vault depth.
- Roster Fast-Track improved materially after agency pack fixes, but adjacent product/supplier cases still need legal, financial, certification and product evidence before premium fulfillment feels wow.

Verification:

- `npm run lint -- src/lib/assessment/match.ts scripts/paid-services-validation.ts`
- `npx tsc --noEmit --pretty false`
- `npm run validation:paid-services -- --ids=VP-02 --timeout-ms=15000 --out=outputs/paid-services-validation/sprint0-vp02-after-office-equipment-filter.json`
- `npm run validation:paid-services -- --ids=VP-07 --timeout-ms=15000 --out=outputs/paid-services-validation/sprint0-vp07-after-candidate-bounds.json`
- `npm run validation:paid-services -- --limit=9 --timeout-ms=15000 --out=outputs/paid-services-validation/sprint0-live-first9-final-sprint0-checkpoint.json`
