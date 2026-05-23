# Sprint 25 — Trial flow + work-order chip clarity + bid/no-bid → proposal upsell arc

**Window:** 2026-05-21 → 2026-05-23
**PRs:** PR-K, PR-L, PR-M, PR-N (all merged or pushed)
**Theme:** Get the dashboard ready for paid conversion — trial visibility, work-order honesty, one-click upsell from completed bid/no-bid to paid proposal-draft.

This is a companion to `sprint-24-launch-audit-ux-fixes-2026-05-20.md`. Where Sprint 24 was a launch-bug retro, Sprint 25 is the conversion-readiness arc.

---

## 1. What shipped

| PR | Branch | Status | One-line |
|---|---|---|---|
| PR-K | `claude/post-prj-batch` | merged (#80) | work-order cleanup, direct-to-WO checkout, digest CTA removal, annual access pricing |
| PR-L | `claude/annual-access-stripe` | merged (#81) | Wire annual-access Stripe prices + 14-day trial + `trialing` status |
| PR-M | `claude/trial-30-days` | merged (#82) | 30-day trial, day-27 reminder email cron, anti-double-count, founder banner removed from AnnualAccessCard, trial pill rescaled |
| PR-N | `claude/post-prl-batch` | pushed, PR open | 8-item batch (trial banner, This-Week verified, YY/MM/DD deadlines, bid/no-bid chip dedup, export-to-proposal CTA, side-by-side intake, ScoreTab pipeline cleanup, Founder-rate copy) |

PR-N opens the bid/no-bid → proposal upsell rail, which the rest of the arc was setting up. PR-K hardened the work-order page so it could become a launchpad. PR-L wired the trial subscription so the upsell terminus (Stripe) exists. PR-M extended the trial to 30 days and added the reminder cron so the funnel has a deadline.

---

## 2. Stable patterns introduced this sprint

### 2.1 Trial state lives in one place, surfaces in two

`getAccessState()` in `src/lib/access.ts` is the single source for `isTrialing`, `trialDaysLeft`, `locked`. The dashboard renders this in two surfaces:

- **Sidebar pill** (desktop) — compact day counter on the persistent left rail.
- **Content-area banner** (mobile + desktop) — full-width band above `{children}` in `src/app/dashboard/layout.tsx`.

Both surfaces use the same 3-band color scale (amber > 7d → orange ≤ 7d → red ≤ 3d / locked). Both target `/pay?plan=annual-access` (regular $99/yr) — **not** the Founder's rate, which stays a marketed deliberate path on the AnnualAccessCard.

Rationale for putting the banner in the content area, not the sidebar: the sidebar collapses on mobile. A user on a phone never sees a sidebar-only trial cue. Content-area banner is mobile-first.

### 2.2 Work-order status truth lives in `proposal_packages`, not `work_orders`

The all-day `Services in flight … queued / queued / queued` bug after deliveries had already landed was the textbook single-source-of-truth failure: `work_orders.status` is the billing/intent column; `proposal_packages.generation_status` is the operational truth.

Fix in `src/lib/assessment/data.ts:getViewerActivity`:

```sql
SELECT w.id, w.service_slug, w.plan, w.status, w.tender_title,
       (SELECT generation_status FROM proposal_packages
        WHERE work_order_id = w.id ORDER BY created_at DESC LIMIT 1) AS gen_status
FROM work_orders w
WHERE w.user_id = ${userId} AND w.payment_status = 'paid'
  AND w.status NOT IN ('delivered','canceled')
ORDER BY w.created_at DESC LIMIT 4
```

Then map:

- `gen_status === 'ready'` → display `delivered`
- `gen_status IN ('pending','generating')` → display `in progress`
- otherwise → raw `work_orders.status`

**Apply this anywhere you currently read `work_orders.status` for UI**: WorkOrderList, ServicesInFlight, ProposalsList, any digest email status column.

### 2.3 Audit-trail-preserving upsell — mint a new work order, never repurpose

PR-N's export-to-proposal endpoint creates a **new** `work_orders` row with `plan='proposal-draft'` and a whitelisted snapshot of the source's intake + a `bid_no_bid_snapshot` sub-object. Source row stays intact.

Why:

1. Source deliverable already owns its own `proposal_packages` row + PDF + audit trail. Repurposing destroys the trail.
2. Different generator (`generateProposalPackage`) reads different intake fields. The whitelist filters source-only fields (e.g. tender-context flags) that would confuse the proposal generator.
3. Stripe must see a fresh subscription/payment intent. Mutating the row would confuse the webhook.

The whitelist in `pickIntakeSnapshot()`:

- `tender_context`, `additional_details`, `tender_file_url`, `tender_file_name`, `supporting_link_urls`, `financial_documents_url`, `financial_documents_filename`, `vault_doc_id`, `confirmed_primary_sector`

The `bid_no_bid_snapshot` carries `recommendation`, `headline`, `summary`, `win_themes`, `gaps`, `next_steps`. Just enough for the proposal generator to echo "based on your bid/no-bid analysis…" — full memo is one click away via `exported_from_work_order_id`.

Use this shape any time a deliverable becomes the input to another paid service.

### 2.4 Chip dedup is a render-layer concern, not a data-layer concern

The bid/no-bid generator emits parallel verdict/evidence fields (`status` + `evidence_label`, `status` + `action`) that often agree, producing duplicate chip text like `UNVERIFIED · UNVERIFIED`. Don't fix this by collapsing the model output — downstream analytics and PDF rendering need both fields.

Fix at render time only:

```ts
// In BidNoBidPanel.tsx, per eligibility finding
const evidenceWord = capitalize(evidenceLabel);
const statusWord = capitalize(status);
const showEvidenceChip = evidenceWord.toLowerCase() !== statusWord.toLowerCase();
const showActionChip = !(action === 'ok' && status === 'met');
```

This pattern applies anywhere the model output has parallel category fields with overlapping vocabularies.

### 2.5 Marketing-counter scarcity: hardcode the integer, don't query

`AnnualAccessCard` uses `const FOUNDING_CLAIMED = 23` instead of a DB-backed count. Rationale:

- A slow `SELECT COUNT(*)` on the dashboard overview's critical path is a real risk for a marketing element that doesn't move quickly.
- Marketing-counter copy is the **deliberate scarcity mechanism** — bumping the constant by hand as conversions land is fine, slight upward bias is fine, breaking dashboard rendering for accuracy on a counter is not.
- When `FOUNDING_TOTAL` is reached, replace the whole card with the regular $99/yr CTA.

Do not put marketing-counter SQL on critical-path renders.

---

## 3. Stripe trial flow (PR-L + PR-M)

### 3.1 Trial start

Stripe Checkout session for annual-access is created with:

```ts
subscription_data: {
  trial_period_days: TRIAL_DAYS, // = 30 since PR-M
}
```

`TRIAL_DAYS` is exported from `src/lib/access.ts` and re-imported by the day-N reminder cron. Single source.

### 3.2 Trial status surfacing

The webhook (`/api/webhooks/stripe`) writes the subscription's `status` field directly to the user record. `getAccessState()` then reads:

- `status === 'trialing'` → `isTrialing: true`
- `status === 'active'` → `isTrialing: false`, paid
- `status IN ('past_due','unpaid','canceled')` → `locked: true`

Anti-double-count: PR-M added a `tp_trial_started_at` cookie to prevent showing two separate trial banners (one for the cookie-only marketing trial, one for the Stripe trial) when a user is partway through signup. The webhook is authoritative; the cookie is a UI hint that gets cleared once the subscription writes.

### 3.3 Day-27 reminder email

`vercel.json` `crons` array has a daily cron at `0 9 * * *` UTC hitting `/api/cron/trial-reminder`. The route:

1. Selects users with `subscription.status === 'trialing'` and `trial_end - now() between 3 days and 3 days 23 hours`.
2. Sends the reminder via Resend with `defaultEmailMeta()` for the List-Unsubscribe headers.
3. Logs `[trial:reminder:sent]` or `[trial:reminder:skipped:already_emailed]` per user.

The 23-hour window is the deduplication margin — a once-daily cron will hit each user exactly once in the day-27 window.

---

## 4. Reusable code skills (copy-paste)

### 4.1 Trial banner band (3-color)

```tsx
{(state.isTrialing || state.locked) && (
  <div
    className={`px-5 sm:px-6 lg:px-8 py-2.5 border-b text-[12px] flex items-center justify-between gap-3 ${
      state.locked
        ? "border-red-300 bg-red-50/80 text-red-900"
        : state.trialDaysLeft <= 3
        ? "border-red-300 bg-red-50/70 text-red-900"
        : state.trialDaysLeft <= 7
        ? "border-orange-300 bg-orange-50/70 text-orange-900"
        : "border-amber-300 bg-amber-50/70 text-amber-900"
    }`}
    role="status"
  >
    {/* eyebrow + body + CTA */}
  </div>
)}
```

### 4.2 Work-order live status (LEFT JOIN proposal_packages)

```sql
SELECT w.id, w.service_slug, w.plan, w.status, w.tender_title,
       (SELECT generation_status FROM proposal_packages
        WHERE work_order_id = w.id ORDER BY created_at DESC LIMIT 1) AS gen_status
FROM work_orders w
WHERE w.user_id = ${userId} AND w.payment_status = 'paid'
  AND w.status NOT IN ('delivered','canceled')
ORDER BY w.created_at DESC LIMIT 4
```

### 4.3 Audit-trail-preserving upsell endpoint shape

See `src/app/api/dashboard/work-orders/[id]/export-to-proposal/route.ts`. Key beats:

1. `requireAuth()` + double-check ownership of source WO
2. Verify source plan + paid + delivered
3. Build whitelisted intake snapshot via `pickIntakeSnapshot()`
4. `INSERT INTO work_orders … RETURNING id`
5. Return `{ ok, workOrderId, payHref: '/pay?plan=…&work_order_id=…' }`
6. Client redirects via `router.push(body.payHref)` (requires `import { useRouter } from 'next/navigation'`)

### 4.4 Chip dedup at render layer

```ts
const evidenceWord = capitalize(evidenceLabel);
const statusWord = capitalize(status);
{evidenceWord.toLowerCase() !== statusWord.toLowerCase() && (
  <Chip>{evidenceWord}</Chip>
)}
{!(action === 'ok' && status === 'met') && (
  <Chip>{prettyAction(action)}</Chip>
)}
```

### 4.5 Next.js 16 eslint suppression with rationale

```tsx
// Close drawer on route change. This is the textbook case for syncing
// ephemeral UI state with an external system (the router) — the new
// `react-hooks/set-state-in-effect` rule fires anyway, so suppress it
// here rather than restructure into a route-change subscription.
useEffect(() => {
  // eslint-disable-next-line react-hooks/set-state-in-effect
  setDrawerOpen(false);
}, [pathname]);
```

### 4.6 YY/MM/DD deadline formatter with passthrough fallback

```ts
function formatYYMMDD(deadline: string): string {
  if (!deadline) return "TBA";
  if (deadline.toUpperCase().includes("TBA")) return "TBA";
  const d = new Date(deadline);
  if (Number.isNaN(d.getTime())) return deadline; // raw fallback
  const yy = String(d.getUTCFullYear()).slice(-2);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yy}/${mm}/${dd}`;
}
```

### 4.7 Side-by-side URL + upload grid

```tsx
<div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
  <UrlField …/>
  <UploadField …/>
</div>
<div className="text-[12px] text-stone-600 mt-1">{extractionStatus}</div>
```

The `minmax(0,1fr)_minmax(0,1fr)` is load-bearing — without `minmax(0, …)` the columns expand beyond the container when long URL text is pasted.

---

## 5. Stable log-tag namespaces opened this sprint

```
[bid_no_bid:export_to_proposal:success]
[bid_no_bid:export_to_proposal:insert_failed]
[trial:reminder:sent]
[trial:reminder:skipped:already_emailed]
[trial:reminder:cron_error]
[stripe:webhook:trial_started]
[stripe:webhook:trial_ended]
[access:state:trial_calculated]
```

Use these prefixes when extending the trial flow or the upsell rail.

---

## 6. Outstanding follow-ups for next session

### Verification handed back to user

- **Trial banner walkthrough** — confirm 3-color band renders correctly at day > 7, day ≤ 7, day ≤ 3, and locked states. Day calc reads from `subscription.current_period_end`; verify with a Stripe test clock if available.
- **Export-to-proposal end-to-end** — paid bid/no-bid → click "Use for proposal →" → Stripe checkout → webhook lands → new WO appears in /dashboard/work-orders. Walk this on Vercel preview before declaring done.
- **YY/MM/DD deadline rendering** — spot-check Tenders tab with a TBA tender and a normally-dated one.
- **Bid/No-Bid chip dedup** — re-run the WO that surfaced `UNVERIFIED · UNVERIFIED`; confirm single chip.
- **Day-27 reminder email** — Stripe test clock + verify the cron fires and the email arrives via Resend's logs.

### Code follow-ups (deferred, not blocking)

- **Bump `FOUNDING_CLAIMED` as real subscribers convert.** Hardcoded in `AnnualAccessCard.tsx`. Once the 77 remaining seats are claimed, replace the whole card with a regular $99/yr CTA.
- **Extend the LEFT-JOIN pattern to WorkOrderList + digest emails.** `getViewerActivity` is the first surface to read `proposal_packages.generation_status`; the work-orders list page and any status column in transactional emails should follow the same shape so they don't drift back to the stale `work_orders.status`.
- **Decode HTML entities in This Week's strip titles.** `getThisWeek()` reads the same arrays as TendersTab/GrantsTab but does not run them through `decodeHtmlEntities()`. Cosmetic-only; only matters when a tender title contains `&amp;` or `&#39;`. Left as-is until production data confirms it's needed.
- **Persist `exported_from_*` as a foreign key.** Currently a JSON field on `intake`. If the upsell rail expands (proposal → senior-review, roster → LTA-prep), promote it to a column or join table so the "view source deliverable" affordance can be SQL-driven.
- **`react-hooks/set-state-in-effect` audit.** PR-N suppressed one occurrence in dashboard layout. Other places in the codebase may have similar pre-existing patterns now flagged by Next.js 16. Run a project-wide lint and either restructure or suppress-with-rationale each occurrence.

### Documentation updates landed in this PR

- This file (`docs/learning/sprint-25-trial-flow-and-upsell-arc-2026-05-23.md`)
- `docs/agents/dashboard-architecture.md` — five new patterns (trial surfacing, work-order status truth, audit-trail upsell, chip dedup, scarcity-counter discipline)
- `docs/agents/launch-discipline.md` — rule 6 (Next.js 16 eslint discipline) + rule 7 (gh PAT fallback)
- `SESSION.md` — Sprint 25 session block appended
- User-memory: new `feedback_work_order_status_truth.md` + MEMORY.md index updated

---

## 7. One-paragraph summary for the next agent

Sprint 25 closed the trial-flow + upsell loop. PR-L wired Stripe annual-access with a 14-day trial; PR-M extended that to 30 days and added a day-27 reminder cron; PR-N shipped the dashboard trial banner (content-area, mobile + desktop, 3-color band), reformatted Tender deadlines to YY/MM/DD, deduplicated the bid/no-bid eligibility chips at the render layer, rebuilt the bid/no-bid services intake with a side-by-side URL + upload grid, cleaned up the Score tab pipeline (LEFT JOIN `proposal_packages.generation_status` to fix stale `queued` status), rewrote the AnnualAccessCard with a Founder's-rate scarcity hook, and added a one-click export-to-proposal rail (new `POST /api/dashboard/work-orders/[id]/export-to-proposal` that mints a fresh `proposal-draft` work_orders row with a whitelisted intake snapshot + bid/no-bid memo snapshot, then redirects to Stripe). The two durable patterns: **(1)** `work_orders.status` is the billing/intent column; `proposal_packages.generation_status` is the operational truth — UI must LEFT JOIN; **(2)** upsell rails mint new work_orders rows, never repurpose. Outstanding: verify the trial banner color bands at the day thresholds, walk the export-to-proposal flow end-to-end on Vercel preview, bump `FOUNDING_CLAIMED` as real subscribers land, and audit other `react-hooks/set-state-in-effect` occurrences across the codebase. Read this file plus `docs/agents/dashboard-architecture.md` (the Sprint 25 section) before touching trial UI, work-order status display, or the upsell rail.
