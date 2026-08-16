# Submissions workflow (EOI · RFQ · ITB · RFP)

The paid per-submission product: vendor intake → ops drafting → QA → client
review → final-mile submission → outcome + debrief. Ported June 2026 from the
design handoff and then aligned file-by-file to the runnable prototype
(`~/Downloads/handoff-submissions 2/prototype/sub-*.jsx` — the prototype is the
spec; a fidelity pass on 2026-06-12 matched schemas, audit math, copy and UI
mechanics to it). **Read this before touching anything under
`src/lib/submissions/` or the two Submissions surfaces.**

## The two surfaces, one order object

| Surface | Where | Data |
|---|---|---|
| Vendor — Submissions page | `/dashboard/proposals` → `src/components/workbench/pages/SubmissionsPage.tsx` + `src/components/workbench/submissions/*` | `GET/POST /api/dashboard/submission-orders*` |
| Ops — fulfillment queue (03b) | `/admin/submissions` → `src/app/admin/submissions/page.tsx` | `GET /api/admin/submission-orders`, `PATCH …/[id]` |

Both read the same `submission_orders` row. "Live-sync" is polling (vendor 25s
while an order is in production, admin 30s) — replace with websockets only if
volume demands it. `events[]` is append-only and is the truth log; the client
sees ops events labeled "TenderPath".

## Module map (`src/lib/submissions/`)

