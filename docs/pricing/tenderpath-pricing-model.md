---
title: TenderPath Pricing Model
date: 2026-04-18
status: canonical
source-of-truth: src/lib/pricing.ts
---

# TenderPath Pricing Model

All user-facing prices are defined in `src/lib/pricing.ts`. Do not hardcode prices anywhere else.

---

## Tiers

### Tier 1 — Bid/No-Bid Analyst
- **Price**: $39/analysis (range: $29–49)
- **Billing**: Per tender evaluated
- **CTA**: "Analyze this tender"
- **Positioning**: "Devex shows the tender; TenderPath tells you whether to bother."
- **Input**: Tender URL or uploaded TOR
- **Output**: Bid/no-bid recommendation, win probability, scoring criteria breakdown, gap analysis, required docs checklist, estimated effort

### Tier 2 — Proposal Draft
- **Price**: $299/submission (range: $199–399)
- **Billing**: Per submission, NOT subscription
- **CTA**: "Draft my proposal"
- **Positioning**: Collapses ~30 hours of proposal writing into 3–4 hours of review
- **Output**: 80% complete technical proposal, financial template, compliance package
- **Turnaround**: 48–72 hours

### Tier 3 — Grants + Tenders Matching ⭐ Most Popular
- **Price**: $49/mo
- **Billing**: Monthly subscription, cancel anytime
- **CTA**: "Get weekly matched tenders & grants"
- **Positioning**: Matched digest, not raw alerts
- **Output**: Weekly email of 5–10 AI-matched opportunities scored by fit; includes grants + tenders; Arabic + English

### Tier 4 — Roster Fast-Track
- **Price**: $749/roster (range: $499–999)
- **Billing**: Per agency registration
- **CTA**: "Fast-track my roster"
- **Positioning**: Productized consulting at ~10% of consultant rates
- **Scope**: Complete vendor/roster registration for a specific agency (WFP, UNICEF, UNDP, etc.)
- **Output**: All documents prepared, submitted, followed up

---

## Backend TierSlug Mapping

The backend API returns `recommended_tier` using legacy slugs (do not change these):

| Backend slug | Maps to |
|---|---|
| `tender-intelligence` | Grants + Tenders Matching (T3) |
| `submission-package` | Proposal Draft (T2) |
| `strategic-partnership` | Roster Fast-Track (T4) |

These legacy slugs are normalized to canonical form by `SLUG_ALIASES` / `resolveTierSlug()` in `src/lib/pricing.ts`; the display data for each tier lives in the `TIERS` array there.

---

## Rules

- All prices displayed to users must import from `src/lib/pricing.ts`
- Never hardcode prices in component files
- `TierSlug` type in `src/lib/types.ts` must not be changed (backend-coupled)
- Billing period varies by tier — never use `/mo` universally
