/* Single submission order — detail + client actions (SPEC §2 client side:
 * approve · request changes · submit final · shepherd · Q&A · debrief ·
 * acknowledge blocker). Ownership-checked on every call; stage transitions are
 * guarded server-side, and a stale transition surfaces ORDER_CHANGED rather
 * than silently clobbering (SPEC §9). */

import { NextResponse, after } from "next/server";
import { requireAuth } from "@/lib/subscription-guard";
import type { ClientOrderAction } from "@/lib/submissions/types";
import {
  applyClientAction,
  getOrderForUser,
  OrderStateError,
} from "@/lib/submissions/store";
import { runSubmissionRevision } from "@/lib/submissions/drafting-run";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// A revision re-runs generation post-response; the lambda stays alive until it
// resolves. 300s is the Vercel Pro ceiling — do NOT raise it.
export const maxDuration = 300;

const CLIENT_ACTIONS = new Set([
  "approve",
  "request_changes",
  "submit_final",
  "shepherd_toggle",
  "lodge_qna",
  "forward_agency_mail",
  "request_debrief",
  "ack_blocker",
]);

function parseId(raw: string): number | null {
  return /^\d+$/.test(raw) ? Number(raw) : null;
}

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAuth(request);
  if (!guard.authorized) return guard.response!;
  const { id: idRaw } = await ctx.params;
  const id = parseId(idRaw);
  if (!id) return NextResponse.json({ error: "Bad order id." }, { status: 400 });
  try {
    const order = await getOrderForUser(guard.user!.id, id);
    if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });
    return NextResponse.json({ order });
  } catch (err) {
    console.error("[tp:submissions:get_failed]", {
      userId: guard.user!.id,
      orderId: id,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Could not load this order." }, { status: 500 });
  }
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAuth(request);
  if (!guard.authorized) return guard.response!;
  const { id: idRaw } = await ctx.params;
  const id = parseId(idRaw);
  if (!id) return NextResponse.json({ error: "Bad order id." }, { status: 400 });

  let actionForLog: string | null = null;
  try {
    const body = (await request.json()) as ClientOrderAction;
    actionForLog = body?.action ?? null;
    if (!body?.action || !CLIENT_ACTIONS.has(body.action)) {
      return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }
    const order = await applyClientAction(guard.user!.id, id, body);

    // Requesting changes must actually re-draft. Without this the order sits in
    // `revisions` holding the ORIGINAL prose until someone re-releases it
    // unchanged — the same silent no-op the first-draft path used to have.
    // Post-response so the client's click returns immediately; idempotent per
    // round, so a double-click cannot double-bill or double-email.
    if (body.action === "request_changes") {
      after(async () => {
        try {
          const result = await runSubmissionRevision(id);
          console.info("[tp:submissions:revision_after_done]", result);
        } catch (err) {
          console.error("[tp:submissions:revision_after_failed]", {
            orderId: id,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      });
    }

    return NextResponse.json({ order });
  } catch (err) {
    if (err instanceof OrderStateError) {
      const status = err.code === "NOT_FOUND" ? 404 : err.code === "ORDER_CHANGED" ? 409 : 422;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    console.error("[tp:submissions:client_action_failed]", {
      userId: guard.user!.id,
      orderId: id,
      action: actionForLog,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Action failed — try again." }, { status: 500 });
  }
}
