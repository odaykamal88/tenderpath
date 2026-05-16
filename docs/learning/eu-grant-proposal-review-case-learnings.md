# EU Grant Proposal Review — Case Learnings

**Date of session:** 14–15 May 2026
**Reviewer agents:** Product Learning Agent · Tender Assessment Agent · Tender Dashboard Agent
**Status:** Lessons captured. No code changes proposed in this document.

Companion artefacts produced during the case:
- `scripts/build-csim-review-pdf.tsx` — production-aligned review renderer
- `EU-grant-test-CIM-Syrian-Media:/TenderPath_Review_CSIM_EuropeAid_185831_Lot3.pdf` — final deliverable

This document distinguishes **one-off CSIM specifics** from **reusable product lessons**. Where a finding is CSIM-only it is labelled `[case-specific]`. Everything else is intended to generalise.

---

## 1. Case summary

**User.** Early TenderPath user — the Consortium of Syrian Independent Media (CSIM), submitting under EuropeAid/185831/DD/ACT/SY Lot 3 (Media Freedom and Pluralism in Syria). Lead applicant Rozana Media (France); co-applicants Al-Jumhuriya, ARTA, Enab Baladi. The case was run with the TenderPath CEO observing as the proxy buyer for a future productised version of this service.

**Service delivered.** Senior-grade pre-submission concept-note review against a published EU evaluation grid. This maps to the codebase's existing `proposal` and `bid-no-bid` service slugs in [src/lib/service-orders.ts](../../src/lib/service-orders.ts), but at a depth the current automated pipeline does not yet deliver.

**Ask.** Six-stage TenderPath review: call/criteria digestion, high-level fit, section-by-section critique with scoring, targeted rewrites, rejection-risk scan, and ranked fix checklist — packaged as a brand-compliant report for sharing with the consortium.

**Deliverable.** 17-page PDF rendered via the project's own `@react-pdf/renderer` pipeline (same engine as [src/lib/proposal-package/pdfDocs.tsx](../../src/lib/proposal-package/pdfDocs.tsx)). Reference tag `REV-CSIM-001`. Includes scorecard, eligibility position, strengths matrix, evaluation-risk scan, seven priority fixes, three rewrites, RACER indicator examples, submission-day checklist, T-minus timeline, and forward look to the full-application stage.

---

## 2. What worked

### 2.1 Where TenderPath logic / output clearly added value

- **Corrigendum catch.** Corrigendum No. 1 silently changed the Design score from 25 to 30 and tightened the 100% co-financing rule to require a *lead applicant* (not any applicant) established in Syria. A non-expert reading only the original guidelines misses both. This single catch was worth ≥5 evaluation points to CSIM. **Reusable: every EU PRAG call has a corrigendum and a Q&A trail. Most applicants do not re-read these closely.**
- **Priority-to-SO mapping.** Lot 3 names three Priorities; the proposal addressed Priorities 1 and 3 strongly but treated Priority 2 (journalist protection) as a women-only sub-output. This is the most evaluator-visible gap — and it was invisible to the applicant because their internal logic was strong.
- **Mandatory-exclusion gate scanning.** Gender sensitivity was correctly addressed (SO3). Disability sensitivity was entirely absent, including in the cross-cutting paragraph, which directly maps to scoring criterion 2.5 and is part of the EU Disability Strategy alignment expected since 2021. The exclusion gate / scoring penalty distinction matters and was caught.
- **Double-weighted criterion focus.** Criterion 2.1 (intervention logic) is `5×2 = 10`. Identifying that baselines were missing despite a present causal narrative is the kind of finding that compounds into 4 points of exposure. Generic reviewers miss this.
- **Co-financing math.** Rozana being France-registered caps the EU contribution at 90%, not 100%. Co-financing source (~EUR 67,500) becomes a Stage 3 eligibility issue at the full application step if not pre-identified. This is the kind of forward-look insight that justifies the service price.
- **Concrete rewrites.** The three rewrite sections (cross-cutting, risks, theory-of-change baseline table) are drop-in. The user did not have to translate analysis into action.
- **Forward look.** Surfacing the 100-pt full-application grid — including the hard `≥12/20` floor on Section 1 and the double-weighted Efficiency criterion (6.2) — gave the applicant work they can start *in parallel* with the concept-note submission. This is what continuity from `assessment → matched workflow → paid action` (AGENTS.md priority 8) actually looks like at the high end.

