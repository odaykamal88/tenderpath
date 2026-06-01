import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";
import { generateProposalPackage } from "@/lib/proposal-package/generate-proposal";
import { generateProposalPackageV2 } from "@/lib/proposal-package/generate-proposal-v2";
import { PROPOSAL_PLAN, PROPOSAL_MAX_ATTEMPTS } from "@/lib/proposal-package/types";
import {
  checkRerunQuota,
  recordRerun,
  rateLimitedResponseBody,
} from "@/lib/proposal-package/rate-limit";
import { enqueueProposalGeneration } from "@/lib/proposal-package/queue";

// Sprint 6b dispatch flag — mirrors the one in /api/proposals/generate.
// Default v2 (new scoring engine); env PROPOSAL_ENGINE=v1 reverts.
const PROPOSAL_ENGINE: "v1" | "v2" = (process.env.PROPOSAL_ENGINE === "v1") ? "v1" : "v2";

// Sprint 11 background-job migration. v2 dispatches to the cron-driven
// worker; v1 stays synchronous for the legacy comparison path. Default true
// so production traffic gets the decoupled UX automatically. Flip
// PROPOSAL_QUEUE_ENABLED=false in the env to fall back to inline generation
// if the worker has a regression we need to bypass quickly.
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
    SELECT id, user_id, email, payment_status, plan, service_slug
    FROM work_orders
    WHERE id = ${numericId} AND (user_id = ${guard.user!.id} OR email = ${guard.user!.email})
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
  if (!pkg) {
    return NextResponse.json({
      exists: false,
      payment_status: result.order.payment_status,
      // Sprint 6b. The proposal-draft plan has unlimited re-runs against this
      // tender. The UI omits the regenerate-counter when these are null.
      max_attempts: null,
      remaining_regenerations: null,
    });
  }
  return NextResponse.json({
    exists: true,
    package: stripSkuSalesFields(pkg),
    payment_status: result.order.payment_status,
    // PROPOSAL_MAX_ATTEMPTS is Infinity; JSON.stringify renders it as null,
    // which is the same signal the UI uses to suppress the counter.
    max_attempts: Number.isFinite(PROPOSAL_MAX_ATTEMPTS) ? PROPOSAL_MAX_ATTEMPTS : null,
    remaining_regenerations: null,
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

  // Sprint 11 background-job migration. v2 + queue enabled → enqueue the
  // job and return immediately; the /api/cron/proposal-worker route picks
  // it up on the next minute tick (~60s) and runs the engine independently
  // of this HTTP request. The user-facing panel (ProposalPackagePanel.tsx)
  // already polls until generation_status === 'ready', so the transition is
  // transparent: status flips 'pending' → 'generating' → 'ready' under the
  // existing "Drafting your proposal…" copy.
  //
  // Falls back to the synchronous v2 path when the env flag is off or
  // PROPOSAL_ENGINE=v1 (legacy comparison path).
  if (PROPOSAL_ENGINE === "v2" && PROPOSAL_QUEUE_ENABLED) {
    void force; // Sprint 11: the worker always force-runs the engine on a
                // 'pending' row; we kept the query-string flag for parity
                // with the legacy synchronous path / future replay tooling.
    try {
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
      return NextResponse.json({
        ok: true,
        status: "pending",
        package_id: enqueueResult.packageId,
        attempts: enqueueResult.attempts,
        message: "Generation enqueued. The worker will pick this up within ~5 minutes; the dashboard polls until it lands.",
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
    zip_url: generation.zipUrl,
    attempts: generation.attempts,
    remaining_regenerations: null,
  });
}
