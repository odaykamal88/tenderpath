# Proposal Review Report Template

Canonical narrative shape, section order, and tone for any TenderPath proposal review deliverable. Reviews always render through the @react-pdf/renderer primitives in `src/lib/proposal-package/pdfDocs.tsx` and serialise to the `ReviewOutput` shape defined in `service-output-spec.md`. This document covers the report's editorial structure, not the data model.

## Identity

A TenderPath review is **a workflow object, not a consultant report**. The reader is an applicant team with limited time, not a panel hiring a consultancy. Every page must move them closer to submission.

This is the most-frequently-broken rule. Reviewer agents drift toward generic strengths-and-weaknesses prose unless explicitly anchored. The sections below exist to keep the output anchored.

## Required sections, in order

1. **Cover** — reference tag, applicant, call, deadline, prepared by, date, pull quote.
2. **Executive summary** — quantified upside (current → achievable), confidence on threshold clearance, top five fixes in one glance.
3. **Opportunity fit** — what the funder is buying, why this applicant fits, eligibility position.
4. **Why this can win** — strengths matrix, every entry tied to evidence.
5. **Evaluation risk scan** — administrative gates and per-criterion scoring exposure.
6. **Priority fixes** — severity-tagged, owner-assigned, deadline-bound.
7. **Suggested rewrites** — drop-in editorial for the highest-impact sections.
8. **Submission readiness** — checklist + T-minus timeline.
9. **Forward look** (optional, for multi-stage calls) — next-stage gates the applicant should start preparing now.
10. **Bottom line** — one paragraph, decision-shaped, sign-off block.

This order maps directly to the `ReviewOutput` fields. Renderers should not reorder.

## Tone rules

- **Action over analysis.** Every paragraph either tells the applicant what to do or earns the right to be read by quantifying upside or risk.
- **Quantify where possible.** "Could lose 2 points" beats "may reduce score." Severity badges beat adjectives.
- **Cite the rubric verbatim, not in paraphrase.** Evaluators score against specific wording; your review must reference that wording so the applicant can answer it directly.
- **Evidence labels visible.** When the basis for a finding is inference rather than evidence, say so. Trust is built by admitting uncertainty.
- **Drop-in over directional.** If a gap is editorial, write the replacement text. Do not describe what good text would look like — provide it.
- **Owner-and-deadline on every fix.** A fix without an owner is a wish.
- **No generic SaaS framing.** Avoid "strategic alignment", "best practices", "stakeholder engagement" as substitutes for specifics.
- **Preserve workflow identity.** The review is one link in `assessment → matched workflow → service-order → submission → forward-look`. Reference the arc; do not pretend the review is a standalone document.

## Section-by-section requirements

### Cover
- Reference tag (e.g. `REV-XXXX-NNN`).
- Applicant and call identity.
- Deadline.
- Pull-quote: one sentence summarising the verdict. Quotable.
- Confidentiality footer.

### Executive summary
- One paragraph orienting the reader (≤80 words).
- One paragraph quantifying current → achievable score (≤60 words). Required.
- Estimated scoring table: criterion · max · current · achievable. Mirror the rubric exactly. Include section subtotals and grand total.
- Top five fixes table: number · short fix · why · owner. Severity-coloured.

### Opportunity fit
- "What the funder is buying" — one paragraph anchored in the call's stated objectives and lot priorities. Use the funder's own wording.
- "Why this applicant fits" — one paragraph tied to specific applicant evidence (audience numbers, track record, geographic reach, prior wins). No abstractions.
- Eligibility position table: item · position · status. Status uses `ok` / `gap` / `partial` / `unverified` consistent with `service-output-spec.md`.

### Why this can win
- A matrix, not prose. Columns: Strength · Where in proposal · Why it matters.
- Every entry tied to one of: applicant evidence, call-priority alignment, scoring-rubric advantage, competitor-comparison context. Do not list strengths in the abstract.
- 6–10 entries. More dilutes; fewer feels thin.