### 2.2 Where it saved time

- The case took ~6 hours of senior-reviewer time. Equivalent freelance bid-consultant work on a EUR 675K grant is typically EUR 2,000–5,000 over 2–5 days.
- The branded PDF render was 60.6 KB, generated in <2 seconds once the script was right. Output quality matched production proposal-package aesthetics (same design tokens, same reference-tag convention, same masthead/footer pattern).

### 2.3 Where it improved clarity, trust, next-step direction

- **Severity-coded priority fixes.** `BLOCK` / `HIGH` / `MED` / `LOW` pills on a per-fix basis turned a 6-page review into a one-glance triage list. The CEO-readable version of "what do we do tonight."
- **Per-fix owner and deadline.** `Lead applicant / Finance · by Now` is more useful than "must be addressed." Treats the review as a workflow object, not a report — directly aligned with the AGENTS.md dashboard principle ("readiness gaps as a workflow, not just a report").
- **Estimated current vs achievable score.** `38–41 / 50 → 44–47 / 50` made the value of acting on the review legible. Quantified upside is hard to argue with.

---

## 3. What broke or felt weak

### 3.1 Trust-killers from this session

- **The agent initially dismissed the task as "outside TenderPath scope."** This was wrong. The codebase has `service-orders.ts` defining `proposal` and `bid-no-bid` services, a full `src/lib/proposal-package/` pipeline with `generate-proposal.ts`, `requirements-model.ts`, `evidence.ts`, `bundle.ts`, `docx.ts`, `pdfDocs.tsx`. The user had to push back twice before the agent connected the work it was doing to the product surface that markets it. **This is a brutally important lesson:** agents working without persistent product memory can credibly dismiss their own platform's value proposition.
- **First PDF render had overlapping text and broken tables.** The agent used a one-off Python ReportLab script (`/tmp/build_review_pdf.py`) instead of the existing `@react-pdf/renderer` pipeline. The result was unshippable. **The fix was simple but only happened after the user complained.** No internal validation step caught the formatting failure before sending it to the user.
- **No pre-flight check on existing capability.** Before producing output, the agent should have inventoried `src/lib/proposal-package/` and matched the deliverable shape to existing types. It did not.

### 3.2 Places output was generic

- The "strengths" matrix and the "what the EU is buying" paragraph could have been written for any proposal. They read as confident but contain little CSIM-specific evidence. **Reusable lesson: any reviewer agent will gravitate to high-level generality unless explicitly anchored in applicant evidence.**
- The RACER indicator examples were partly generic ("Number of journalism outputs produced — target: X, Y, Z per quarter"). Concrete targets would require ingesting CSIM's prior output volumes from `enabbaladi.net`, `aljumhuriya.net`, `artafm.com`, `rozana.fm`. The agent did not have a mechanism to do this in-session.

### 3.3 Places context had to be added manually

- The agent had to manually read 31 pages of guidelines + 4 pages of corrigendum + 44 slides of info session + 32 pages of CSIM Strategic Deck + 14-page concept note + Annex A1 blank template. **There is no current TenderPath pipeline that accepts this multi-file corpus.** `requirements-model.ts` and `evidence.ts` operate on single-file inputs / single-prompt context — both insufficient for real EU calls.
- The corrigendum was a separate PDF. No mechanism in the current pipeline knows to look for one.
- CSIM's MNA / gender analysis findings are referenced in the concept note but the actual underlying documents were not in the corpus. The agent had to take the proposal's self-referential claims at face value.
- Rozana's France registration vs. the other co-applicants' Syria registration required cross-referencing the proposal text with the Corrigendum's "lead applicant" clarification. No pipeline currently does this kind of cross-document reasoning.

### 3.4 Workflow mismatches vs. how real proposal review works

