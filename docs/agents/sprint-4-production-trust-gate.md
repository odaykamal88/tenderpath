# Sprint 4 — Production trust gate

Status: implemented locally; production preview verification remains the ship gate.

## Why this sprint exists

The 2026-07-19 two-ICP A–Z stress test found six faults that can make a first
customer distrust an otherwise useful workflow: raw model-provider errors,
failed-assessment redirect loops, contradictory submission routes, stalled
uploads, unreadable authority documents presented as ready, and shared-demo
profile contamination. These are activation blockers, not polish.

## Shipped scope

1. Public assessment APIs return a stable customer-safe error and code while
   retaining the raw provider failure in server logs and the operator-only
   assessment record.
2. Failed assessments keep the customer in Workbench with a retry state;
   submissions and the private vault remain available.
3. A notice-specific submission channel overrides the agency-default portal,
   guide, and portal steps everywhere in the companion.
4. Small uploads use a same-origin authenticated route that creates the
   owner-scoped vault row; larger direct-to-Blob uploads fail explicitly if
   progress stalls instead of leaving the UI at 0% indefinitely.
5. Pack readiness requires every saved file to be readable. An unreadable core
   document, amendment, or Q&A blocks “ready” and becomes the next action.
6. The PDF.js worker is explicitly traced into every document-reading
   serverless route.
7. Every shared-demo sign-in clears the prior visitor's company profile and
   mined facts before the active assessment repopulates it.

## Acceptance gate

- `npm run smoke:sprint1`
- `npm run smoke:sprint2`
- `npm run smoke:sprint3`
- `npm run smoke:sprint4`
- `npm run lint`
- `npm run build`
- Inspect the built vault upload/extract trace and confirm
  `pdf.worker.mjs` is included.
- On a Vercel preview, repeat the UNICEF email-route fixture, upload the base
  RFP plus amendment PDF, force one unreadable file, and confirm the UI remains
  partial with the authority repair as the next action.

## Explicitly deferred

Mobile wizard structure and browser-worker health belong to Sprint 5.
Consultancy multi-client tenancy and per-client encryption belong to Sprint 6.
