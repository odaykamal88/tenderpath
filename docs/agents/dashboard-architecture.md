# Tenderpath Dashboard Architecture

## Purpose

The dashboard is the operational layer between Tenderpath's data systems and the user. It should make procurement opportunities understandable and actionable.

## Core user jobs

- Understand which tenders matter.
- Understand why they match.
- See deadlines and urgency.
- Track readiness blockers.
- Move from discovery to submission preparation.

## Recommended dashboard modules

### Main dashboard
Show:
- open tenders relevant to this user,
- deadlines in next 7 days,
- count of strong matches,
- latest readiness status,
- recently added matches.

### Tender feed
Each card should show:
- title,
- issuing agency,
- geography,
- opportunity type,
- deadline,
- source,
- match score,
- reason snippets.

### Why matched
Expose a rationale layer:
- matched sectors,
- matched capabilities,
- geography alignment,
- tender-type alignment,
- confidence / caveat notes.

### Readiness workflow
Turn assessment gaps into checklist items with:
- severity,
- fix,
- action steps,
- completion state,
- optional upsell route.

### Active submission workspace
A per-opportunity workspace that surfaces once an applicant commits to pursuing a tender. Distinct from the discovery feed.

Each workspace shows:
- the call's deadline and remaining time,
- the **proposal review readiness state**: `not started`, `draft uploaded`, `review in progress`, `reviewed`, `fixes applied`, `submitted`,
- administrative gates (registration, signed declaration, budget estimate, co-financing source) with `ok` / `missing` / `partial` / `?` status,
- the current and achievable score from the latest review revision,
- the open `BLOCK` / `HIGH` / `MED` / `LOW` priority fixes with owner and deadline,
- a corrigendum/Q&A change indicator if the call has been updated since the last review,
- the review revision history (no silent overwrites),
- the next paid action (bid/no-bid → senior review → proposal package → submission-day kit).

This module answers, for each tracked opportunity:
- **Why this matters**: deadline, score upside, fixes outstanding.
- **Why it matches**: rationale carried from the matched-tender card.
- **What to do next**: the highest-severity unblocked fix, with owner and deadline.

### Tracked-calls feed
A lightweight surface listing opportunities the applicant has flagged for submission. Shows corrigendum/Q&A change badges so applicants notice when a call's rubric or eligibility has shifted between the last review and the deadline.

### Onboarding
Use a guided flow:
1. website URL or business description,
2. confirm detected sectors/capabilities,
3. set preferences,
4. land in the tailored tender feed.

## Data dependencies

The dashboard depends on:
- reliable tender ingestion,
- stored match outputs,
- user preferences,
- latest assessment result,
- subscription gating,
- clear source provenance,
- versioned proposal-review outputs per work-order (see `docs/agents/service-output-spec.md`),
- corrigendum/Q&A change tracking on tracked calls.

## Product principle

Do not make it a generic analytics dashboard. Tenderpath should feel like a procurement workflow system, not a vanity KPI panel.