- Real proposal review is **iterative across days**, not a single one-shot pass. There is no `revision` or `iteration` concept in the current proposal-package types.
- Reviews happen against **drafts in progress**, not finished documents. The pipeline today implicitly assumes a finished proposal.
- The applicant has standing organisational evidence (MNA, gender analysis, strategic deck, audience metrics) that should **carry forward across every submission**. Currently each review starts from zero.
- The reviewer's output should feed **assigned tasks** to specific consortium members, not just be a document. The `priority-fixes` list begs to be a task tracker; today it is text.
- Submission-day operations (PADOR confirmation, declaration signing, PROSPECT upload, capture receipt) are a checklist the dashboard should own. Currently no surface exists for this.

### 3.5 Awkward UX / reporting moments

- The agent suggested running the React-based renderer via `npx tsx scripts/...` outside the Next.js app surface. **This is a delivery-mechanism gap.** Customers will not run `tsx`; the renderer needs to live on a request path that produces a downloadable PDF tied to a work-order ID — which is what [src/app/api/dashboard/work-orders/[id]/proposal-package](../../src/app/api/dashboard/work-orders) is built for, but it isn't wired to receive review-type outputs.
- The deliverable filename embedded a path with a literal colon (`EU-grant-test-CIM-Syrian-Media:`), which is fragile on non-macOS systems. Customer-shareable artefacts must use safe filenames keyed by work-order/reference tag.
- There is no version history of the review. If the agent ran the review twice with slightly different findings (which is likely), the second run silently overwrites the first.

---

## 4. Repeatable heuristics discovered

These are review patterns that should become standard TenderPath logic for any proposal review service.

### 4.1 Pre-scoring administrative gates

For any call, before scoring against the rubric, verify:

1. **Budget estimate stated** (EU contribution amount + co-financing %). Missing this is often an administrative blocker, not a scoring deduction.
2. **Co-financing ceiling math** based on lead applicant nationality / registration state.
3. **Mandatory exclusion criteria** addressed (in EU calls today: gender sensitivity, increasingly disability sensitivity, HRBA alignment, do-no-significant-harm).
4. **Lead applicant supplier registration** confirmed (PADOR for EU, UNGM for UN, SAM.gov for US, agency-specific elsewhere).
5. **Form signed/dated.** Trivial but a real source of admin rejection.
6. **Lot/window/priority area selected correctly.**
7. **Page-limit compliance** per section.
8. **Language compliance** (EU calls now require English; some donors require French/Spanish/Arabic).

### 4.2 Scoring-trap patterns

Recurring evaluator concerns that under-score even well-written proposals:

| Pattern | Where it shows up | Why it loses points |
|---|---|---|
| Theory of change without baselines | Intervention-logic criterion | "Expected improvement per result" requires a *starting* value |
| Activities aggregated under one heading | Indicative-activities criterion | Evaluators look for "linked and consistent with expected outputs" — aggregation breaks the linkage |
| Risk register under 5 risks | Risks-and-assumptions criterion | Typically scored as "adequate (3)" rather than "good (4)" |
| Cross-cutting paragraph missing disability or environment | Cross-cutting criterion | Disability is named in EU rubrics since the 2021 Strategy |
| Priority/Lot priorities unevenly addressed | Consistency-with-objectives criterion | Imbalanced coverage signals weak engagement with the call |
| Generic context paragraphs | Country-needs and context-analysis criteria | The applicant's own evidence (mappings, studies) elevates from 3 to 5 |
| Theory of change collapsed into a narrative | Intervention-logic + logframe criteria | A visible table dramatically improves perception of rigour |

### 4.3 Double-weighted criterion identification

In EU PRAG calls the double-weighted criteria are typically:
- Concept note: 2.1 Intervention logic
- Full application: 6.2 Efficiency (budget vs results)

These are *always* the highest-leverage scoring areas. Any review must flag them first.

### 4.4 Forward-stage exposure

Pre-selection is not winning. Concept-note review should flag full-application gates that would block the applicant later:
- Section 1.4 of the full-application (lead applicant financial capacity) is an elimination floor (`<12/20 → reject`).
- Logical Framework Matrix in Annex C is independently scored.
- Co-financing source has to be a confirmed source, not a placeholder.
- Audited accounts must be current in PADOR.

### 4.5 Evidence-vs-inference labelling

Every review finding should be tagged with:
- `evidence` — directly quoted from the call/applicant document
- `inference` — derived from cross-document reasoning
- `gap` — known absence
- `unverified` — assumed from applicant claims that the system cannot independently confirm

