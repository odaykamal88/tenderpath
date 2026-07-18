import { NextResponse, after } from "next/server";
import { requireAuth } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";
import { generateProposalPackage } from "@/lib/proposal-package/generate-proposal";
import { generateProposalPackageV2 } from "@/lib/proposal-package/generate-proposal-v2";
import { PROPOSAL_PLAN, PROPOSAL_MAX_ATTEMPTS } from "@/lib/proposal-package/types";
import {
  checkRerunQuota,
  recordRerun,
  rateLimitedResponseBody,
  PROPOSAL_RERUN_LIMIT,
  PROPOSAL_RERUN_WINDOW_HOURS,
} from "@/lib/proposal-package/rate-limit";
import { enqueueProposalGeneration, reapStaleGenerating } from "@/lib/proposal-package/queue";
import { extractSupplementaryDocRefs } from "@/lib/proposal-package/legacy-bridge";
import { withOwnerArtifactUrl } from "@/lib/proposal-package/public-artifact";
import { authenticatedArtifactUrl } from "@/lib/vault/storage";

// Sprint 6b dispatch flag — mirrors the one in /api/proposals/generate.
// Default v2 (new scoring engine); env PROPOSAL_ENGINE=v1 reverts.
const PROPOSAL_ENGINE: "v1" | "v2" = (process.env.PROPOSAL_ENGINE === "v1") ? "v1" : "v2";

// Sprint 11 (revised for Hobby plan compatibility). Originally designed
// around a Vercel cron job that drained a 'pending' queue; Vercel's cron
// tier on the Hobby plan rejects anything more frequent than once-per-day,
// which makes the cron-based drain useless for interactive UX. The revised
// design uses next/server's after() to fire the engine post-response inside
// the same lambda's lifecycle — the user gets an instant 'pending' ACK and
// the engine runs in the background of the same invocation, bounded by
// maxDuration. No cron, no scheduler, no plan upgrade required.
//
// Trade-off: each enqueue burns one lambda budget (~300s on Pro, less on
// Hobby). Long-tail engine runs that exceed the budget time out. The reaper
// at the top of every enqueue resets stuck 'generating' rows on the next
// trigger so the user can retry without a permanent stuck state.
const PROPOSAL_QUEUE_ENABLED = process.env.PROPOSAL_QUEUE_ENABLED !== "false";

export const runtime = "nodejs";
// Vercel Pro caps maxDuration at 300s. Sprint 6b-2 set this to 800s
// (mis-remembering the ceiling as 900s) — the build succeeded but Vercel
// rejected the lambda config at deploy time, putting the deployment in
// ERROR state with no signal in the build log. Every deploy from Sprint
// 6b-2 to 8b failed for this reason. If the v2 engine path legitimately
// needs more than 300s, the right answer is a background job (Sprint 6c
// commit message tagged this as deferred), not a higher number.
export const maxDuration = 300;

/**
 * Sprint 6b. Drop the engine's SKU sales fields (rationale, ctaCopy, plus
 * the top-level routed_gaps + cascades duplicates) from output JSONB BEFORE
 * the response goes to the client.
 *
 * Background: gap-routing.ts still emits routedTo + rationale + ctaCopy on
 * every gap (kept for analytics + future internal-review tooling), and the
 * acceptance-shape mirrors score.routedGaps at top-level. The $299 page
 * never renders these — but React serializes the entire `output` prop into
 * the hydration JSON, so leaving them in puts "Start Roster Fast-Track
 * ($749)" into view-source on every page load. This strip mirrors the one
 * in /dev/proposal-preview/[name]/page.tsx that proved the principle.
 *
 * `routedTo` is retained as opaque analytics data.
 */
