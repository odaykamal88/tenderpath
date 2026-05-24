# TenderPath — Proposal Engine Build Plan

**Purpose:** Hand this to Claude Code to build the $299 Proposal Draft into a submission-grade
product, then extend to the flywheel and the corpus moat.

**Scope is UN tenders.** The lane is decided: **UN procurement** (UNGM, UNDP, UNICEF, WHO, WFP,
UNHCR). Elicitation, templates, the corpus seed, and the *primary* acceptance fixtures are all real
UN solicitations (RFP / ITB / RFQ), their amendments/addenda, and published Q&A rounds.

**On CSIM:** it is an EU *grant* case, not UN procurement — so it is NOT the product anchor. Use it
only as a **mechanism regression**: it proves the amendment-diff / version-bump / stale-snapshot
logic works when a document changes mid-draft (see `amendment-versioning-flow.md`). Do not let its
grant vocabulary (co-financing, design scoring, theory of change) leak into the UN procurement
elicitation or templates. Every product-level acceptance test below names a **UN tender with an
amendment + a Q&A round** as the primary fixture; CSIM is the secondary "the diff engine generalizes"
check.

**Companion files (drop into the repo first):**
- `scoring-engine.ts` → `src/lib/proposal-package/scoring-engine.ts`
- `scoring-engine-spec.md` → append to / reference from `service-output-spec.md`
- `amendment-versioning-flow.md` → repo reference for the Sprint 3 versioning logic

---

## How to use this doc

Each sprint has: **Goal · In scope · Out of scope · Files · Acceptance · Done-when.**
Ship sprints in order. **Sprints 0–4 ship the revenue-MVP engine; Sprint 6 ships the screen** —
the $299 product can take live orders after Sprint 6. Sprint 5 is the free top-of-funnel that
seeds the applicant library Sprint 8 depends on, and Sprint 7 is its screen. Sprints 8–10 + the
Senior track are enhancements, not blockers.

The proposal-output-ux.md and readiness-output-ux.md specs (added 2026-05-24) impose:
  - PART A of proposal-output-ux.md applies as acceptance criteria DURING Sprints 2–4 (engine emit
    shape: A1 display-ready criteria, A2 sourced disqualifiers, A3 routed gaps, A4 presentable
    confidence, A5 already-reviewed).
  - Sprints 6–7 build screens against the LOCKED Sprint 2–5 emit shape; do not build UI before
    Sprint 4 is in.
  - The `gap → action` routing module is shared by both the $299 output and the free Readiness
    Assessment — built once in Sprint 4, reused by Sprint 5.

The primary regression fixture at every sprint is a **real UN tender** (RFP/ITB + amendment +
Q&A); CSIM is a secondary cross-lane mechanism check only. Respect the lean constraint: do not
pull later work forward.

---

## Repo context (what already exists)

- `src/lib/proposal-package/` — 15 files: types, LLM context assembly, PDF rendering, persistence,
  evidence scaffolding, grading, admin gates.
- `ProposalOutput` / `RosterOutput` types are live; persist to `proposal_packages.output` (JSONB)
  with a `kind` discriminator.
- `proposal_packages.generation_status` is the pipeline state / operational truth. Wire new state
  into this — do **not** invent a parallel state machine.
- `$299` proposal draft and bid/no-bid both exist in `service-orders.ts`.
- `evidence.ts` is scaffolded but cross-submission carry-forward is not done (every run starts cold).
- `context.ts` is currently single-prompt-sized (single-file assumption).
- `ReviewOutput` (23-field senior-tier spec) is specified, not built.
- No corpus / RAG / pgvector / exemplar table exists anywhere.

## Hard guardrails (Claude Code must respect)

1. **Rendering exits only through `pdfDocs.tsx`** (the AGENTS.md Golden Rule). The engine emits
   `DraftSection` / `ScoreResult`; it never renders. Off-pipeline rendering (e.g. ReportLab) is a
   rejected pattern — it is the exact CSIM failure.
2. **No silent overwrite.** Re-runs create a new immutable `GenerationSnapshot`; prior snapshots are
   marked `supersededBy`, never mutated or deleted.
3. **Distinguish evidence from inference** at the claim level (`Provenance`). Never smooth a `gap`
   into confident prose.
4. **Instrument pipeline changes.** Major data-pipeline work adds observability; silent failure is
   not acceptable.