This aligns with the existing AGENTS.md assessment principle ("Assessment output should distinguish hard evidence from inference") — and the same discipline applies to proposal reviews.

### 4.6 Useful output sections / scoring patterns

Sections proven valuable in this case, ranked by user attention:
1. Estimated scoring (max / current / achievable) — quantifies upside
2. Priority fixes with severity, owner, deadline — workflow object
3. T-minus timeline — submission-day operations
4. Rewrites (current vs. suggested) — drop-in editorial content
5. Eligibility position — admin gates
6. Forward look to full application — retention hook into next service

---

## 5. Productization opportunities

### 5.1 Reusable report template

A `ReviewOutput` service type, distinct from the existing `ProposalOutput`. Suggested shape (illustrative, do not change code in this task):

```
ReviewOutput {
  call_ref: string;                            // EuropeAid/185831/DD/ACT/SY
  applicant_ref: string;                       // CSIM
  ref_tag: string;                             // REV-CSIM-001
  rubric: EvaluationRubric;                    // criteria, max scores, weights
  scoring: ScoringRow[];                       // per-criterion current + achievable + rationale
  admin_gates: AdminGate[];                    // pre-scoring blockers
  mandatory_exclusions: ExclusionCheck[];      // gender, disability, HRBA, DNSH
  strengths: Strength[];                       // anchored in applicant evidence
  evaluation_risks: EvaluationRisk[];          // per-criterion exposure with reasoning
  priority_fixes: PriorityFix[];               // severity, issue, fix, owner, deadline
  rewrites: Rewrite[];                         // section, current, suggested, addresses_fixes
  theory_of_change?: BaselineTargetRow[];      // optional baseline table
  racer_indicators?: RACERIndicator[];         // optional logframe seed
  submission_readiness: ReadinessRow[];        // checklist with status
  timeline: TimelineEvent[];                   // T-minus
  forward_look?: ForwardLookSection;           // next-stage prep
  corrigenda_observed: CorrigendumRef[];       // tracked updates to the call
  evidence_used: EvidenceRef[];                // applicant evidence referenced
  generated_at: string;
  revision: number;                            // supports iteration
}
```

This is the missing high-end tier. The current `ProposalOutput` (compliance-checklist-shaped) is insufficient.

### 5.2 Dashboard data

New surfaces:

- **Active submission workspace.** Per opportunity the applicant is pursuing: draft state, admin gates status, deadline, last review status, fixes outstanding, owner assignments. Today there is nothing between the matched-tender feed and the `[id]/proposal-package` work-order detail.
- **Calls I'm tracking.** Feed of opportunities the applicant has flagged for submission (distinct from the discovery feed). Surfaces corrigendum/Q&A changes when they drop.
- **Pre-submission readiness scorecard.** Distinct from the company readiness scorecard. Tender-specific. Updates as reviews are run.
- **Review history.** Versioned outputs per opportunity. No silent overwriting.
- **Submission-day kit.** Final 48-hour checklist with last-call corrigendum sweep, declaration signature confirmation, PADOR check, upload receipt capture.

### 5.3 Assessment logic

The current `src/lib/assessment/` answers "what does this company do?" That is necessary but not sufficient for proposal review. A parallel **applicant evidence model** is missing — capturing:

- Standing organisational evidence (prior MNA, strategy decks, theories of change, gender analyses)
- Quantitative track record (audience numbers, beneficiaries reached, prior grant amounts, geographic coverage)
- Personnel rosters (staff counts, gender breakdown, language coverage)
- Past submissions and outcomes (won/lost/pending, evaluator feedback if captured)
- Reusable narrative blocks (organisational background, vision, theory of change)

This evidence library is what makes review #2 cheaper than review #1, and what no competitor can copy quickly.

### 5.4 New service-output specs

Three distinct services worth productising:

1. **Call dossier** — ingest call PDF + corrigenda + info-session deck + Q&A → structured rubric + admin checklist + priority map. **Reusable across all applicants for the same call.** This is the asymmetry: one dossier serves N applicants.
2. **Pre-submission review** — the deliverable produced in this case. Tiered by deal size: ≤EUR 50K (digest tier), EUR 50–250K (mid tier), >EUR 250K (senior tier with current depth).
3. **Submission-day kit** — admin checklist + T-minus timeline + last-call corrigendum sweep + post-submission confirmation capture. Lightweight and high-trust; included free with higher tiers.