### Evaluation risk scan
- Two subsections: administrative/eligibility risks, evaluation scoring risks.
- Administrative risks table: risk · level · what to verify before deadline. Level uses the severity vocabulary.
- Scoring risks table: criterion · exposure (in points) · what is missing. Exposure reflects double-weighting where it applies (e.g. `2 pts × 2 = 4 pts` for a double-weighted criterion).
- Close with a quantified verdict note: current score range vs. threshold, with a one-sentence framing of the competitive context.

### Priority fixes
- Ranked highest to lowest by scoring impact.
- Card layout, one fix per card. Each card carries:
  - Rank number.
  - Severity badge (`BLOCK` / `HIGH` / `MED` / `LOW`).
  - Owner and deadline, inline with the badge.
  - The issue, in one bold line.
  - The fix, action-oriented, with drop-in text where possible.
- A `BLOCK` severity item must always appear first. If there is no `BLOCK`, say so explicitly.

### Suggested rewrites
- Two or three rewrites maximum. More dilutes attention.
- Each rewrite has:
  - A heading naming which fix it addresses.
  - Current text, quoted from the applicant's draft, in a quote-box style.
  - Suggested replacement, ready to paste.
  - One line on what changed and why, only if the change isn't obvious.

### Submission readiness
- Checklist table: item · status · action. Status uses the gate vocabulary.
- Includes administrative items (registration, signed declaration, budget estimate, co-financing source) and content items (gender, disability, journalist protection, baselines).
- T-minus timeline: when · who · what. Suggested cadence: today, T-3, T-2, T-1, deadline day. Each row carries an owner.

### Forward look (when applicable)
- Only included when the call has a subsequent stage (e.g. concept note → full application).
- Next-stage scoring grid summarised, with double-weighted and hard-floor criteria flagged.
- Three concrete preparation actions, each tied to a specific gate in the next stage.

### Bottom line
- One paragraph, decision-shaped. What is the single most important thing the applicant must do tonight, and what is the upside of doing all five fixes.
- Followed by a sign-off block: reviewer role, date, call reference, reference tag.

## What the report must not be

- A list of generic best practices.
- A re-summary of the applicant's own proposal.
- A description of the call without specific scoring implications.
- An assessment of the applicant's organisation in the abstract (that's the Assessment Agent's job).
- An exhortation. Statements like "ensure clarity" or "strengthen the narrative" are not fixes.

If a section reads like it could appear in any review for any applicant, it has failed. Anchor harder.

## Severity colour and badge rules

Mirror the project's design tokens. Use the same palette as `pdfDocs.tsx`:
- `BLOCK` and `HIGH` → red (`#b8463f`).
- `MED` → gold (`#b08530`).
- `LOW` → muted grey (`#6b6b6b`).
- Status `ok` → green (`#1f6a3c`). `missing` → red. `partial` / `unverified` → gold.

Badges are small uppercase pills, never full sentences.

## Length envelope

A complete review for a EUR 250K+ grant typically renders to 12–18 pages at the design tokens used in `pdfDocs.tsx`. Shorter than 10 pages risks thinness; longer than 20 risks dilution.

For lower-tier reviews (e.g. `bid-no-bid` on smaller opportunities), the same structure compresses to 4–6 pages by dropping rewrites, forward look, and timeline.

## Versioning header

When a review is a revision (i.e. `revision > 1`), the cover must show a short revision history block: revision number, generated-at, what changed since the prior revision. This is operational, not editorial — it tells the applicant whether their fixes have landed.

## See also

- `service-output-spec.md` — formal data shape of `ReviewOutput`
- `dashboard-architecture.md` — Active Submission Workspace that surfaces these reports
- `managed-agents-setup.md` — Tender Proposal Review Agent (#12)
- `../learning/eu-grant-proposal-review-case-learnings.md` — case that established this template
