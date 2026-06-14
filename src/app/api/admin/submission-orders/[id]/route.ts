/* Ops actions on one submission order — stage advances (guarded by the SPEC §2
 * ops transitions), drafting progress, client-timeline notes, Q&A answers,
 * amendments, blocker resolution, outcome + debrief recording. Every action
 * appends to events[]; the client's timeline updates on their next poll. */

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";
import type { AdminOrderAction } from "@/lib/submissions/types";
import { applyAdminAction, OrderStateError } from "@/lib/submissions/store";
import { sendSubmissionReviewReadyEmail } from "@/lib/submissions/notify";

export const dynamic = "force-dynamic";

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
    const order = await applyAdminAction(id, body);

    // Draft ready for review → immediate client email (SPEC §5 contract 6).
    // Fire-and-forget: a mail failure never fails the stage advance.
    if (body.action === "advance" && body.to === "review") {
      void (async () => {
        try {
          const rows = await sql`SELECT email FROM users WHERE id = ${order.userId} LIMIT 1`;
          await sendSubmissionReviewReadyEmail(order, (rows[0]?.email as string | null) ?? null);
        } catch (err) {
          console.error("[tp:submissions:review_email_failed]", {
            orderId: order.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      })();
    }

    return NextResponse.json({ order });
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
