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
- clear source provenance.

## Product principle

Do not make it a generic analytics dashboard. Tenderpath should feel like a procurement workflow system, not a vanity KPI panel.
