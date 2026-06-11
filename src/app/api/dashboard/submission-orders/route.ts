/* Vendor submission orders.
 *
 * GET  — the viewer's orders + derived deadline nudges.
 * POST — commission: re-audits the draft server-side (the wizard's numbers are
 *        advisory; this gate is authoritative), persists the pending order +
 *        its billing work_orders row, and returns the /pay hand-off URL.
 *        Payment itself stays on the proven /pay surface (card / USDT / wire /
 *        free credit); fulfillment flips the order live via the webhook seam
 *        in createWorkOrderFromCheckout. */

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";
import { track } from "@/lib/telemetry/funnel";
import { isSubmissionCode } from "@/lib/workbench/pricing";
import type { SubmissionCode, WizardDraftState } from "@/lib/submissions/types";
import { EMPTY_DRAFT } from "@/lib/submissions/types";
import { flowFor } from "@/lib/submissions/flows";
import {
  auditDraft,
  buildDeliverables,
  buildIntakeFields,
  buildIntakeSummary,
  PAY_GATE_PCT,
} from "@/lib/submissions/audit";
import {
  linkWorkOrder,
  listOrdersForUser,
  putDraft,
  upsertPendingOrder,
} from "@/lib/submissions/store";
import { buildNudges } from "@/lib/submissions/nudges";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = await requireAuth(request);
  if (!guard.authorized) return guard.response!;
  try {
    const orders = await listOrdersForUser(guard.user!.id);
    return NextResponse.json({ orders, nudges: buildNudges(orders) });
  } catch (err) {
    console.error("[tp:submissions:list_failed]", {
      userId: guard.user!.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Could not load submissions." }, { status: 500 });
  }
}

interface CommissionBody {
  type?: string;
  draft?: Partial<WizardDraftState>;
}

export async function POST(request: Request) {
  const guard = await requireAuth(request);
  if (!guard.authorized) return guard.response!;
  const user = guard.user!;

  let typeForLog: string | null = null;
  try {
    const body = (await request.json()) as CommissionBody;
    const typeRaw = (body.type ?? "").toUpperCase();
    typeForLog = typeRaw;
    if (!isSubmissionCode(typeRaw)) {
      return NextResponse.json({ error: "Unknown submission format." }, { status: 400 });
    }
    const type = typeRaw as SubmissionCode;
    const flow = flowFor(type);
    const draft: WizardDraftState = { ...EMPTY_DRAFT, ...(body.draft ?? {}) };

    // Authoritative server-side gate (SPEC §3): tender chosen ∧ no open
    // blockers ∧ completeness ≥ 80%. We won't draft a submission we know will
    // be thrown out.
    const audit = auditDraft(flow, draft);
    if (!audit.canPay) {
      return NextResponse.json(
        {
          error: !audit.tenderChosen
            ? "Choose the opportunity first."
            : audit.openBlockers.length > 0
              ? "Resolve or acknowledge each elimination risk before paying — we won't draft a submission we know will be thrown out."
              : `Intake is ${audit.pct}% complete — the drafting gate is ${PAY_GATE_PCT}%.`,
          code: "PAY_GATE",
          pct: audit.pct,
          open_blockers: audit.openBlockers,
        },
        { status: 409 },
      );
    }

    // Persist the draft snapshot (it survives the /pay round-trip; cleared on
    // payment), then the pending order itself.
    await putDraft(user.id, type, { ...draft } as WizardDraftState).catch(() => {});

    const tender = draft.tender!;
    const order = await upsertPendingOrder({
      userId: user.id,
      type,
      priceCents: flow.price * 100,
      tender: tender.title.trim().slice(0, 300),
      agency: tender.agency?.trim()?.slice(0, 200) || null,
      source: tender.source?.trim()?.slice(0, 200) || null,
      portal: tender.portal?.trim()?.slice(0, 200) || null,
      tenderId: tender.tenderId ?? null,
      pipelineItemId: tender.pipelineItemId ?? null,
      due: tender.due ?? null,
      value: tender.value ?? null,
      fit: tender.fit ?? null,
      completeness: audit.pct,
      blockers: audit.blockers.filter((b) => b.state !== "resolved"),
      intake: buildIntakeSummary(flow, draft),
      intakeFields: buildIntakeFields(draft),
      deliverables: buildDeliverables(flow),
    });

    // Billing row — the existing checkout flow is work-order-first, and the
    // free-credit / USDT / wire paths all key off it.
    let workOrderId = order.workOrderId;
    if (!workOrderId) {
      const woRows = await sql`
        INSERT INTO work_orders (
          user_id, plan, service_slug, status, payment_status,
          amount_cents, currency, email, pipeline_item_id, tender_title, agency, intake
        ) VALUES (
          ${user.id}, 'proposal-draft', ${`submission-${type.toLowerCase()}`}, 'new', 'pending',
          ${flow.price * 100}, 'usd', ${user.email}, ${order.pipelineItemId},
          ${order.tender}, ${order.agency}, ${JSON.stringify({ submission_order_id: order.id, submission_type: type })}::jsonb
        )
        RETURNING id
      `;
      workOrderId = woRows[0].id as number;
      await linkWorkOrder(order.id, workOrderId);
    }

    await track(
      "submission_commissioned",
      { type, submission_order_id: order.id, work_order_id: workOrderId, completeness: audit.pct },
      { userId: user.id },
    );

    const payParams = new URLSearchParams({
      plan: "proposal-draft",
      submission_type: type,
      work_order_id: String(workOrderId),
      submission_order_id: String(order.id),
      tender: order.tender.slice(0, 120),
    });
    if (order.agency) payParams.set("agency", order.agency.slice(0, 120));
    if (order.pipelineItemId) payParams.set("pipeline_item_id", String(order.pipelineItemId));

    return NextResponse.json({
      order,
      work_order_id: workOrderId,
      pay_url: `/pay?${payParams.toString()}`,
    });
  } catch (err) {
    console.error("[tp:submissions:commission_failed]", {
      userId: user.id,
      type: typeForLog,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Could not start this submission." }, { status: 500 });
  }
}
