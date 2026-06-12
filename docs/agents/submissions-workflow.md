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

## Payment seam (work-order-first, like every other paid service)

1. Wizard "Pay $X & start drafting" → `POST /api/dashboard/submission-orders`
   re-audits server-side, upserts the **unpaid** `submission_orders` row + a
   billing `work_orders` row (plan `proposal-draft`, service_slug
   `submission-<type>`), returns a `/pay?…&submission_order_id=` hand-off.
2. `/pay` (untouched payment surface: card / USDT / wire / **free first-
   submission credit**) → `/api/pay/checkout` verifies submission-order
   ownership, **skips the LLM fulfillment gate** (the wizard gate is the gate),
   prices per type via the dormant `STRIPE_PRICE_SUBMISSION_*` envs (falls back
   to the package price until they exist), return_url →
   `/dashboard/proposals?placed=<id>`.
3. Webhook → `createWorkOrderFromCheckout` finds the linked submission order →
   `markSubmissionOrderPaidByWorkOrder` (sets `paid_at` = SLA clock start,
   appends the order-placed event, clears the wizard draft, sends the
   order-received email) and **returns before any LLM auto-fulfillment**.

The wizard never embeds payment-bearing code — deliberate deviation from the
prototype's inline card, to keep all payment paths on the proven surface.

## Copy rules (load-bearing — do not soften)

- Verb is **"start" / "pay & start drafting"** — never "commission".
- Guarantee at the pay button (and now in `/terms#refunds` — a binding
  promise): "Draft late, or rejected for a compliance error we made? Full
  refund — no questions."
- We draft, **the user signs and submits** — the shepherd guides, never claims
  we filed.
- Never fabricate third-party paper; "request and chase" language only.
- VAT-exemption, agency-local-time-zone, and envelope-separation warnings stay.
- Exports are **one ZIP per envelope, never a merged document**.
- Losses are data: debrief lessons end with what changed in the system.

## Real vs. not-yet-wired (SPEC §5 backend contracts)

| Contract | Status |
|---|---|
| 1 · Payment | **Live** (through the existing checkout seam; per-type prices dormant until the 6 Stripe envs exist) |
| 2 · Doc pipeline | **Reader + PDF/XLSX/DOCX/ZIP exports live**: `renderSubmissionDeliverablePdf` (pdfDocs.tsx), real XLSX for "XLSX + PDF" deliverables (exceljs), real DOCX for "DOCX + PDF" ones (`src/lib/submissions/docx.ts`, `docx` package) — all from the SAME block model the reader shows. Gating per the prototype: per-deliverable download from review on (multi-format docs arrive as a small ZIP); envelope ZIPs final/submitted only. Ops prose enrichment is future work |
| 3 · Third-party request engine | **Letters + chase-due live, sending manual**: `src/lib/submissions/request-letters.ts` drafts the auditor/supplier/bank/client letter (addressed to the wizard's ask contact) — ops copies it from the queue card and sends from the ops mailbox; a red "chase due" chip appears when a `requested` blocker is >48h old (epoch = paid_at). Auto-send + arrival webhook are future work |
| 4 · Inbound agency mail | **Endpoint built, DORMANT**: `POST /api/inbound/agency-mail` (in PUBLIC_PATHS; 503 until `INBOUND_MAIL_SECRET` is set) maps `tp-####@…` → order, appends an UNANSWERED `qna[]` entry + event + ops email — ops posts the answer/impact (we never auto-claim a verdict). Provisioning needs in.tenderpath.me MX + a provider that verifies DKIM/SPF and forwards with the shared secret. The drawer's paste-forward path stays; the address is still not shown in the UI until provisioned |
| 5 · Amendment watcher | **Live for linked tenders**: `watchSubmissionAmendments()` runs on the daily bot-nudges cron (08:30 UTC, after the 06:00 crawl) — a moved source deadline becomes an `amendments[]` entry + due update + client event + an ops email demanding the draft re-base. Hand-entered notices (no tender_id) stay manual via the queue's amendment recorder |
| 6 · Nudge scheduler | **Live**: immediate "draft ready for review" email on the qa→review release (admin action route); daily pass on the bot-nudges cron — final-pack T-3/T-1/T-0, review T-3/T-1, debrief day-7 (exact-day buckets ⇒ idempotent), Telegram when linked else email (suppression + unsubscribe headers respected). WhatsApp waits for its Meta template setup. The in-page strip mirrors the same triggers |
| 2 · Doc pipeline | **Reader + PDF/ZIP exports live** (`renderSubmissionDeliverablePdf` in `pdfDocs.tsx`); content = the prototype's prose templates parameterized by real intake. Priced-lines deliverables ("XLSX + PDF") ship a REAL workbook (exceljs). Export gating per the prototype: per-deliverable PDF from review on; envelope ZIPs final/submitted only. DOCX variants + ops prose enrichment are future work |
| 3 · Third-party request engine | **Manual-ops**: the `requested` blocker state + admin "arrived → resolve" exist; templated letters + auto-chase + arrival webhook not built |
| 4 · Inbound agency mail | **Paste-forward only** (drawer textarea → `qna[]`; ops answers with a draft-impact verdict). The `{ref}@in.tenderpath.me` address is NOT provisioned — deliberately not shown in the UI (never show a dead address) |
| 5 · Amendment watcher | **Manual-ops**: admin records amendments (+ deadline move). No source polling |
| 6 · Nudge scheduler | **In-page strip only** (real state-derived). Email/WhatsApp scheduler not wired — `buildUserNudge` in `src/lib/bot/proactive.ts` is the cheap extension point |

## Before first real charge (carried from SPEC §8/§9)

- Create the 4 `STRIPE_PRICE_SUBMISSION_*` prices (else charges the package price while displaying it correctly on /pay — the wizard shows the per-type number, so create the prices first).
- Currency: lines support a currency field; Stripe billing is USD-only today.
- `npm run migrate` or first-hit self-heal creates the two tables; a real
  end-to-end walk on Vercel preview is the merge gate (see SESSION.md entry).