5. **`lane` is data, never a code branch.** The engine is lane-agnostic.

## Open decisions to surface, NOT guess

- ~~How `RubricDelta[]` / the stale-rubric flag maps onto `generation_status` — new status value
  vs. side annotation.~~ **RESOLVED at GATE 0 (2026-05-24):** new status value `rubric_stale`
  alongside the existing `pending` / `generating` / `ready` / `needs_remediation` / `failed`.
  Column is `TEXT` with no CHECK constraint → no migration; widened in the shared
  `GenerationStatus` type in `src/lib/proposal-package/types.ts`.
- ~~Multi-lot tender shape (surfaced by the UNOPS RFQ/2026/61438 fixture).~~ **RESOLVED at
  GATE 0 (2026-05-24):** `TenderRubric` gains `lots: LotRubric[]` (always ≥1; single-lot tenders
  use `lotId = "main"`); criteria + lot-specific disqualifiers move into `LotRubric`;
  notice-wide disqualifiers (deadline, lead-applicant eligibility) stay on
  `TenderRubric.noticeWideDisqualifiers`; `ScoreResult` becomes per-lot via `lotResults[]`.
- Exact file paths not listed above — confirm in repo before creating new files.

---

## GATE 0 — Lane confirmed: UN procurement (first commit)

**Decided:** default lane is **`procurement`**, scoped to UN agencies (UNGM, UNDP, UNICEF, WHO,
WFP, UNHCR). Grant handling is a deferred mode, not part of the MVP.

**Done-when:** lane committed as config (`lane: 'procurement'`); `scoring-engine.ts` dropped in;
types compile; a real **UN tender document set** (base solicitation + an amendment + a Q&A round) is
loaded as the primary test fixture, with CSIM loaded as a secondary mechanism fixture.

**Fixture layout chosen at GATE 0 (2026-05-24):**

```
tests/fixtures/un-tenders/
  unops-RFQ-2026-61438/                  (multi-lot goods RFQ, lowest_compliant)
    00_manifest.md
    qa-revisions.md
    notice-293188/                       (16 files: base + 3 amendments + 3 lot-specific xlsx)
  unicef-RFPS-DAN-2021-503347/           (services RFP, cumulative, two-notice span)
    00_manifest.md
    qa-classifications.md
    notice-135638/                       (base RFP + annexes + Q&A + slides + webinar)
    notice-146988/                       (Amendment 1 + revised Annex C + same templates)
```

Per-notice subdirectories are kept because the UNICEF case has filename collisions across
notices (the `Annex C ... revised.docx` filename appears in both 135638 and 146988 with different
content — 72,546 vs 79,150 bytes). This is the canonical `DocManifestEntry.contentHash` test
case: Sprint 1's manifest loader must hash-compare to decide whether Annex C actually changed.

CSIM is **not yet** loaded as the secondary mechanism fixture — defer to Sprint 3 when the
`reextractAndDiff` work begins (CSIM's value is the corrigendum-diff regression case, not the
extraction case).

---

## Sprint 1 — Rubric extraction + multi-file ingestion

**Goal:** Turn a solicitation *document set* into a structured, versioned `TenderRubric`.
**In scope:** implement `extractRubric`; rebuild `context.ts` to assemble multiple files
(guidelines + corrigenda + Q&A + annexes) with a `documentManifest` and `supersedes` relations;
parse criteria, weights, `doubleWeighted`, `gatingThreshold`, and `Disqualifier`s into typed objects.
**Out of scope:** scoring, drafting, retrieval, embeddings.
**Files:** `context.ts`, `scoring-engine.ts`, types in `proposal-package/`.
**Acceptance:** a real UN solicitation set (base RFP/ITB + an amendment + a Q&A round) parses into a
`TenderRubric` with technical criteria, weights, the financial/price treatment, mandatory-form and
eligibility disqualifiers, and the amendment's points represented via supersession. (Secondary: CSIM
parses too, proving the extractor generalizes.)
**Done-when:** `extractRubric(CSIM docs)` returns a complete typed rubric; manifest hashes populate.

## Sprint 2 — Scoring pass + $299 self-check loop

