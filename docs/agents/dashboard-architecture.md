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

---

## Sprint 25 (2026-05-23) — patterns added during the trial-flow + upsell arc

### Trial state surfacing

The dashboard now exposes trial state in **two** places. Both read from the same `state` object built by `getAccessState()` in `src/lib/access.ts`. Do not invent a third source.

- **Sidebar pill** (desktop only) — compact day-counter for the persistent left rail. Recipient is a logged-in user already inside the workspace.
- **Content-area banner** (mobile + desktop, every dashboard page) — full-width band above `{children}` in `src/app/dashboard/layout.tsx`. This is the surface that survives the mobile drawer collapse; never put the trial cue in the mobile drawer alone.

Both surfaces use the same three-band color scale, tied to `state.trialDaysLeft` and `state.locked`:

| Days left | Band | Background | Foreground |
|---|---|---|---|
| > 7 days | default | amber-50 | amber-900 |
| ≤ 7 days | warning | orange-50 | orange-900 |
| ≤ 3 days OR locked | urgent | red-50 | red-900 |

The CTA target for both surfaces is `/pay?plan=annual-access` (regular $99/yr). The Founder's rate is **never** the trial-banner destination — it stays a deliberate marketed conversion on the AnnualAccessCard so the rate's scarcity copy stays intact.

Both surfaces hide entirely for paid / admin users (`state.isTrialing === false` and `state.locked === false`).

### Work-order status source-of-truth

`work_orders.status` is the wrong column to read for UI freshness. It can sit on `in_progress` indefinitely after the deliverable lands, because the generator updates `proposal_packages.generation_status`, not the parent row.

Any dashboard query that surfaces "is this work order ready?" must `LEFT JOIN proposal_packages` and prefer the package's `generation_status` when present:

```sql
SELECT w.id, w.service_slug, w.plan, w.status, w.tender_title,
       (SELECT generation_status FROM proposal_packages
        WHERE work_order_id = w.id ORDER BY created_at DESC LIMIT 1) AS gen_status
FROM work_orders w
WHERE w.user_id = ${userId} AND w.payment_status = 'paid'
  AND w.status NOT IN ('delivered','canceled')
ORDER BY w.created_at DESC LIMIT 4
```

Mapping rules in the data layer (`src/lib/assessment/data.ts:getViewerActivity`):

- `gen_status === 'ready'` → display as `delivered`
- `gen_status IN ('pending','generating')` → display as `in progress`
- otherwise → raw `work_orders.status`

This is a **single-source-of-truth lesson**: the package row is the operational truth; the work-order row is the billing/intent record. Don't conflate them in the UI.

### Audit-trail-preserving upsell flow (bid/no-bid → proposal-draft)

When the user converts a completed deliverable into a follow-on paid service (currently: bid/no-bid → proposal-draft via `POST /api/dashboard/work-orders/[id]/export-to-proposal`), mint a **new** `work_orders` row. Do not mutate the source.

Why a new row:

- The source deliverable already owns its own `proposal_packages` row + PDF + audit trail. Repurposing the row loses that trail.
- Different generators read different intake fields. Pre-loading a whitelisted snapshot into the new row's `intake` lets the downstream generator start grounded without leaking source-only fields it might misinterpret.
- Independent Stripe checkout. The webhook needs to see a fresh subscription/payment intent, not a mutated one.

The whitelist (carried from source `intake` → new `intake`) is enumerated in `pickIntakeSnapshot()` in `src/app/api/dashboard/work-orders/[id]/export-to-proposal/route.ts`. A `bid_no_bid_snapshot` sub-object is also stamped into the new intake so the proposal generator can echo "based on your bid/no-bid analysis…" for continuity. Only high-signal fields (`recommendation`, `headline`, `summary`, `win_themes`, `gaps`, `next_steps`) — full memo lives one click away via the linked `exported_from_work_order_id`.

Apply this pattern any time a deliverable becomes the input to another paid service: new row, snapshot intake, link back via `exported_from_*` fields, redirect to a fresh `/pay?plan=…&work_order_id={new}` URL.

### Bid/No-Bid eligibility chip rendering

The bid/no-bid generator emits two parallel fields per eligibility finding:

- `status: 'met' | 'gap' | 'unverified'` — the verdict
- `evidence_label: 'evidence' | 'inference' | 'gap' | 'unverified'` — how the verdict was reached

These often agree (e.g. `status='gap' + evidence_label='gap'`) and the original UI rendered both as separate chips, producing visually duplicated `UNVERIFIED · UNVERIFIED` and `GAP · GAP` rows. The render layer (`BidNoBidPanel.tsx`) now dedups:

- Hide the evidence chip when `evidenceWord === statusWord` (case-insensitive)
- Hide the action chip when `action === 'ok' && status === 'met'` (the "no further action needed" combo is implicit)

The model still emits both fields — useful for downstream analytics and PDF rendering. The dedup is presentation-only.

### Scarcity-copy counters: hardcoded beats DB-backed

`AnnualAccessCard` uses a hardcoded `FOUNDING_CLAIMED` constant for the "23 of 100 seats left" counter, not a DB query.

Why: a slow `SELECT COUNT(*)` shouldn't block the dashboard overview rendering, and marketing copy that exaggerates conversions by a small amount is **the deliberate scarcity mechanism**. Bump the constant manually as real founders subscribe; once `FOUNDING_TOTAL` is reached, replace the entire card with the regular $99/yr CTA.

Do not put marketing-counter SQL on the dashboard's critical-path render.