### 5.5 Other productisation surfaces

- **Corrigendum/Q&A monitor.** Subscribe a tracked opportunity to a watcher; alert on changes. Differentiates against UNGM Pro / Devex / DevelopmentAid — none of them surface this.
- **Logframe generator.** Convert the review's theory-of-change baseline table and RACER indicators into a populated Annex C draft (`xlsx.ts` already exists in `proposal-package/`).
- **Compliance matrix against EU PRAG conventions.** Distinct from the current generic compliance checklist — opinionated about EU rubric structure.

---

## 6. Prioritized recommendations

Each ranked list reflects the team's launch-priority lens (activation reliability → first-try trust → matched dashboard usefulness → revenue path continuity). One-off CSIM specifics are excluded.

### 6.1 Top 5 product changes

1. **Add `ReviewOutput` type alongside `ProposalOutput`** in [src/lib/proposal-package/types.ts](../../src/lib/proposal-package/types.ts). The current `ProposalOutput` cannot express scorecard-based review against a published rubric. Without this, the high-end review tier is structurally impossible to persist or render through the existing pipeline.
2. **Ingest multi-file corpus per opportunity.** A real EU call is: guidelines PDF + corrigenda PDFs + info-session deck + Q&A appendix + applicant draft + applicant supporting docs. The current pipeline operates on what fits in a single prompt. Multi-file ingestion + cross-document reasoning is the single biggest delivery-vs-marketing gap.
3. **Build a persistent applicant evidence library** ([src/lib/proposal-package/evidence.ts](../../src/lib/proposal-package/evidence.ts) has the scaffolding). Carry forward across submissions. Without this, every review starts cold and gravitates to generic output.
4. **Corrigendum/Q&A monitor** for tracked opportunities. The Lot 3 Design score change (25→30) caught manually in this case is the headline example. Add a watcher per tracked tender URL and surface diffs to the dashboard.
5. **"Active submission" workspace surface** on the dashboard. Per opportunity the applicant is pursuing: deadline, draft status, admin gates, review status, fixes outstanding, owner assignments. Bridges the gap between matched tender → service order → submission.

### 6.2 Top 5 doc / agent changes

1. **Add a Tender Proposal Review Agent** to `docs/agents/managed-agents-setup.md`. The current Assessment Agent is company-level; review work is opportunity-level. The boundary is meaningful enough that one agent doing both blurs both. The new agent's system prompt should encode the heuristics in section 4 of this document.
2. **Create `docs/agents/proposal-review-architecture.md`** parallel to `assessment-architecture.md`. Describe: corpus ingestion, rubric model, scoring pass, gap pass, rewrite pass, evidence pass, output shape, iteration model.
3. **Update `AGENTS.md`** to add `Proposal Review` under Core Product Areas, with its own quality standards (parallel to "Crawler Quality Standards" and "Assessment Quality Standards"). Include: rubric anchoring, corrigendum tracking, evidence-vs-inference labelling, double-weighted-criterion identification, forward-stage exposure surfacing.
4. **Update `assessment-architecture.md`** to clarify the boundary between *company-level* assessment (what does the company do, how procurement-ready is it) and *applicant-evidence* modelling (what reusable narrative/quantitative evidence does the organisation hold). They overlap but are distinct stages.
5. **Document the entity hierarchy** — Call ↔ Corrigendum/Q&A ↔ Applicant ↔ Submission ↔ Review ↔ Output. This hierarchy is currently implicit in `proposal_packages` and `work_orders` tables and should be made explicit before code grows around the current ambiguity.

### 6.3 Top 5 workflow changes