function stripSkuSalesFields<T>(pkg: T): T {
  if (!pkg || typeof pkg !== "object") return pkg;
  const row = pkg as { output?: unknown };
  if (!row.output || typeof row.output !== "object") return pkg;

  const output = row.output as Record<string, unknown>;
  const { routed_gaps: _routed_gaps, cascades: _cascades, ...restOutput } = output;
  void _routed_gaps;
  void _cascades;

  let cleanedOutput: Record<string, unknown> = restOutput;
  const score = restOutput.score;
  if (score && typeof score === "object") {
    const s = score as Record<string, unknown>;
    if (Array.isArray(s.routedGaps)) {
      const cleanedGaps = s.routedGaps.map((g) => {
        if (!g || typeof g !== "object") return g;
        const gap = g as Record<string, unknown>;
        const { rationale: _r, ctaCopy: _c, ...gapRest } = gap;
        void _r;
        void _c;
        return gapRest;
      });
      cleanedOutput = { ...restOutput, score: { ...s, routedGaps: cleanedGaps } };
    }
  }

  return { ...row, output: cleanedOutput } as T;
}

interface WorkOrderRow {
  id: number;
  user_id: number | null;
  email: string | null;
  payment_status: string | null;
  plan: string;
  service_slug: string | null;
  // Sprint 13: surface supplementary-doc flags in the GET response so the
  // dashboard panel can show "Engine read 1 corrigendum + 1 Q&A round".
  intake: Record<string, unknown> | null;
}

interface PackageRow {
  id: number;
  output: unknown;
  pdf_url: string | null;
  generation_status: string | null;
  generation_attempts: number | null;
  error_message: string | null;
  created_at: string;
}

async function ensureOwnedProposalOrder(
  request: Request,
  rawId: string,
): Promise<
  | { ok: true; order: WorkOrderRow }
  | { ok: false; response: NextResponse }
> {
  const guard = await requireAuth(request);
  if (!guard.authorized) return { ok: false, response: guard.response! };

  const numericId = Number(rawId);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    return { ok: false, response: NextResponse.json({ error: "Invalid work order id" }, { status: 400 }) };
  }

  const rows = await sql`
    SELECT id, user_id, email, payment_status, plan, service_slug, intake
    FROM work_orders
    WHERE id = ${numericId}
      AND (
        user_id = ${guard.user!.id}
        OR (user_id IS NULL AND email IS NOT NULL AND LOWER(email) = LOWER(${guard.user!.email}))
      )
    LIMIT 1
  ` as unknown as Array<WorkOrderRow>;

  const order = rows[0];
  if (!order) {
    return { ok: false, response: NextResponse.json({ error: "Work order not found" }, { status: 404 }) };
  }
  if (order.plan !== PROPOSAL_PLAN && order.service_slug !== "proposal") {
    return { ok: false, response: NextResponse.json({ error: "Not a proposal-draft work order" }, { status: 400 }) };
  }
  return { ok: true, order };
}

