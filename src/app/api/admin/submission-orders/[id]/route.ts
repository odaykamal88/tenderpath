/* Ops actions on one submission order — stage advances (guarded by the SPEC §2
 * ops transitions), drafting progress, client-timeline notes, Q&A answers,
 * amendments, blocker resolution, outcome + debrief recording. Every action
 * appends to events[]; the client's timeline updates on their next poll. */

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";
import type { AdminOrderAction } from "@/lib/submissions/types";
import {
  applyAdminAction,
  getAdminOrderAccessContext,
  getOrderForAdmin,
  OrderStateError,
} from "@/lib/submissions/store";
import { runSubmissionRevision } from "@/lib/submissions/drafting-run";
import { sendSubmissionReviewReadyEmail } from "@/lib/submissions/notify";
import {
  activeSupportAccess,
  recordSupportAccessEvent,
} from "@/lib/privacy/support-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// The revisions → qa advance regenerates the draft INLINE (ops waits for the
// result, unlike the post-response client path), so this route needs the same
// ceiling as the other generation routes. 300s is the Vercel Pro maximum — do
// NOT raise it, the deploy is rejected above it.
export const maxDuration = 300;

const ADMIN_ACTIONS = new Set([
  "advance",
  "set_progress",
  "post_note",
  "record_outcome",
  "record_debrief",
  "answer_qna",
  "add_amendment",
  "resolve_blocker",
]);

async function requireOrderContentAccess(adminId: number, orderId: number) {
  const context = await getAdminOrderAccessContext(orderId);
  if (!context) return { ok: false as const, status: 404, error: "Order not found." };
  if (!context.workOrderId) {
    return { ok: false as const, status: 403, error: "Customer content is locked." };
  }
  const access = await activeSupportAccess(context.ownerUserId, context.workOrderId);
  if (!access) {
    await recordSupportAccessEvent({
      ownerUserId: context.ownerUserId,
      workOrderId: context.workOrderId,
      actorUserId: adminId,
      eventType: "access_denied",
      purpose: "No active customer grant",
      metadata: { submissionOrderId: orderId },
    });
    return {
      ok: false as const,
      status: 403,
      error: "Customer content is locked. Ask the customer to grant temporary access in Account → Privacy & access.",
    };
  }
  return { ok: true as const, context, access };
}

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(request);
  if (!guard.authorized) return guard.response!;
  const { id: idRaw } = await ctx.params;
  if (!/^\d+$/.test(idRaw)) return NextResponse.json({ error: "Bad order id." }, { status: 400 });
  const id = Number(idRaw);

  try {
    const accessResult = await requireOrderContentAccess(guard.user!.id, id);
    if (!accessResult.ok) {
      return NextResponse.json({ error: accessResult.error, code: "CUSTOMER_CONTENT_LOCKED" }, { status: accessResult.status });
    }
    const order = await getOrderForAdmin(id);
    if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });
    await recordSupportAccessEvent({
      ownerUserId: accessResult.context.ownerUserId,
      workOrderId: accessResult.context.workOrderId!,
      actorUserId: guard.user!.id,
      eventType: "content_read",
      purpose: accessResult.access.purpose,
      metadata: { submissionOrderId: id },
    });
    return NextResponse.json({ order: { ...order, contentLoaded: true } });
  } catch (error) {
    console.error("[tp:submissions:admin_detail_failed]", {
      orderId: id,
      adminId: guard.user!.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Could not load customer content." }, { status: 500 });
  }
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(request);
  if (!guard.authorized) return guard.response!;
  const { id: idRaw } = await ctx.params;
  if (!/^\d+$/.test(idRaw)) return NextResponse.json({ error: "Bad order id." }, { status: 400 });
  const id = Number(idRaw);

  let actionForLog: string | null = null;
  try {
    const body = (await request.json()) as AdminOrderAction;
    actionForLog = body?.action ?? null;
    if (!body?.action || !ADMIN_ACTIONS.has(body.action)) {
      return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }
    const accessResult = await requireOrderContentAccess(guard.user!.id, id);
    if (!accessResult.ok) {
      return NextResponse.json({ error: accessResult.error, code: "CUSTOMER_CONTENT_LOCKED" }, { status: accessResult.status });
    }

    // "Revisions applied → re-run QA" must actually apply the revisions.
    // Advancing out of `revisions` used to be a bare status flip, so the client
    // got their original prose re-released with a fresh "ready" email. Run the
    // revision generation instead — it regenerates against the client's notes
    // and performs the qa → review walk and the email itself.
    //
    // Also the recovery lever for an order that entered `revisions` before this
    // path existed: the client-side trigger only fires on review → revisions,
    // which such an order has already passed.
    if (body.action === "advance" && body.to === "qa") {
      const current = await getOrderForAdmin(id);
      if (current?.stage === "revisions") {
        const result = await runSubmissionRevision(id);
        await recordSupportAccessEvent({
          ownerUserId: accessResult.context.ownerUserId,
          workOrderId: accessResult.context.workOrderId!,
          actorUserId: guard.user!.id,
          eventType: "content_write",
          purpose: accessResult.access.purpose,
          metadata: { submissionOrderId: id, action: "revision_regenerate" },
        });
        const fresh = await getOrderForAdmin(id);
        if (!result.ok) {
          console.warn("[tp:submissions:revision_manual_failed]", { orderId: id, result });
          return NextResponse.json(
            {
              order: fresh ? { ...fresh, contentLoaded: true } : null,
              error: result.skippedReason === "generation_unavailable"
                ? "Re-drafting failed, so the revision was not released. The draft is unchanged — try again."
                : "This revision round has already been applied.",
              code: "REVISION_NOT_APPLIED",
            },
            { status: 409 },
          );
        }
        return NextResponse.json({
          order: fresh ? { ...fresh, contentLoaded: true } : null,
          revision: result,
        });
      }
    }

    const order = await applyAdminAction(id, body);
    await recordSupportAccessEvent({
      ownerUserId: accessResult.context.ownerUserId,
      workOrderId: accessResult.context.workOrderId!,
      actorUserId: guard.user!.id,
      eventType: "content_write",
      purpose: accessResult.access.purpose,
      metadata: { submissionOrderId: id, action: body.action },
    });

    // Draft ready for review → immediate, awaited client email. The stage
    // advance remains successful if Resend rejects the mail, but the response
    // and delivery ledger make that failure visible to ops.
    let notification: Awaited<ReturnType<typeof sendSubmissionReviewReadyEmail>> | null = null;
    if (body.action === "advance" && body.to === "review") {
      try {
        const rows = await sql`SELECT email FROM users WHERE id = ${order.userId} LIMIT 1`;
        notification = await sendSubmissionReviewReadyEmail(order, (rows[0]?.email as string | null) ?? null);
      } catch (err) {
        console.error("[tp:submissions:review_email_failed]", {
          orderId: order.id,
          error: err instanceof Error ? err.message : String(err),
        });
        notification = { status: "failed", reason: err instanceof Error ? err.message : String(err) };
      }
    }

    return NextResponse.json({ order: { ...order, contentLoaded: true }, notification });
  } catch (err) {
    if (err instanceof OrderStateError) {
      const status = err.code === "NOT_FOUND" ? 404 : err.code === "ORDER_CHANGED" ? 409 : 422;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    console.error("[tp:submissions:admin_action_failed]", {
      orderId: id,
      action: actionForLog,
      adminId: guard.user!.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Action failed — try again." }, { status: 500 });
  }
}