1. **Pre-flight capability inventory.** Before any reviewer agent produces output, it must verify which existing pipeline components (`requirements-model.ts`, `evidence.ts`, `pdfDocs.tsx`, `bundle.ts`) it should reuse. The first PDF render in this case used a one-off Python script because the agent did not inventory the existing stack. This is a default behaviour to encode in the agent prompt.
2. **Corrigendum sweep is the first step**, not the last. Read the corrigendum *before* scoring against the original guidelines. Every EU PRAG call has one; assume one exists until proven otherwise.
3. **Reviews capture evidence into a persistent library.** Every review run should leave the applicant's evidence pack richer than it found it. Otherwise the unit economics of review #2 onward never improve.
4. **Tiered pricing tied to deal size.** A EUR 675K grant cannot share a price tier with a EUR 30K consultancy. The `$299 proposal-draft` slug should remain for low-stakes work; add a senior tier (suggested EUR 1,500–3,000) for grants ≥EUR 250K. Update [src/lib/service-orders.ts](../../src/lib/service-orders.ts) and the dashboard service catalogue accordingly.
5. **All review outputs flow through the work-order surface.** No more standalone scripts producing files at arbitrary paths. The review must be a work-order artefact with a stable URL, retrievable from [src/app/api/dashboard/work-orders/[id]/proposal-package](../../src/app/api/dashboard/work-orders), versioned per revision.

---

## Appendix A — Distinguishing one-off from reusable

| Observation | One-off (CSIM) | Reusable (any review) |
|---|---|---|
| Rozana France registration → 90% ceiling | ✓ | The lead-applicant-nationality → co-financing-ceiling math is universal |
| CSIM's 2025 MNA as evidence base | ✓ | Applicants' own commissioned research is high-value evidence whenever it exists |
| 18-month duration | ✓ | Duration-vs-call-range is a standard admin check |
| SO3 dedicated to gender | ✓ | Gender-exclusion-criterion detection is universal |
| Disability gap | partly | Disability appears in EU rubrics since 2021; gap detection is reusable across all EU calls |
| Journalist protection Priority 2 | ✓ | Priority/Lot-to-SO mapping is universal |
| Corrigendum changed Design 25→30 | ✓ | Corrigendum-sweep-before-scoring is universal |
| RACER indicator examples | ✓ | RACER pattern (R, A, C, E, R) is universal for EU logframes |
| Forward look to 100-pt full-app grid | ✓ | Two-stage EU PRAG calls all have this structure |

## Appendix B — Source documents referenced during the case

These were external customer documents and remain in the case folder, not in the repo:
- `EuropeAid_185831_DD_ACT_SY Guidelines - Call for Proposals.pdf` (31 pp.)
- `EuropeAid 185831 DD ACT SY Corrigendum No 1.pdf` (4 pp.)
- `CfP 185831- info session_final.pptx` (44 slides)
- `CSIM_Strategic_Deck_2025 revised2.pdf` (32 pp.)
- `PRE_FINAL Annex A1. Grant application form-Concept note res (en).docx_to upload.docx` (concept note draft)
- `Annex A1` blank template, `Annex C` logical framework template, `Annex H` declaration on honour

## Appendix C — Bottom line for the product

The case validates that proposal review is a real, defensible wedge — and that TenderPath has most of the rendering and persistence scaffolding for it. **What it does not yet have is the depth of multi-document reasoning, the persistent applicant evidence model, and the structured `ReviewOutput` shape needed to deliver the marketed depth autonomously.** Closing that gap is the difference between selling a service whose quality varies with the human in the loop and selling a defensible product line where review #N is cheaper, faster, and better than review #1.

---

## Changelog — documentation translation pass (15 May 2026)

The lessons in sections 4–6 above were translated into the smallest coherent set of doc updates. No code changed.

### What was updated

- **`AGENTS.md`**
  - Added `src/lib/proposal-package/` to Core Product Areas.
  - Added two Golden Rules: review outputs must flow through the work-order surface and reuse `pdfDocs.tsx`; reviews must read corrigenda and Q&A before scoring.
  - Added a new **Proposal Review Quality Standards** section encoding evidence-over-inference labelling, rubric-anchored scoring, severity vocabulary, action-oriented output, workflow identity, persistent applicant evidence, and revision-versioned reviews.
  - Extended the Documentation Map with the two new docs and the case-learnings file.

