# Sprint 3 — Evidence-backed tender requirements

Sprint 3 turns the private solicitation set into a tender-specific compliance
cockpit:

`private tender pack → source-backed requirements → accountable response work`

It closes the gap between merely storing tender documents and knowing what the
supplier must do next. The output is advisory: the supplier still verifies the
live notice and TenderPath's existing paid-intake gate remains authoritative.

## Early-adopter relevance

| Rank | Capability | Relevance now | Why |
|---|---|---:|---|
| P0 | Source-linked administrative blockers | Very high | Avoidable disqualification is the sharpest early-adopter pain; every blocker now carries the published evidence and a concrete action. |
| P0 | Amendment/Q&A-first reading order | Very high | A stale requirement is worse than no requirement. Corrigenda and binding clarifications must override the original pack. |
| P0 | Pack fingerprint and visible stale state | Mandatory | Changing a file or its role immediately invalidates the current map instead of silently presenting old guidance. |
| P0 | Owner-scoped document loading | Mandatory | The generator re-authorizes every vault id against the caller before reading any extracted text. |
| P1 | Administrative / technical / financial / submission grouping | High | Mirrors the way a principal or solo operator delegates tender work without assuming a bid team exists. |
| P1 | Supplier status and owner notes | High | Turns analysis into accountable work and carries it through autosave and the order snapshot. |
| Deferred | Hard-gating payment on extracted requirements | Later | The model must be calibrated on real early-adopter packs before an AI-derived item can block a paid workflow. |
| Deferred | Automatic portal submission | Out of scope | The supplier continues to sign, certify, submit, and retain the acknowledgement. |

## Production contract

### User-triggered private processing

- The compliance map runs only when the account user selects **Build compliance
  map**.
- The route authenticates the caller, rebuilds the manifest through
  `sanitizeTenderPackForUser`, and reads text only from matching
  `vault_documents.user_id` rows.
- The UI discloses that private tender text is sent to TenderPath's configured
  AI processor. Portal credentials, sessions, cookies, and MFA data are never
  part of the request.
- The expensive generation route is rate-limited and has stable error logs.
- If the configured AI processor is unavailable or returns no source-verifiable
  items, TenderPath falls back to a conservative directive scan. The fallback
  uses exact excerpts, returns a `partial` map, and says so in the UI instead of
  failing the workflow.

### Evidence and authority

- Amendments/corrigenda are read first, binding Q&A second, then the base
  solicitation, TOR, guidelines, annexes, and supporting files.
- Every requirement must carry an owned document id, canonical document name,
  evidence excerpt, and confidence level. Unknown document ids are removed
  during normalization.
- Categories are administrative, technical, financial, and submission.
- Severity is `BLOCK` / `HIGH` / `MED` / `LOW`, matching TenderPath's review
  language. `BLOCK` means credible administrative rejection risk, not a weak
  scoring section.
- The extractor is told not to invent common UN rules. When documents are
  unreadable or incomplete, the map is `partial` or fails explicitly.

### Freshness and workflow continuity

- `packFingerprint` is derived from the sanitized manifest's document ids,
  roles, extraction states, and character counts.
- A pack or role change preserves the prior map for context but labels it
  stale and makes refresh the next action.
- User status and notes survive a same-pack regeneration by stable requirement
  id. They do not silently carry across a changed pack.
- Draft autosave and order creation normalize the map again. The paid order
  stores it under `intake_fields.tenderRequirements` for fulfillment.
- This sprint does not change the existing 80% payment gate. Early-adopter
  usage should calibrate extraction quality before that boundary moves.

## Acceptance

Run:

```bash
npm run smoke:sprint3
npm run smoke:sprint2
npm run smoke:sprint1
npx tsx scripts/submissions-smoke.ts
npm run security:sprint0
npx tsc --noEmit
npm run lint
npm run build
```

Then walk a Vercel preview:

1. Sign in and start a WHO or UNOPS RFP from a matched tender.
2. Import or upload a readable solicitation and label any corrigendum/Q&A.
3. Build the compliance map and confirm every item shows a source and action.
4. Mark one requirement ready, add an owner note, reload, and verify both
   persist.
5. Change a document role and verify the map becomes stale.
6. Refresh the map and verify stale progress does not bleed into the changed
   pack.
7. Confirm the review step summarizes requirement readiness without changing
   the existing payment gate.

## Explicitly out of scope

- representing AI extraction as legal or procurement advice;
- inventing missing clauses, eligibility rules, scores, or deadline details;
- treating an AI-derived requirement as a payment blocker before calibration;
- reading another account's files through a supplied vault id;
- signing, certifying, or submitting on the supplier's behalf.
