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
import { COMMERCE_ENABLED } from "@/lib/commerce";
import { track } from "@/lib/telemetry/funnel";
import { isSubmissionCode } from "@/lib/workbench/pricing";
import type { SubmissionCode, WizardDraftState } from "@/lib/submissions/types";
import { EMPTY_DRAFT } from "@/lib/submissions/types";
import { flowFor, PILOT_SLA_MINS } from "@/lib/submissions/flows";
import {
  auditDraft,
  buildDeliverables,
  buildIntakeFields,
  buildIntakeSummary,
  PAY_GATE_PCT,
} from "@/lib/submissions/audit";
import {
  getOrderByWorkOrder,
  linkWorkOrder,
  listOrdersForUser,
  markSubmissionOrderPaidByWorkOrder,
  putDraft,
  upsertPendingOrder,
} from "@/lib/submissions/store";
import { buildNudges } from "@/lib/submissions/nudges";
import { canUseBundledEoi, recordBundledEoiUse } from "@/lib/subscription/eoi-quota";
import { consumeFreeSubmissionForProposal } from "@/lib/free-submission";
import { normalizePortalCompanion } from "@/lib/tender-workspace/companion";
import { normalizeTenderRequirements } from "@/lib/tender-workspace/requirements";
import { sanitizeTenderPackForUser, TenderPackOwnershipError } from "@/lib/tender-workspace/ownership";
import { recordCalibrationEvent, valueBand } from "@/lib/calibration/store";

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
    draft.tenderPack = await sanitizeTenderPackForUser(user.id, draft.tenderPack);
    draft.portalCompanion = normalizePortalCompanion(draft.portalCompanion);
    draft.tenderRequirements = normalizeTenderRequirements(draft.tenderRequirements, draft.tenderPack);

    // Authoritative server-side gate (SPEC §3): tender chosen ∧ no open
    // blockers ∧ completeness ≥ 80%. We won't draft a submission we know will
    // be thrown out.
    const audit = auditDraft(flow, draft);
    if (!audit.canPay) {
      return NextResponse.json(
        {
          error: !audit.tenderChosen
            ? "Pick a tender first."
            : audit.open.length > 0
              ? "Resolve or acknowledge each elimination risk before paying — we won't draft a submission we know will be thrown out."
              : `Intake is ${audit.pct}% complete — the drafting gate is ${PAY_GATE_PCT}%.`,
          code: "PAY_GATE",
          pct: audit.pct,
          open_blockers: audit.open,
        },
        { status: 409 },
      );
    }

    // Persist the draft snapshot (it survives the /pay round-trip; cleared on
    // payment), then the pending order itself.
    await putDraft(user.id, type, { ...draft } as WizardDraftState).catch((error) => {
      console.error("[tp:submissions:precommission_draft_save_failed]", {
        userId: user.id,
        type,
        error: error instanceof Error ? error.message : String(error),
      });
    });

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
      slaMins: PILOT_SLA_MINS,
      // Carried-in flags wear their state note (prototype buildOrder copy).
      blockers: audit.blockers.map((b) => ({
        ...b,
        note:
          b.state === "acknowledged"
            ? "Proceeding at risk — will be flagged in the draft."
            : b.state === "requested"
              ? "Request letter sent — ops chase and attach on arrival."
              : b.state === "resolved"
                ? "Resolved at intake."
                : b.note,
      })),
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

    const recordSubmissionCalibration = async (vendorAction: "bid" | "pending") => {
      const tenderMetadata = order.tenderId
        ? await sql`
            SELECT country
            FROM tenders
            WHERE id = ${order.tenderId}
            LIMIT 1
          `
        : [];
      await recordCalibrationEvent({
        userId: user.id,
        source: "submission",
        eventType: "match",
        tenderId: order.tenderId,
        workOrderId,
        submissionOrderId: order.id,
        agency: order.agency,
        tenderType: type,
        valueBand: valueBand(order.value),
        country: (tenderMetadata[0]?.country as string | null | undefined) ?? null,
        systemOutput: {
          compliance: {
            completeness: audit.pct,
            flags: order.blockers.map((blocker) => ({ id: blocker.id, severity: blocker.sev, state: blocker.state })),
            portal: order.portal,
            requirementsStatus: draft.tenderRequirements?.generationStatus ?? "not_started",
          },
          merit: { fitScore: order.fit },
          contestability: { band: "Mixed", basis: [], thinEvidence: true },
          verdict: { recommendation: vendorAction === "bid" ? "bid_initiated" : "payment_pending" },
          outcomeHook: { state: "pending" },
        },
        vendorAction,
        reviewDisqualifierCaught: null,
        founderFitReasoning: null,
        dedupKey: `submission:${user.id}:${order.id}`,
      });
    };

    // Invite-only beta: each founder-approved account gets exactly one assisted
    // submission credit. Redeem it through the same atomic ledger and checkout
    // fulfillment seam as production payments; never grant unlimited $0 orders.
    if (!COMMERCE_ENABLED) {
      const credit = await consumeFreeSubmissionForProposal({
        user,
        workOrderId,
        pipelineItemId: order.pipelineItemId,
        tenderTitle: order.tender,
        agency: order.agency,
        successRedirect: `/dashboard/proposals?placed=${order.id}&free=1`,
      });
      if (!credit.applied) {
        if (credit.reason === "fulfillment_failed") {
          return NextResponse.json(
            {
              error: `We couldn't apply the submission credit. Your credit is still available. Contact info@tenderpath.me with case TP-CREDIT-${order.id}.`,
              code: "PILOT_CREDIT_FULFILLMENT_FAILED",
              case_ref: `TP-CREDIT-${order.id}`,
            },
            { status: 502 },
          );
        }
        return NextResponse.json(
          {
            error: "Your founder-issued submission credit has already been used. Contact info@tenderpath.me to start another submission.",
            code: "PILOT_CREDIT_USED",
          },
          { status: 409 },
        );
      }
      const paidOrder = await getOrderByWorkOrder(workOrderId);
      await recordSubmissionCalibration("bid");
      return NextResponse.json({
        order: paidOrder ?? order,
        work_order_id: workOrderId,
        free: true,
      });
    }

    // Subscription bundled EOI (P1.2): a real subscriber's monthly EOI is a
    // subscription feature, not a standalone fee. Fulfil it free via the SAME $0
    // seam the beta path uses, and record the monthly use. Non-EOI formats and an
    // exhausted quota fall through to the normal paid checkout below.
    if (type === "EOI") {
      const bundled = await canUseBundledEoi(user);
      if (bundled.allowed) {
        await sql`
          UPDATE work_orders
          SET payment_status = 'paid', amount_cents = 0, currency = 'usd'
          WHERE id = ${workOrderId} AND user_id = ${user.id}
        `;
        const paidOrder = await markSubmissionOrderPaidByWorkOrder(workOrderId, 0, "usd");
        const usage = await recordBundledEoiUse(user);
        await recordSubmissionCalibration("bid");
        return NextResponse.json({
          order: paidOrder ?? order,
          work_order_id: workOrderId,
          bundled: true,
          bundled_eoi: usage,
        });
      }
    }

    const payParams = new URLSearchParams({
      plan: "proposal-draft",
      submission_type: type,
      work_order_id: String(workOrderId),
      submission_order_id: String(order.id),
      tender: order.tender.slice(0, 120),
    });
    if (order.agency) payParams.set("agency", order.agency.slice(0, 120));
    if (order.pipelineItemId) payParams.set("pipeline_item_id", String(order.pipelineItemId));

    await recordSubmissionCalibration("pending");
    return NextResponse.json({
      order,
      work_order_id: workOrderId,
      pay_url: `/pay?${payParams.toString()}`,
    });
  } catch (err) {
    if (err instanceof TenderPackOwnershipError) {
      console.warn("[tp:submissions:pack_forbidden]", { userId: user.id, type: typeForLog });
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    console.error("[tp:submissions:commission_failed]", {
      userId: user.id,
      type: typeForLog,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Could not start this submission." }, { status: 500 });
  }
}
