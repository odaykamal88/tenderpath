# Feedback flywheel — operator runbook

How to drive the proposal feedback flywheel from the admin console. Built across
Phases 1–3 (`docs/agents/proposal-engine-build-plan.md` + the POST-SPRINT-10 /
feedback-flywheel plans). Audience: the founder/curator.

## The one mental model

**The model is frozen. It does not learn from proposals.** What gets less static
is the **curated store** — and a human (you) curates it. The chain is:

> capture structured signal → **you promote the real ones** → only *promoted*
> records affect scoring calibration or rubric extraction.

Nothing you don't promote changes anything. "Less static" never means
"unsupervised."

## The three surfaces

### 1. `/admin/feedback` — the curation queue (the gate)

Every signal lands here as **`captured`**. You **Promote** the real ones and
**Reject** the noise. Only `promoted` records flow downstream.

- **State tabs**: Pending review (captured) / Promoted / Rejected / All.
- **Kind filter**: focus the queue. Auto-captured *loss reasons* are
  high-volume (one set per generated draft) — filter them out with
  `Kind → Outcomes` or `Corrections` when you're reviewing what needs a decision.
- **Per-outcome calibration verdict** on each outcome record: `aligned` /
  `optimistic` / `pessimistic`. **`optimistic`** (we rated the draft strong, it
  lost) is the dangerous miss — pay attention to those.
- **Add extraction correction** form (Loop 4): record a recurring format mistake
  for an agency (or leave agency blank for a global rule). It lands `captured`;
  **promote it** to make the extractor apply it.

### 2. `/admin/proposal-health` — the monitor

Read-only pipeline health, refreshable:

- **Generation status** — ready / needs-remediation / failed / rubric-stale.
  `failed` or `rubric_stale` flips the page to **Degraded**.
- **Run integrity** — per-run checks (Phase 2): `incomplete` (a silent partial),
  `score validity` (shaky/indicative score), `honest-claim` (a draft that
  overpromises an outcome). Investigate anything flagged.
- **Outcome capture** — capture rate + the **win/loss balance**. Low capture or
  all-wins-no-losses means the calibration is drifting optimistic.
- **Score calibration (B2)** — the optimistic-miss rate + whether the score is
  `calibrated` yet. Until calibrated, the customer-facing score stays a *band*,
  not a precise number.
- **Systematic weaknesses (Loop 2)** — criteria flagged across many drafts. A
  criterion that recurs is **one** weakness in extraction or drafting: fix it
  once (often by adding a Loop 4 correction) and every future draft benefits.

### 3. The customer's "How did this bid go?" card

On a delivered proposal work order. The vendor reports the real result; a loss
with a note also becomes a loss-reason signal. You don't touch this — just watch
the capture rate on the monitor, and make sure losses are getting reported
(survivorship bias is the thing that quietly makes the score dishonest).

## Driving each loop

| Loop | What you do |
|---|---|
| **1 — Outcomes** | Nothing to author. Watch capture rate + win/loss on the monitor; **chase losses** as hard as wins. |
| **Curation gate** | On `/admin/feedback`: promote real signal, reject noise. This is the whole safety mechanism. |
| **2 — Systematic weaknesses** | Read the monitor panel. When a criterion recurs, fix it once — usually by adding a Loop 4 correction. |
| **4 — Extraction corrections** | Add a correction for an agency → **promote it** → it becomes a prompt prior so the extractor stops repeating that mistake. Your UN expertise is highest-leverage here. |
| **B2 — Calibration** | Watch the optimistic-miss rate. Once ~20 real outcomes are promoted and misses stay low, the score earns a precise number (a deliberate flip, not automatic). |

## Right now: review the seeded hypotheses

Four **hypothesis** extraction corrections are staged as `captured` (Claude's
best guesses, since there's no real volume yet): UNICEF double-weighting
methodology, UNOPS eligibility in Annex C, WFP %-not-points, and a global
shall-vs-should rule. Open `/admin/feedback` → `Kind: Corrections` → **promote
the ones that match reality, reject/edit the rest.** The moment you promote one,
it shapes extraction. Refine and add more as real tenders come through.

## Non-negotiables

- **Only promoted records matter.** Captured ≠ live.
- **Chase losses.** Optimistic misses are the signal that the score is dishonest.
- **Corrections are priors, not inventions** — they help the extractor read the
  *published* rubric correctly; they never fabricate criteria.
- **Re-running a review is a revision**, not an overwrite — prior outputs are
  preserved (immutable snapshots).