async function loadPackage(workOrderId: number): Promise<PackageRow | null> {
  const rows = await sql`
    SELECT id, output, pdf_url, generation_status, generation_attempts, error_message, created_at
    FROM proposal_packages
    WHERE work_order_id = ${workOrderId} AND plan = ${PROPOSAL_PLAN}
    ORDER BY created_at DESC
    LIMIT 1
  ` as unknown as Array<PackageRow>;
  return rows[0] ?? null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const result = await ensureOwnedProposalOrder(request, id);
  if (!result.ok) return result.response;

  const pkg = await loadPackage(result.order.id);

  // Sprint 13 dashboard-hints bundle:
  //   - quota: surface the per-user 10-re-runs-per-24h rate-limit headroom
  //     so the dashboard can render "X / 10 re-runs used today" near the
  //     Re-run button (proactive UX vs Sprint 6c's reactive 429).
  //   - supplementary_docs: surface which corrigendum / Q&A doc keys the
  //     intake actually carries, so the panel can render "Engine read 1
  //     corrigendum + 1 Q&A round against the original TOR" — closing the
  //     loop for AGENTS.md's "explain why the engine made a recommendation".
  // Both reads are non-recording: quota just LOOKS at the proposal_rerun_log;
  // supplementary docs are derived from the cached work_orders.intake.
  const quota = result.order.user_id != null ? await checkRerunQuota(result.order.user_id) : null;
  const supplementaryRefs = extractSupplementaryDocRefs(result.order.intake);
  const supplementary_docs = {
    amendment_loaded: supplementaryRefs.some((r) => r.role === "amendment"),
    qa_loaded: supplementaryRefs.some((r) => r.role === "qa"),
    count: supplementaryRefs.length,
  };

  const quotaPayload = quota
    ? {
        limit: PROPOSAL_RERUN_LIMIT,
        window_hours: PROPOSAL_RERUN_WINDOW_HOURS,
        remaining: quota.remaining,
        used: PROPOSAL_RERUN_LIMIT - quota.remaining,
        next_allowed_at: quota.resetAt?.toISOString() ?? null,
      }
    : null;

  if (!pkg) {
    return NextResponse.json({
      exists: false,
      payment_status: result.order.payment_status,
      // Sprint 6b. The proposal-draft plan has unlimited re-runs against this
      // tender. The UI omits the regenerate-counter when these are null.
      max_attempts: null,
      remaining_regenerations: null,
      quota: quotaPayload,
      supplementary_docs,
    });
  }
  return NextResponse.json({
    exists: true,
    package: withOwnerArtifactUrl(stripSkuSalesFields(pkg), result.order.id),
    payment_status: result.order.payment_status,
    // PROPOSAL_MAX_ATTEMPTS is Infinity; JSON.stringify renders it as null,
    // which is the same signal the UI uses to suppress the counter.
    max_attempts: Number.isFinite(PROPOSAL_MAX_ATTEMPTS) ? PROPOSAL_MAX_ATTEMPTS : null,
    remaining_regenerations: null,
    quota: quotaPayload,
    supplementary_docs,
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const result = await ensureOwnedProposalOrder(request, id);
  if (!result.ok) return result.response;

  if (result.order.payment_status !== "paid") {
    return NextResponse.json({ error: "Payment not confirmed yet for this work order." }, { status: 402 });
  }

  // Proposal-draft re-run rate limit. PROPOSAL_MAX_ATTEMPTS = ∞ means
  // nothing else in the codepath caps cost; this is the only place that
  // bounds runaway Anthropic spend (10 re-runs / 24h per user). The check
  // is keyed to the authenticated user, not the work-order, so a user
  // with multiple WOs shares one quota across all of them.
  const userId = result.order.user_id;
  if (userId != null) {
    const quota = await checkRerunQuota(userId);
    if (!quota.allowed) {
      return NextResponse.json(rateLimitedResponseBody(quota), { status: 429 });
    }
    // Record BEFORE generation so simultaneous triggers can't both squeak
    // past a check seeing the same recent-runs count. Failures inside
    // generation still count — protecting Anthropic budget is the goal.
    await recordRerun({ userId, workOrderId: result.order.id });
  }

  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "1";

  // Sprint 11 (revised for Hobby). The route writes the row as 'pending',
  // schedules the engine via after(), and returns immediately. The user gets
  // an instant ACK; the engine runs post-response inside this same lambda's
  // lifecycle (bounded by maxDuration). The dashboard panel
  // (ProposalPackagePanel.tsx) already polls until generation_status='ready'
  // so the UX transition is transparent — 'pending' → 'generating' → 'ready'
  // under the existing "Drafting your proposal…" copy.
  //
  // Reaping stale 'generating' rows happens here too, since we no longer
  // have a cron worker to do it on a schedule. A row stuck in 'generating'
  // from a prior dead lambda (>10min old) is reset to 'pending' before we
  // enqueue, so the user's click is the trigger for clean-up + new run.
  //
  // Falls back to the synchronous v2 path when the env flag is off
  // (PROPOSAL_QUEUE_ENABLED=false) or PROPOSAL_ENGINE=v1.
  if (PROPOSAL_ENGINE === "v2" && PROPOSAL_QUEUE_ENABLED) {
    void force; // The engine always force-runs on 'pending' rows; the query-
                // string flag is preserved for parity with the legacy path.
    try {
      // Reap before enqueue so a previously-dead row doesn't squat over
      // this enqueue's intent.
      const reaped = await reapStaleGenerating();
      if (reaped.reaped > 0) {
        console.log("[proposal-package:reaped_stale_pre_enqueue]", {
          count: reaped.reaped,
          ids: reaped.reapedIds,
        });
      }

      const enqueueResult = await enqueueProposalGeneration({
        workOrderId: result.order.id,
        userId: result.order.user_id ?? null,
        pipelineItemId: null, // existing row will preserve its prior value via COALESCE in upsertPackage
        plan: PROPOSAL_PLAN,
        tenderTitle: null,
        agency: null,
        tenderUrl: null,
        intake: {},
        stripeSessionId: null,
      });

      // Schedule the engine post-response. after() keeps the lambda alive
      // until this Promise resolves OR maxDuration hits — whichever comes
      // first. Errors are caught + logged: the row stays in 'generating'
      // and the next user trigger reaps + retries.
      after(async () => {
        try {
          console.log("[proposal-package:after_engine_start]", {
            workOrderId: result.order.id,
            packageId: enqueueResult.packageId,
          });
          const v2 = await generateProposalPackageV2({
            workOrderId: result.order.id,
            force: true,
          });
          console.log("[proposal-package:after_engine_done]", {
            workOrderId: result.order.id,
            packageId: enqueueResult.packageId,
            ok: v2.ok,
            attempts: v2.attempts,
            skippedReason: v2.skippedReason ?? null,
          });
        } catch (err) {
          console.error("[proposal-package:after_engine_failed]", {
            workOrderId: result.order.id,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      });

      return NextResponse.json({
        ok: true,
        status: "pending",
        package_id: enqueueResult.packageId,
        attempts: enqueueResult.attempts,
        message: "Generation started. The dashboard will update once it lands (typically 5–7 minutes).",
        remaining_regenerations: null,
      });
    } catch (err) {
      console.error("[proposal-package:enqueue_failed]", {
        workOrderId: result.order.id,
        err: err instanceof Error ? err.message : String(err),
      });
      return NextResponse.json(
        { error: "Could not enqueue the generation. Try again." },
        { status: 500 },
      );
    }
  }

  // Sprint 6b fallback (PROPOSAL_ENGINE=v1 or PROPOSAL_QUEUE_ENABLED=false):
  // legacy synchronous engine call.
  const generation = PROPOSAL_ENGINE === "v2"
    ? await (async () => {
        const v2 = await generateProposalPackageV2({ workOrderId: result.order.id, force });
        return {
          ok: v2.ok,
          attempts: v2.attempts,
          packageId: v2.packageId,
          skippedReason: v2.skippedReason,
          error: v2.error,
          zipUrl: null as string | null,
        };
      })()
    : await generateProposalPackage({ workOrderId: result.order.id, force, silent: false });

  if (!generation.ok) {
    if (generation.skippedReason === "max_attempts") {
      // Sprint 6b: with PROPOSAL_MAX_ATTEMPTS = Infinity this branch is
      // unreachable from the proposal-draft plan, but we keep the case
      // wired so a future per-day rate-limit can reuse it.
      return NextResponse.json(
        { error: "Daily re-run rate limit reached. Try again in a few hours." },
        { status: 429 },
      );
    }
    if (generation.skippedReason === "not_paid") {
      return NextResponse.json({ error: "Payment not confirmed yet." }, { status: 402 });
    }
    return NextResponse.json({ error: generation.error ?? "Generation failed." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    skipped: generation.skippedReason ?? null,
    package_id: generation.packageId,
    zip_url: generation.zipUrl ? authenticatedArtifactUrl(result.order.id) : null,
    attempts: generation.attempts,
    remaining_regenerations: null,
  });
}