**Goal:** Make the $299 pipeline score its own draft and revise against the rubric.
**In scope:** implement `score()`; disqualifier + gating detection; wire a revision loop into the
$299 flow that feeds `estimatedTotal`, `disqualifiersTriggered`, and weak sections back into drafting;
export the final draft through `pdfDocs.tsx`.
**Out of scope:** corrigendum watching, versioning, provenance labels (next sprints).
**Files:** `scoring-engine.ts`, the $299 pipeline in `proposal-package/`, `pdfDocs.tsx` integration.
**Acceptance:** a UN-tender draft scores per-criterion under the tender's methodology (cumulative
technical+financial, or lowest-priced technically-compliant); a missing mandatory form / eligibility
breach fires as a disqualifier; `passesGating` reflects it; a weak section triggers a revision pass.
**Done-when:** $299 run produces a scored, revised, `pdfDocs`-rendered draft end to end.

## Sprint 3 — Corrigendum/Q&A watcher + immutable versioning

**Goal:** Detect mid-flight changes and never lose a prior run.
**In scope:** implement `reextractAndDiff` (rubric-aware diff → `RubricDelta[]`); bump `rubricVersion`
on change; implement `recordSnapshot` (immutable, `contextHash` + `promptHash` + `documentManifest`);
flag any snapshot whose `rubricVersion` is now stale; wire into `generation_status` (the new
`rubric_stale` value resolved at GATE 0).

**A5 bolt-on (proposal-output-ux.md PART A · A5 — added 2026-05-24):** every `Disqualifier` in the
extracted and re-extracted rubric MUST carry a non-empty plain-language `rule` AND a populated
`SourceRef.docId`. The "already-reviewed" claim is undefendable if disqualifiers can't point at
their source clause. Asserted in Sprint 3 acceptance against both priorRubric AND nextRubric so
the property survives the re-extraction.

**Out of scope:** provenance labels (Sprint 4), gap routing (Sprint 4), carry-forward (Sprint 8),
corpus (Sprint 10).
**Files:** `rubric-diff.ts` (NEW), `reextract.ts` (NEW), `snapshot.ts` (NEW), `manifest-loader.ts`
(noticeFilter option), `scoring-engine.ts` (delegate), `scripts/sprint3-acceptance.ts` (NEW).
**Acceptance:** issuing an amendment + Q&A round mid-draft on the UN-tender fixture re-extracts the
rubric, records the changed criteria/weights/disqualifiers as deltas, bumps the version, flags the
prior snapshot stale, and preserves the prior output (not overwritten). Every disqualifier on both
sides of the diff carries rule + SourceRef (A5 bolt-on). (Secondary mechanism check: the same flow
on CSIM's Corrigendum No. 1 produces the design 25→30 and co-financing deltas — proving the diff
engine is lane-agnostic.) See `amendment-versioning-flow.md`.
**Done-when:** re-run produces a new snapshot; old snapshot intact and marked superseded; A5
disqualifier integrity holds on both sides.

## Sprint 4 — Provenance + field-level labels + shared gap→action routing  ← REVENUE-MVP ENGINE COMPLETE

