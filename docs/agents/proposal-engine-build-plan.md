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
Ship sprints in order. **Sprints 0–4 are the revenue MVP** — the $299 product can take live
orders after Sprint 4, before the flywheel or corpus exist. Sprints 5–7 and the Senior track are
enhancements, not blockers. The primary regression fixture at every sprint is a **real UN tender**
(RFP/ITB + amendment + Q&A); CSIM is a secondary cross-lane mechanism check only. Respect the lean
constraint: do not pull later work forward.

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
**Out of scope:** provenance labels, carry-forward, corpus.
**Files:** `scoring-engine.ts`, persistence layer, `generation_status` transitions.
**Acceptance:** issuing an amendment + Q&A round mid-draft on the UN-tender fixture re-extracts the
rubric, records the changed criteria/weights/disqualifiers as deltas, bumps the version, flags the
prior snapshot stale, and preserves the prior output (not overwritten). (Secondary mechanism check:
the same flow on CSIM's Corrigendum No. 1 produces the design 25→30 and co-financing deltas — proving
the diff engine is lane-agnostic.) See `amendment-versioning-flow.md`.
**Done-when:** re-run produces a new snapshot; old snapshot intact and marked superseded.

## Sprint 4 — Provenance + field-level labels  ← REVENUE MVP COMPLETE

**Goal:** Every claim traceable; gaps surfaced, not hidden.
**In scope:** thread `Claim` / `Provenance` through drafting; roll up to `Confidence`
(`evidenced / inferred / gap / unverified`) per criterion; surface `gap` claims to the user;
extend `ProposalOutput` to carry the labels.
**Out of scope:** carry-forward, loss-reason capture, corpus.
**Files:** `scoring-engine.ts`, drafting pipeline, `ProposalOutput` type, output rendering.
**Acceptance:** each material claim in the UN-tender draft is tagged; unmet requirements (missing
form, unevidenced past-performance, spec gap) appear as explicit `gap`s to the user rather than
confident prose.
**Done-when:** $299 output shows per-claim provenance and per-criterion confidence.
**→ At this point the $299 product is submission-grade and can take live orders.**

---

## Sprint 5 — Evidence carry-forward (flywheel / LTV)

**Goal:** Each paid submission improves the next; kill the cold start.
**In scope:** finish `evidence.ts`; persist a reusable applicant profile populated from the free
Readiness Assessment and Bid/No-Bid; carry past-performance and reusable evidence into new drafts via
`applicant_library` provenance.
**Acceptance:** a second UN-tender run for the same applicant reuses prior evidence (past performance,
registrations, key personnel) instead of re-eliciting.
**Done-when:** repeat run demonstrably warm-starts.

## Sprint 6 — Loss-reason instrumentation + eval harness scale-up

**Goal:** Capture *where* drafts are weak; build the gate for corpus spend.
**In scope:** wire `recordLossReason` to auto-score flags, reviewer edits, and run failures; build the
eval set from real UN tenders (with known award outcomes where available); build the
with/without-retrieval comparison framework (amendment/disqualifier detection, estimated-vs-actual
score alignment, reviewer-edit volume). CSIM stays in the set as the cross-lane mechanism case.
**Done-when:** loss reasons accrue automatically; eval harness can score a tender with and without retrieval.

## Sprint 7 — Corpus pilot (experiment to *disprove*)

**Goal:** Test whether retrieval beats the rubric-aware pipeline — before investing in it.
**In scope:** `proposal_exemplars` table; ~20-entry hand-curated seed of obtainable, legal UN
procurement material (published TORs/solicitations from UNGM and agency portals, award notices with
winning vendor + contract value, agencies' published procurement manuals and evaluation guidelines,
and your own expert-authored exemplar sections — **not** confidential winning proposals); embeddings;
retrieval into drafting; measure lift via the Sprint 6 harness.
**Done-when:** lift is measured and a go/no-go on pgvector is recorded. **If lift is marginal, the moat
was Sprints 1–4 all along — stop here and don't build the vector store.**

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
