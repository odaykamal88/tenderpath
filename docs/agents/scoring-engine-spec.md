# scoring-engine — spec additions

This extends `service-output-spec.md`. It defines the single scoring spine shared by the
$299 Proposal Draft and the senior-tier review, and folds in three improvements from review:
claim-level provenance, immutable generation snapshots, and loss-reason instrumentation.

---

## Gate 0 — lane decision (blocks the build below)

Before the first commit, record one decision: is the **default lane** `procurement` or `grant`?

The decision rule is empirical, not theoretical. Look at where the next five paying orders
actually originate:

- UNGM vendors responding to RFP/ITB → **procurement is default**, grant is a switchable mode.
- CSIM-style co-financed grant calls with design scoring → the ICP and pricing page are aimed
  at the wrong buyer, and that is the real finding of the audit.

The engine itself is **lane-agnostic** — `lane` is a field on `TenderRubric`, read by the
elicitation and template layers above the engine, never branched on inside it. A wrong lane
guess is therefore a configuration change, not a rewrite. Default recommendation remains
procurement-first, but confirm it against real order flow rather than the deck.

---

## One spine, two SKUs

There is exactly **one** rubric extraction and **one** scoring pass. The SKUs differ in depth
and in whether a human confirms — not in logic.

| | $299 Proposal Draft | Senior Review |
|---|---|---|
| Calls `extractRubric` | yes | yes (identical) |
| Calls `score` | yes, automatically | yes, identical |
| Human in loop | no | yes — reviewer adjusts & confirms |
| Output | revised draft → `pdfDocs.tsx` | 23-field `ReviewOutput`, seeded from `ScoreResult` |
| Depth | lightweight self-check | full |

**$299 flow:** draft sections → `score()` → feed `estimatedTotal`,
`disqualifiersTriggered`, and weak sections into a revision loop → export via `pdfDocs.tsx`.
The automatic self-score-against-the-extracted-rubric is what makes this "way better than a
generic LLM": a vendor pasting a TOR into a chatbot gets prose; they do not get a simulated
panel score, a disqualifier check, or stale-rubric detection.

**Senior flow:** same `extractRubric` + `score`; the `ScoreResult` seeds the full
`ReviewOutput`; a human confirms; every pass is snapshotted.

---

## Build sequence

**Gate 0** — lane decision (above). Literal first commit.

**Phase 1 — correctness (ship-blocking for $299).** Three coupled items, shipped together,
because they are the same scenario from three angles — a call arrives as a *set*, the set
*changes*, a change *forces a re-run*:

1. Multi-file ingestion in `context.ts` — treat the solicitation as one versioned document set
   with provenance and supersession (`DocManifestEntry.supersedes`).
2. Corrigendum/Q&A watcher — `reextractAndDiff` produces a rubric-aware diff; on change, bump
   `rubricVersion` and flag any snapshot whose `rubricVersion` is now stale.
3. Versioning via `GenerationSnapshot` — pulled into the $299 path now, **not** deferred to
   senior tier. The watcher firing mid-draft *is* the re-run case; "no silent overwrite" matters
   most exactly then. Re-runs create a new snapshot; prior snapshots are marked `supersededBy`,
   never mutated or deleted.

**Phase 2 — flywheel (does not block first sale).** Finish `evidence.ts` carry-forward so each
$299 run enriches the reusable applicant profile; surface the field-level `Confidence` labels
(`evidenced / inferred / gap / unverified`) that the output shape already supports.

> Sequencing note: review feedback put carry-forward ahead of versioning + watcher. Held the
> opposite. A draft against a superseded rubric can get someone **disqualified** (safety
> property); a cold-start run without carry-forward is merely annoying (optimization). You don't
> trade a safety property for a retention bump in ordering.

**Phase 3 — corpus (an experiment to *disprove*, not a moat to assume).** Seed a ~20-entry
hand-curated set of what you can legally obtain — TORs, award notices, published scoring
methodology, expert-authored exemplar sections — **not** 20 confidential winning proposals.
Gate the embeddings/pgvector investment behind the eval harness below.

**Senior tier (parallel track, off the $299 critical path).** Full 23-field `ReviewOutput`,
full versioning, human-in-the-loop — the same engine at full depth.

---

## Folded-in improvements

### 1. Claim-level provenance
Every material assertion is a `Claim` tagged with `Provenance`
(`uploaded_document | applicant_library | inferred | gap`). This satisfies the repo standard of
distinguishing hard evidence from inference, and makes `gap` claims surfaceable to the user
rather than silently smoothed over.

### 2. Immutable generation snapshots
`GenerationSnapshot` records `contextHash`, `promptHash`, and the `documentManifest` per run.
This is what makes "explain why run 2 differs from run 1" answerable and operationalizes the
"no silent overwrite" standard as a system property, not a thing a human remembers. Pair it with
`generation_status` (the existing operational truth) rather than inventing a parallel state machine.

### 3. Loss-reason instrumentation
Whenever the auto-scorer flags weakness, a reviewer edits heavily, or a run fails, capture a
`LossReason` (`missing_evidence | rubric_miss | financial_inconsistency | unsupported_claim |
formatting_gap | corrigendum_missed`). This is higher-value training data than completed
proposals alone, and it turns CSIM-style incidents into structured signal automatically.

---

## Eval harness (gates Phase 3 spend)

Before standing up embeddings, build a small eval set of known cases — starting with CSIM
(corrigendum catch, double-weighted criteria, co-financing math). Run the same real tenders
through the pipeline **with and without** retrieval and measure lift on:

- corrigendum/disqualifier detection (did the watcher catch the change),
- estimated-vs-actual score alignment on cases with known outcomes,
- reviewer edit volume (proxy for draft quality).

If retrieval's lift is marginal, the moat was Phase 1 + the scoring self-check all along — and
you've saved yourself a vector store you didn't need.

---

## Guardrail (non-negotiable)

The engine emits `DraftSection` / `ScoreResult` only. Rendering exits **exclusively** through
`pdfDocs.tsx`. The off-pipeline ReportLab break in the CSIM learnings is the failure that
recurs unless the interface makes the rendering primitive the only door out.