- **`docs/agents/managed-agents-setup.md`**
  - Annotated the Tender Assessment Agent (#2) to clarify it is company-level and points to the new Proposal Review Agent for opportunity-level work.
  - Annotated the Tender Dashboard Agent (#3) to reference the Active Submission Workspace.
  - Added **agent #12, the Tender Proposal Review Agent**, with system prompt and default behaviour encoding the case heuristics: corrigendum-first, rubric-mirroring, evidence-labelled, admin-vs-scoring distinction, severity-tagged fixes, workflow-shaped output, persistent evidence, revision-versioned.
  - Added a "How to Use With Claude Code" example for the new agent.

- **`docs/agents/dashboard-architecture.md`**
  - Added an **Active Submission Workspace** module with proposal-review readiness states (`not_started` → `submitted`), admin-gate status surfacing, score-upside display, severity-coded open fixes, corrigendum/Q&A change indicators, and revision history.
  - Added a **Tracked-calls feed** module for opportunities flagged for submission.
  - Extended Data dependencies to include versioned review outputs and corrigendum tracking.

- **NEW: `docs/agents/service-output-spec.md`**
  - Formal spec for `ReviewOutput`, distinct from `ProposalOutput` and `RosterOutput`.
  - Universal `Severity`, `ReadinessState`, `GateStatus`, and `EvidenceLabel` vocabularies shared across all service outputs.
  - Required vs optional fields; versioning rules; renderer contract; source-pointer contract; persistence pattern on `proposal_packages.output`.

- **NEW: `docs/agents/proposal-review-report-template.md`**
  - Canonical narrative shape for any review deliverable: cover · executive summary · opportunity fit · why this can win · evaluation risk scan · priority fixes · rewrites · submission readiness · forward look · bottom line.
  - Tone rules favouring action over analysis, drop-in over directional, owner-and-deadline on every fix, evidence labels visible, workflow identity preserved.
  - Length envelope by tier; severity colour rules tied to the existing design tokens; revision-history header rules.

### Why it was updated

- The case proved proposal review is a real product wedge but exposed that the current `ProposalOutput` type cannot express rubric-based scoring, no agent role explicitly owns this scope, and the dashboard has no surface for active submissions in progress.
- The fixes encode reusable heuristics (corrigendum-first, evidence-over-inference, severity-tagged fixes, double-weighted-criterion awareness, applicant-evidence reuse) so the next review does not start cold.
- The new docs preserve TenderPath's workflow identity — reviews are workflow objects, not consultant reports — and make that identity enforceable through the report template and output spec.
- All changes were made in documentation only. No code changes were proposed in this pass, in line with the brief.

### What future code/product work should follow

These are the implied next implementations. Each is a separate work item, prioritised by impact on activation reliability, first-try trust, and revenue-path continuity (AGENTS.md launch priorities).

1. **Add `ReviewOutput` type** alongside `ProposalOutput` and `RosterOutput` in `src/lib/proposal-package/types.ts`, with the `kind: "review"` discriminator on `proposal_packages.output`. Renderers branch on `kind`.
2. **Multi-file corpus ingestion** for opportunity-level work (call + corrigenda + Q&A + info-session + applicant draft + applicant supporting docs). This is the single biggest delivery-vs-marketing gap.
3. **Corrigendum/Q&A monitor** on tracked opportunities — subscribes to a call URL, diffs on change, alerts the Active Submission Workspace.
4. **Persistent applicant evidence library** built on `src/lib/proposal-package/evidence.ts`. Captured on every review run, queried by the Proposal Review Agent to anchor strengths and rewrites in real applicant evidence.
5. **Active Submission Workspace surface** in `src/app/dashboard/` — per-opportunity workspace following the new dashboard-architecture spec, wired to versioned review outputs.
6. **Senior review service tier** in `src/lib/service-orders.ts` and the dashboard service catalogue, priced for grants ≥EUR 250K. The current `$299 proposal-draft` is mispriced for that depth of work.
7. **Review-output rendering wired to a work-order route** (`/api/dashboard/work-orders/[id]/review`) so reviews are downloadable artefacts with stable URLs, never one-off scripts.
8. **Logframe and budget-estimate seeding** — feed `ReviewOutput.racer_indicators` and `ReviewOutput.theory_of_change` into the existing `xlsx.ts` generator to produce a draft Annex C and budget worksheet.

Each item references this changelog as its origin. The order above is the recommended implementation sequence — earlier items unblock later ones.