| File | Owns |
|---|---|
| `types.ts` | The SPEC §1 order object, action contracts, wizard draft shape |
| `flows.ts` | **The four format schemas** — steps, blocks, deliverables (+ envelope), declarations, eliminators, QA checklist, shepherd checklist, pay copy. Adding a 5th format = adding a schema here; no new UI code |
| `docs-catalog.ts` | Required documents (prototype ids: inc/reg/tax/bank/cap/coc/hs/dp/ungm/fin/manu/cat/warr/cv3) + the three resolution paths: `draft` (we author, flagged for signature) / `request` (third-party paper — never fabricated) / `guided` (registrations, e.g. UNGM). Each gen carries cta/blurb/ask/result copy; the gen-panel ask input travels to ops on the order. Plus universal Upload / Acknowledge |
| `audit.ts` | Pure completeness math shared by wizard (advisory) and commission endpoint (authoritative). Prototype semantics: every visible field counts (static pre-fills satisfy until edited; showIf-hidden don't count); only a docs-block's `required` subset counts; **elimination risks = the curated block-level blockers only** (ungm/fin/cv3 …) — a regular missing doc reduces % but never hard-blocks. Gate: tender ∧ no `open` blockers ∧ ≥80% |
| `stages.ts` | Stage machine + per-actor transition guards (`canTransition`) |
| `store.ts` | `ensureSubmissionsSchema()` (mirrors `scripts/migrate.mjs`), guarded last-write-wins transitions (0-row update ⇒ `ORDER_CHANGED` 409, never silent clobber), client/admin action appliers, server-side wizard drafts |
| `doc-content.ts` | `docContent(order)` — reader block model built ONLY from the order's own intake; the PDF export renders the same blocks |
| `nudges.ts` | Deadline nudges (review-waiting / final-unsubmitted / debrief-window), URGENT inside 4 days |

Smoke: `npx tsx scripts/submissions-smoke.ts` (audit gate, stage guards,
docContent, nudges — run it after touching any of the above).

## Guided tender workspace (Sprint 1)

The wizard's first step also owns the private solicitation set. A recognized
matched EOI/RFQ/ITB/RFP deep-links with `?start=<format>&match=<id>`, carries
the official source and verified agency portal into the draft, and stores a
sanitized `tenderPack` manifest beside `tenderContext` in
`submission_orders.intake_fields`.

Public files are imported by `POST /api/dashboard/tender-pack/import`; portal-
gated files use the existing direct private upload flow. Both paths produce
owner-only vault rows and authenticated download URLs. Autosave and order
creation rebuild the manifest from `vault_documents.user_id = caller`; never
trust a client-supplied vault id, file URL, filename, or extraction status.

See `docs/agents/sprint-1-guided-tender-workspace.md` for caps, portal sources,
failure behavior, early-adopter ranking, and the preview acceptance walk.

## Portal companion (Sprint 2)

The same first step now tracks a seven-check portal hand-off: notice, verified
route, supplier-confirmed access, private pack, core solicitation role,
amendment/Q&A check, and cutoff/envelope confirmation. Derived checks are
recomputed from the current tender and owner-scoped manifest; only the three
explicit confirmations and bounded timestamps persist in
`WizardDraftState.portalCompanion` and `intake_fields.portalCompanion`.

The portal opens in a user-initiated adjacent browser window when the browser
allows it, with a direct official-link fallback. No iframe, credential custody,
session replay, signing, or submission authority is introduced. See
`docs/agents/sprint-2-portal-companion.md` for the contract and acceptance walk.

## Evidence-backed tender requirements (Sprint 3)

Once readable tender files exist, the account user can explicitly build a
tender-specific compliance map. The authenticated generation route rebuilds
the owner-scoped manifest, reads amendments and Q&A before the base documents,
and returns administrative, technical, financial, and submission requirements
with source excerpts and concrete actions.

`WizardDraftState.tenderRequirements` persists supplier statuses and notes.
Its pack fingerprint makes the map visibly stale when files or document roles
change; same-pack regeneration preserves progress, changed-pack regeneration
does not. Draft and order routes normalize the bounded state again, and the
order snapshot carries it under `intake_fields.tenderRequirements`. The map is
advisory in Sprint 3 and does not change the existing 80% payment gate. See
`docs/agents/sprint-3-tender-requirements.md`.

## Production trust gate (Sprint 4)

The two-ICP A–Z fixtures are now a release gate: customer-safe assessment
errors, recoverable failed assessments, notice-authoritative submission routes,
reliable authenticated small-file uploads, truthful pack readiness, traced
PDF.js runtime files, and shared-demo profile reset. See
`docs/agents/sprint-4-production-trust-gate.md`.

## Former workflow continuity sprint

The former Sprint 5 is no longer an independently sequenced build. Addressable
drafts, repair controls, mobile scope, and model observability were redistributed
across the enterprise roadmap according to design-partner value. See
`docs/agents/sprint-5-workflow-continuity.md` and
`docs/product/enterprise-response-roadmap-2026-07-20.md`.

## Organisation and client tenancy

The former consultancy-only Sprint 6 has become Enterprise Sprint E1. All team
accounts require an organisation/membership/role boundary; adviser accounts
add an explicit client/legal-entity boundary across every customer object.
Per-client envelope encryption remains a separate, demand-gated security
architecture step, not a UI promise. See
`docs/agents/sprint-6-consultancy-tenancy.md` and
`docs/product/enterprise-response-roadmap-2026-07-20.md`.

## Payment seam (work-order-first, like every other paid service)

1. Wizard "Pay $X & start drafting" → `POST /api/dashboard/submission-orders`
   re-audits server-side, upserts the **unpaid** `submission_orders` row + a
   billing `work_orders` row (plan `proposal-draft`, service_slug
   `submission-<type>`). In the invite-only pilot it atomically redeems the
   account's single founder-issued credit and starts fulfillment immediately;
   once commerce is enabled it returns a `/pay?…&submission_order_id=` hand-off.
2. `/pay` (untouched payment surface: card / USDT / wire / **free first-
   submission credit**) → `/api/pay/checkout` verifies submission-order
   ownership, **skips the LLM fulfillment gate** (the wizard gate is the gate),
   prices per type via the dormant `STRIPE_PRICE_SUBMISSION_*` envs (falls back
   to the package price until they exist), return_url →
   `/dashboard/proposals?placed=<id>`.
3. Credit fulfillment or webhook → `createWorkOrderFromCheckout` finds the linked submission order →
   `markSubmissionOrderPaidByWorkOrder` (sets `paid_at` = SLA clock start,
   appends the order-placed event, clears the wizard draft, sends the
   order-received email), then kicks the drafting run.

The wizard never embeds payment-bearing code — deliberate deviation from the
prototype's inline card, to keep all payment paths on the proven surface.

## Drafting run (2026-08-16 — supersedes "no LLM auto-fulfillment")

Before this change a paid order sat in `intake` until ops clicked through
three stages by hand, and the only "document" was `docContent()`'s template —
a reformatted echo of the wizard intake. Ops advancing the stages produced no
writing, so a customer could be emailed "draft ready for review" for a pack
nobody had written.

- `src/lib/submissions/draft-llm.ts` writes named **prose slots** per format,
  grounded in the extracted `tenderRequirements` (each item carries an evidence
  excerpt from the source document), the intake answers, and the selected
  references. Claims are labelled evidenced / inferred / gap.
- `docContent(order, company, prose?)` consumes those slots and **falls back
  per slot** to the deterministic text. Document structure, envelopes, formats
  and the whole export pipeline (reader · PDF · DOCX · XLSX · ZIP) are
  unchanged, so an absent `ANTHROPIC_API_KEY` or a failed call degrades to
  exactly the previous behaviour instead of breaking delivery.
- `src/lib/submissions/drafting-run.ts` runs post-response via `after()` from
  the shared fulfillment seam in `work-orders.ts` (covers both the Stripe
  webhook and the invite-only credit path; the bundled-EOI path triggers from
  the order route). It is **idempotent at the claim** — a guarded UPDATE on
  `generation_status`/`stage`, so two lambdas cannot double-draft or
  double-email. It walks `intake → drafting → qa → review` and sends the
  review-ready email.
- Release to the client is **automatic** (founder decision, 2026-08-16).
  Because no human gates it, evidence gaps are posted to the client-visible
  timeline before release rather than being swallowed.
- `generation_status` is `not_started | generating | ready | skipped | failed`;
  `skipped` means the template stood in. Both columns self-heal in
  `ensureSubmissionsSchema()` **and** live in `scripts/migrate.mjs`.

**Buyer-facing prose rule (load-bearing).** `note` blocks render into the
exported PDF *and* DOCX with a "QA" label, so anything in a block reaches the
procurement panel. Documents must never name TenderPath, an internal QA step,
the vault, or the intake, and must never narrate the submission's own
incompleteness — a panel reads that as an unfinished bid. The generator strips
such sentences defensively (`BANNED_SENTENCE`) and `scripts/submissions-smoke.ts`
asserts none survive. The model is also forbidden from computing derived
figures (years in business, totals, counts) that are not written in the intake.

## Copy rules (load-bearing — do not soften)

- Verb is **"start" / "pay & start drafting"** — never "commission".
- Service recovery next to the start decision: a late committed draft, or a
  submission rejected because of a compliance error introduced by TenderPath,
  receives a full service-fee refund. Supplier omissions, agency changes after
  cutoff, portal outages, late supplier submission, and award outcome are
  excluded.
- We draft, **the user signs and submits** — the shepherd guides, never claims
  we filed.
- Never fabricate third-party paper; "request and chase" language only.
- Tax treatment must come from the notice or user confirmation; agency-local-
  time-zone and envelope-separation warnings stay.
- Exports are **one ZIP per envelope, never a merged document**.
- Losses are data: debrief lessons end with what changed in the system.

## Real vs. not-yet-wired (SPEC §5 backend contracts)

| Contract | Status |
|---|---|
| 1 · Payment | **Live** (through the existing checkout seam; per-type prices dormant until the 6 Stripe envs exist) |
| 2 · Doc pipeline | **Versioned reader + PDF/XLSX/DOCX/ZIP exports live**: every qa→review release seals an immutable `artifact_versions[]` snapshot. Revision N+1 appends without overwriting N; the reader and versioned download route select the same snapshot. `renderSubmissionDeliverablePdf` (shared pdfDocs.tsx primitives), real XLSX for "XLSX + PDF" deliverables (exceljs), and real DOCX for "DOCX + PDF" ones (`src/lib/submissions/docx.ts`, `docx` package) all use that snapshot. Per-deliverable download is available from review on; envelope ZIPs are final/submitted only. **Prose is now written by `draft-llm.ts` on payment** (see "Drafting run"), with per-slot fallback to the template |
| 3 · Third-party request engine | **Letters + chase-due live, sending manual**: `src/lib/submissions/request-letters.ts` drafts the auditor/supplier/bank/client letter (addressed to the wizard's ask contact) — ops copies it from the queue card and sends from the ops mailbox; a red "chase due" chip appears when a `requested` blocker is >48h old (epoch = paid_at). Auto-send + arrival webhook are future work |
| 4 · Inbound agency mail | **Endpoint built, DORMANT**: `POST /api/inbound/agency-mail` (in PUBLIC_PATHS; 503 until `INBOUND_MAIL_SECRET` is set) maps `tp-####@…` → order, appends an UNANSWERED `qna[]` entry + event + ops email — ops posts the answer/impact (we never auto-claim a verdict). Provisioning needs in.tenderpath.me MX + a provider that verifies DKIM/SPF and forwards with the shared secret. The drawer's paste-forward path stays; the address is still not shown in the UI until provisioned |
| 5 · Amendment watcher | **Live for linked tenders**: `watchSubmissionAmendments()` runs on the daily bot-nudges cron (08:30 UTC, after the 06:00 crawl) — a moved source deadline becomes an `amendments[]` entry + due update + client event + an ops email demanding the draft re-base. Hand-entered notices (no tender_id) stay manual via the queue's amendment recorder |
| 6 · Nudge scheduler | **Live + observable**: immediate "draft ready for review" email is awaited on the qa→review release; each revision has its own Resend idempotency key and delivery-ledger row. The daily pass sends final-pack T-3/T-1/T-0, review T-3/T-1, and debrief day-7 nudges (exact-day buckets ⇒ idempotent), Telegram when linked else email. `/api/admin/email-health` exposes configuration and recent accepted/failed/skipped sends. WhatsApp waits for its Meta template setup. |

## Before first real charge (carried from SPEC §8/§9)

- Create the 4 `STRIPE_PRICE_SUBMISSION_*` prices (else charges the package price while displaying it correctly on /pay — the wizard shows the per-type number, so create the prices first).
- Currency: lines support a currency field; Stripe billing is USD-only today.
- `npm run migrate` or first-hit self-heal creates/extends the workflow tables.
- `npm run rehearsal:first-client -- --base-url=<preview>` is the merge gate:
  it seeds short-lived competing tenants, exercises the one-use credit,
  consent boundary, two sealed revisions, downloads, receipt, and email health,
  then removes its tagged customer rows.