**Goal:** Every claim traceable; gaps surfaced, not hidden; every gap routed to a paid SKU.
**In scope:**
  - **Provenance (PART A · A4):** the draft-generator already emits per-claim
    `provenance: { kind, sourceRef?, note? }` (since Sprint 2). Sprint 4 adds the criterion-level
    rollup: `CriterionAssessment.mechanicalConfidence` (rolled up from claim provenance — independent
    of the LLM's judgement so disagreement is detectable), `claimCount`, `claimsByProvenance`.
    `provenanceToConfidence(kind)` + `rollupConfidenceFromClaims(claims)` live in `gap-routing.ts`
    so the UI maps the 4-way `Confidence` taxonomy at both claim and criterion level (per A4).
  - **Gap routing (PART A · A3 + readiness R1):** every gap surfaced — criterion weakness,
    missing-evidence string, triggered disqualifier, claim-level `gap`-provenance — maps via
    `routeAllGaps()` to one of `bid_no_bid` ($39) / `matching` ($49/mo) / `proposal_draft` ($299)
    / `roster` ($749). Built as a SINGLE shared module (`src/lib/proposal-package/gap-routing.ts`)
    that Sprint 5 imports unchanged. Routing rules are a debuggable table (6 categories: roster /
    past performance / spec mismatch / mandatory form / eligibility / presentation) plus a
    DisqualifierKind→SKU lookup. Origin-exclusion prevents recommending the SKU the user is
    already inside (the $299 output never routes a gap back to "buy Proposal Draft").
  - **`ScoreResult.routedGaps`:** populated automatically inside `scoreDraft()` so every score
    result carries the routed list — no caller needs to remember to invoke routing.
**Out of scope:** carry-forward (Sprint 8), loss-reason capture (Sprint 9), corpus (Sprint 10),
output screens (Sprint 6), $299 checkout copy (Sprint 6 PART C).
**Files:** `gap-routing.ts` (NEW), `scoring-engine.ts` (new types: `ServiceSku`, `OriginSku`,
`RoutingContext`, `RoutedGap`; new `CriterionAssessment` fields; `ScoreResult.routedGaps`),
`rubric-scorer.ts` (`enrichWithClaimMetrics` + `routeAllGaps` call), `pdfDocs.tsx` (PAGE 4 of the
scored-draft PDF groups gaps by SKU with rationale + CTA), `scripts/sprint4-acceptance.ts` (NEW —
two-phase synthetic + end-to-end).
**Acceptance:** PHASE 1 synthetic — 6 routing categories fire correctly, origin-exclusion holds,
all 5 disqualifier kinds route, confidence rollup priority is correct. PHASE 2 end-to-end on
UNICEF — every CriterionAssessment carries `mechanicalConfidence` + `claimCount` +
`claimsByProvenance`; `ScoreResult.routedGaps` is populated; every triggered disqualifier surfaces
as a routed gap with its `SourceRef`; no `routedTo` is `proposal_draft`; PDF renders cleanly.
**Done-when:** the engine emit shape is locked; `gap-routing.ts` is the single source of truth and
the Sprint 5 readiness assessment imports it unchanged.
**→ At this point the $299 product engine is submission-grade. UI lands in Sprint 6.**

---

## Sprint 5 — Free Vendor Readiness Assessment engine (top-of-funnel) ← SHIPPED

**Goal:** Ship the FREE conversion engine: a vendor enters their company; the system scores them
against generic UN/UNGM readiness criteria and emits a payload where every gap routes to a paid SKU
via the Sprint 4 `gap-routing.ts`. Per `readiness-output-ux.md`: this is the core conversion engine
and the seed of the applicant library Sprint 8 depends on.

**What shipped:**
  - **readiness-rubric.ts** — static 8-criterion rubric (UNGM=15, years=10, agencies=20, value=15,
    sectors=10, geo=10, personnel=10, certs=10; total 100). Each criterion has a deterministic
    `score(applicant)` function that emits `{estimatedScore, confidence, weaknesses,
    missingEvidence, claims}` — no LLM. `buildReadinessRubric()` produces the full TenderRubric
    shape so callers that want generic-engine integration can use it.
  - **readiness-engine.ts** — `scoreReadiness(applicant)` orchestrator. Builds synthetic
    DraftSections from the per-criterion scoring (claims flow through `mechanicalConfidence` +
    `claimsByProvenance` rollup unchanged). Builds a ScoreResult with `lotResults[0].perCriterion`
    populated from the deterministic rules. Calls `routeAllGaps(score, { originSku: 'readiness' })`
    — origin='readiness' opens all 4 SKUs (no origin-exclusion). Wraps everything in a
    `ReadinessOutput` payload with `summary` (overallScore, band, primaryAction, headline) and
    `founderCredibility` (structured, not UI-only prose).
  - **Band-driven primary CTA** — `pickPrimaryAction` returns `roster` for low band, `matching`
    for high band, and falls through to routing-distribution for medium. The first-pass count-
    driven picker had a subtle inversion (a WEAK applicant's many fallback-to-matching gaps
    out-voted the foundational-roster signal); band-driven is the correct semantic.
  - **Routing-fallback fix** — Sprint 5 audit caught that the gap-routing fallback target was
    `proposal_draft` ($299, most expensive). Auto-recommending the most expensive SKU for any
    keyword-miss inverted the "right action for the gap" framing. Fallback now routes to
    `matching` ($49/mo) — the lowest-friction recurring SKU that's always a defensible generic
    recommendation. This change also benefits the $299 flow (no longer surfaces $299 CTAs from
    gaps it can't categorize) though the visible impact is minor because origin-exclusion already
    excluded `proposal_draft` for that flow.

**Out of scope (deferred to Sprint 7+):** persist.ts wiring for `kind='readiness'` (lands with the
Sprint 7 screen when there's a user-facing surface that needs DB writes), website-crawl /
company-classification (already lives in `src/lib/assessment/`), real-time UNGM lookup / sanctions
screening (architectural integrations, Sprint 8+).

**Files:** `src/lib/proposal-package/readiness-rubric.ts` (NEW), `readiness-engine.ts` (NEW),
`gap-routing.ts` (fallback-target fix), `scripts/sprint5-acceptance.ts` (NEW — three synthetic
applicants: strong / medium / weak), `docs/agents/proposal-engine-build-plan.md` (this update).

**Acceptance (all pass):**
  - STRONG (Atlas, DEMO_APPLICANT): 87/100 high band, primary CTA=Matching, 4 routed gaps
  - MEDIUM (BlueHorizon, UNGM + 1 UN contract): 54/100 medium band, primary CTA=Matching, 12 gaps
    across 2 SKUs
  - WEAK (Riverbend, no UN history): 13/100 low band, primary CTA=Roster, 20 gaps across 3 SKUs
  - Engine runs in ~14ms (deterministic, no LLM) — viable as a free top-of-funnel tool.
  - Every CriterionAssessment carries `mechanicalConfidence` + `claimCount` + `claimsByProvenance`
    (A4 holds for readiness output as it does for $299).
  - Every routedGap has non-null `routedTo` in the 4-SKU set + non-empty rationale + ctaCopy +
    ruleId (A3 / R1 hold).
  - `founderCredibility` populated as structured data (S4).

**Done-when:** ✅ `scoreReadiness(applicant)` produces a routed, structured `ReadinessOutput` that
the Sprint 7 screen can consume verbatim.

---

## Sprint 6 — $299 output screens (PART B + PART C)

**Goal:** Ship the UI that turns the locked Sprint 2-4 emit shape into a screen the buyer can act
on. Per `proposal-output-ux.md` PART B field-priority and PART C purchase-moment framing.
**In scope:**
  - **PART B:** B1 compliance verdict on top (`passesGating` + `disqualifiersTriggered` with
    plain-language rules and clickable `SourceRef`s); B2 rubric score with per-criterion breakdown;
    B3 routed gaps as the upsell/LTV surface (reads `routedTo` from Sprint 4); B4 inline
    provenance on draft body; B5 export through `pdfDocs.tsx` (Golden Rule) into the tender's
    `.docx` / `.xlsx` templates from the fixture set.
  - **PART C:** C1 expectation-setting via showing the score+gaps (NOT a banner); C2 one
    value-framed line at $299 checkout ("compliant, rubric-scored proposal draft with every gap
    flagged against this tender's evaluation criteria"); C3 the legal disclaimer in T&C only; C4
    NO persistent banner/footer disclaimer (the screen design is the framing).
  - Brand tokens: lift `GOLD / INK / INK2 / INK3 / RULE / RED / GREEN` from `pdfDocs.tsx` into
    `src/lib/brand/tokens.ts` so screens + PDFs reuse the same source.
**Out of scope:** corpus, eval harness, evidence carry-forward.
**Acceptance:** a buyer who completed Sprint 2-4 end-to-end can read the screen and act — leads
with compliance verdict, shows where the score came from, every gap has a CTA, and the export
button produces the submission-formatted file.
**Done-when:** the $299 product can take live orders end-to-end through the new screen.

---

## Sprint 7 — Free Vendor Readiness Assessment screen

**Goal:** Ship the UI for the Sprint 5 readiness engine. Per `readiness-output-ux.md`.
**In scope:**
  - **S1** Readiness summary first (honest read, not a vanity score).
  - **S2** Per-gap routed: each gap states what's missing, why it loses UN work, and the SINGLE
    service that closes it — reads from the same Sprint 4 `gap-routing.ts` module that drives
    Sprint 6.
  - **S3** ONE CTA (no scattered competing buttons; the routed gaps feed one primary CTA).
  - **S4** Founder-credibility line surfaced where the user decides whether to trust the
    assessment (six years senior UN procurement, WFP, P4/P5).
  - Brand tokens from `src/lib/brand/tokens.ts` (lifted in Sprint 6).
**Out of scope:** post-assessment nurture sequence, country landers, ad copy (all live in GTM, not
the repo — explicitly out of scope per readiness spec).
**Acceptance:** a free-tier visitor walks the readiness flow, hits the output screen, sees every
gap routed to one of the four paid SKUs, sees one CTA, and the founder-credibility line is visible
at the trust moment.
**Done-when:** the free funnel is shippable. Free → paid is a measured conversion path.

---

## Sprint 8 — Evidence carry-forward (flywheel / LTV)

**Goal:** Each paid submission improves the next; kill the cold start.
**In scope:** finish `evidence.ts`; persist a reusable applicant profile populated PRIMARILY by
the Sprint 5 free Readiness Assessment and SECONDARILY by Bid/No-Bid runs; carry past-performance
and reusable evidence into new drafts via `applicant_library` provenance.
**Acceptance:** a second UN-tender run for the same applicant reuses prior evidence (past
performance, registrations, key personnel) instead of re-eliciting.
**Done-when:** repeat run demonstrably warm-starts off the readiness payload.

## Sprint 9 — Loss-reason instrumentation + eval harness scale-up

**Goal:** Capture *where* drafts are weak; build the gate for corpus spend.
**In scope:** wire `recordLossReason` to auto-score flags, reviewer edits, and run failures; build
the eval set from real UN tenders (with known award outcomes where available); build the
with/without-retrieval comparison framework (amendment/disqualifier detection, estimated-vs-actual
score alignment, reviewer-edit volume). CSIM stays in the set as the cross-lane mechanism case.
**Done-when:** loss reasons accrue automatically; eval harness can score a tender with and without
retrieval.

## Sprint 10 — Corpus pilot (experiment to *disprove*)

**Goal:** Test whether retrieval beats the rubric-aware pipeline — before investing in it.
**In scope:** `proposal_exemplars` table; ~20-entry hand-curated seed of obtainable, legal UN
procurement material (published TORs/solicitations from UNGM and agency portals, award notices with
winning vendor + contract value, agencies' published procurement manuals and evaluation guidelines,
and your own expert-authored exemplar sections — **not** confidential winning proposals); embeddings;
retrieval into drafting; measure lift via the Sprint 9 harness.
**Done-when:** lift is measured and a go/no-go on pgvector is recorded. **If lift is marginal, the
moat was Sprints 1–4 all along — stop here and don't build the vector store.**

---

## Parallel track — Senior Review SKU (starts after Sprint 3)

Same engine, full depth, human-in-loop. Implement the 23-field `ReviewOutput` seeded from `ScoreResult`;
reviewer adjusts and confirms; full versioning per snapshot. Needs `score` (Sprint 2) and versioning
(Sprint 3) in place first. This is a separate SKU from the $299 — different job, different acceptance.

---

## Paste-ready kickoff prompt for the new Claude Code session

> You are working in the TenderPath repo. Read `AGENTS.md`, `service-output-spec.md`, the files in
> `src/lib/proposal-package/`, and `BUILD_PLAN.md` before writing code. We are building the $299
> Proposal Draft into a submission-grade product following the sprints in `BUILD_PLAN.md`. The scope
> is **UN procurement tenders** (UNGM, UNDP, UNICEF, WHO, WFP, UNHCR) — RFP/ITB/RFQ responses, not
> grants. Keep grant vocabulary (theory of change, co-financing) out of the elicitation and templates.
>
> Hard rules: rendering exits only through `pdfDocs.tsx`; no silent overwrite (re-runs create new
> immutable snapshots); distinguish evidence from inference at the claim level; wire new state into
> `proposal_packages.generation_status`, not a parallel machine; `lane` is data, never a branch
> (`lane: 'procurement'`).
>
> Start with GATE 0: confirm `lane: 'procurement'` in config, drop in `scoring-engine.ts`, and load a
> real UN tender (base solicitation + an amendment + a Q&A round) as the primary test fixture; load
> CSIM as a secondary mechanism fixture only. Do not start Sprint 1 until types compile and the
> fixtures load. Surface — don't guess — how the stale-rubric flag should map onto `generation_status`
> (see `amendment-versioning-flow.md`). Use the UN-tender fixture as the regression test at every
> sprint. Show me the plan for Sprint 1 before implementing.
