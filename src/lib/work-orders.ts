import type Stripe from "stripe";
import { after } from "next/server";
import { sql } from "@/lib/db";
import { isSettledPayment } from "@/lib/stripe";
import { sendWorkOrderPaidNotifications } from "@/lib/email/sendWorkOrderNotifications";
import { generateBidNoBid, BID_PLAN } from "@/lib/bid-no-bid/generate";
import { generateProposalPackage } from "@/lib/proposal-package/generate-proposal";
import { generateRosterFastTrack } from "@/lib/proposal-package/generate-roster";
import { PROPOSAL_PLAN, ROSTER_PLAN } from "@/lib/proposal-package/types";
import { ensureWorkOrderServiceContext } from "@/lib/service-context";
import {
  evaluateServiceFulfillmentGate,
  markWorkOrderForFulfillmentGate,
} from "@/lib/service-fulfillment-gates";
import {
  getOrderByWorkOrder,
  markSubmissionOrderPaidByWorkOrder,
} from "@/lib/submissions/store";

export const WORK_ORDER_PLANS = new Set([
  "bid-no-bid",
  "grants-tenders-matching",
  "proposal-draft",
  "roster-fast-track",
]);

// Plans where payment completion should trigger auto-fulfilled deliverable
// generation in the background. The bid-ready / proposal-ready / roster-ready
// email from inside each generator replaces the generic "we received your
// order" email so the user gets one notification per stage, not two.
const AUTO_FULFILLED_PLANS = new Set([BID_PLAN, PROPOSAL_PLAN, ROSTER_PLAN]);

export function isWorkOrderPlan(plan: string | null | undefined): boolean {
  return !!plan && WORK_ORDER_PLANS.has(plan);
}

function cleanMeta(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 500) : null;
}

export async function createWorkOrderFromCheckout(
  session: Stripe.Checkout.Session,
  userId: number,
): Promise<void> {
  const plan = cleanMeta(session.metadata?.plan) ?? (
    cleanMeta(session.metadata?.product) === "bid-no-bid" ? "bid-no-bid" : null
  );
  if (!isWorkOrderPlan(plan)) {
    console.warn("[tp:work_order:unknown_plan]", {
      sessionId: session.id,
      plan,
      service: session.metadata?.service,
      product: session.metadata?.product,
      amountTotal: session.amount_total,
    });
    return;
  }

  const pipelineItemIdRaw = cleanMeta(session.metadata?.pipeline_item_id);
  const pipelineItemId = pipelineItemIdRaw && /^\d+$/.test(pipelineItemIdRaw)
    ? Number(pipelineItemIdRaw)
    : null;
  const workOrderIdRaw = cleanMeta(session.metadata?.work_order_id);
  const workOrderId = workOrderIdRaw && /^\d+$/.test(workOrderIdRaw)
    ? Number(workOrderIdRaw)
    : null;
  const metadataUserIdRaw = cleanMeta(session.metadata?.userId);
  const metadataUserId = metadataUserIdRaw && /^\d+$/.test(metadataUserIdRaw)
    ? Number(metadataUserIdRaw)
    : null;
  if (metadataUserId && metadataUserId !== userId) {
    console.error("[tp:work_order:checkout_user_mismatch]", {
      sessionId: session.id,
      metadataUserId,
      resolvedUserId: userId,
    });
    return;
  }

  const customerId = typeof session.customer === "string" ? session.customer : null;
  const email = session.customer_email ?? session.customer_details?.email ?? null;
  const tenderTitle = cleanMeta(session.metadata?.tender) ?? cleanMeta(session.metadata?.tender_title);
  const agency = cleanMeta(session.metadata?.agency);
  const serviceSlug = cleanMeta(session.metadata?.service) ?? cleanMeta(session.metadata?.product);

  // A 100%-off promotion code (e.g. FREETEST) or fully-covered trial settles as
  // "no_payment_required" in Stripe, not "paid". Persist it AS "paid" — with
  // amount_cents=0 still recording it was free — so every downstream
  // `payment_status = 'paid'` gate (generation, dashboard display, queries)
  // treats it like any settled order. Same convention as the first-proposal-free
  // credit (src/lib/free-submission.ts), which synthesizes a "paid" $0 session.
  const settledStatus = session.payment_status === "no_payment_required"
    ? "paid"
    : (session.payment_status ?? "paid");

  const rows = workOrderId
    ? await sql`
        WITH previous AS (
          SELECT payment_status
          FROM work_orders
          WHERE id = ${workOrderId}
          LIMIT 1
        ),
        updated AS (
        UPDATE work_orders
        SET
          user_id = COALESCE(user_id, ${userId}),
          plan = ${plan},
          service_slug = COALESCE(service_slug, ${serviceSlug}),
          payment_status = ${settledStatus},
          stripe_session_id = ${session.id},
          stripe_customer_id = ${customerId},
          amount_cents = ${session.amount_total ?? null},
          currency = ${session.currency ?? 'usd'},
          email = COALESCE(email, ${email}),
          pipeline_item_id = COALESCE(pipeline_item_id, ${pipelineItemId}),
          tender_title = COALESCE(tender_title, ${tenderTitle}),
          agency = COALESCE(agency, ${agency}),
          updated_at = NOW()
        WHERE id = ${workOrderId}
          AND (
            user_id IS NULL
            OR user_id = ${userId}
            OR (email IS NOT NULL AND LOWER(email) = LOWER(${email}))
          )
        RETURNING *
        )
        SELECT updated.*, previous.payment_status AS previous_payment_status
        FROM updated
        LEFT JOIN previous ON TRUE
      `
    : await sql`
        WITH previous AS (
          SELECT payment_status
          FROM work_orders
          WHERE stripe_session_id = ${session.id}
          LIMIT 1
        ),
        upserted AS (
        INSERT INTO work_orders (
          user_id, plan, service_slug, status, payment_status,
          stripe_session_id, stripe_customer_id,
          amount_cents, currency, email,
          pipeline_item_id, tender_title, agency
        ) VALUES (
          ${userId}, ${plan}, ${serviceSlug}, 'new', ${settledStatus},
          ${session.id}, ${customerId},
          ${session.amount_total ?? null}, ${session.currency ?? 'usd'},
          ${email},
          ${pipelineItemId}, ${tenderTitle}, ${agency}
        )
        ON CONFLICT (stripe_session_id) DO UPDATE SET
          payment_status = EXCLUDED.payment_status,
          amount_cents = COALESCE(EXCLUDED.amount_cents, work_orders.amount_cents),
          currency = COALESCE(EXCLUDED.currency, work_orders.currency),
          email = COALESCE(EXCLUDED.email, work_orders.email),
          pipeline_item_id = COALESCE(EXCLUDED.pipeline_item_id, work_orders.pipeline_item_id),
          tender_title = COALESCE(EXCLUDED.tender_title, work_orders.tender_title),
          agency = COALESCE(EXCLUDED.agency, work_orders.agency),
          updated_at = NOW()
        RETURNING *
        )
        SELECT upserted.*, previous.payment_status AS previous_payment_status
        FROM upserted
        LEFT JOIN previous ON TRUE
      `;

  const order = rows[0];
  if (!order && workOrderId) {
    console.error("[tp:work_order:checkout_ownership_mismatch]", {
      sessionId: session.id,
      workOrderId,
      userId,
      plan,
    });
    return;
  }
  // Submissions workflow (EOI/RFQ/ITB/RFP): a work order linked to a
  // submission_orders row is fulfilled by the ops drafting queue, NOT the LLM
  // proposal generator — the wizard already gated intake at ≥80%, so the
  // service-fulfillment gate is skipped too. Payment here just flips the order
  // live (paid_at starts the SLA clock) and sends the order-received email.
  if (order) {
    let submissionOrder = null;
    try {
      submissionOrder = await getOrderByWorkOrder(order.id as number);
    } catch (err) {
      console.error("[tp:submissions:paid_lookup_failed]", {
        workOrderId: order.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    if (submissionOrder) {
      const previousStatus = order.previous_payment_status as string | null | undefined;
      if (isSettledPayment(session.payment_status) && !isSettledPayment(previousStatus)) {
        const live = await markSubmissionOrderPaidByWorkOrder(
          order.id as number,
          (session.amount_total as number | null) ?? null,
          (session.currency as string | null) ?? null,
        );
        console.info("[tp:submissions:order_paid]", {
          workOrderId: order.id,
          submissionOrderId: submissionOrder.id,
          ref: submissionOrder.ref,
          type: submissionOrder.type,
          alreadyPaid: live === null,
        });
        sendWorkOrderPaidNotifications({
          id: order.id as number,
          plan: order.plan as string,
          serviceSlug: (order.service_slug as string | null) ?? `submission-${submissionOrder.type.toLowerCase()}`,
          email: (order.email as string | null) ?? email,
          tenderTitle: order.tender_title as string | null,
          agency: order.agency as string | null,
          paymentStatus: order.payment_status as string | null,
          amountCents: order.amount_cents as number | null,
          currency: order.currency as string | null,
        }).catch((err) => {
          console.error("[tp:work_order_email:failed]", {
            workOrderId: order.id,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }
      return;
    }
  }

  let fulfillmentGate: Awaited<ReturnType<typeof evaluateServiceFulfillmentGate>> | null = null;
  if (order) {
    try {
      await ensureWorkOrderServiceContext(order.id as number, userId);
      fulfillmentGate = await evaluateServiceFulfillmentGate({
        plan: order.plan as string,
        workOrderId: order.id as number,
        ensureContext: false,
      });
      if (fulfillmentGate.mode !== "self_serve") {
        await markWorkOrderForFulfillmentGate(order.id as number, fulfillmentGate);
      }
    } catch (err) {
      console.error("[tp:service_context:ensure_failed]", {
        workOrderId: order.id,
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  const previousPaymentStatus = order?.previous_payment_status as string | null | undefined;
  if (order && isSettledPayment(session.payment_status) && !isSettledPayment(previousPaymentStatus)) {
    const orderPlan = order.plan as string;
    const orderId = order.id as number;

    // For auto-fulfilled plans the deliverable-ready email IS the paid
    // notification — skip the generic "we received your order" email to avoid
    // double-mailing. Subscription tiers still get the receive-confirmation.
    const autoFulfillAllowed = AUTO_FULFILLED_PLANS.has(orderPlan)
      && (fulfillmentGate?.auto_fulfill_allowed ?? true);

    // PR-I (2026-05-23): stable post-payment log line so a future stuck
    // work-order can be triaged from logs alone. The diagnostic on order 19
    // took manual code-walk because we had GET polls but no signal as to
    // whether the after(generate*) hook even scheduled.
    console.info("[tp:work_order:post_payment]", {
      workOrderId: orderId,
      plan: orderPlan,
      autoFulfillAllowed,
      gateMode: fulfillmentGate?.mode ?? null,
      gateCode: fulfillmentGate?.code ?? null,
      gateScore: fulfillmentGate?.score_0_10 ?? null,
      paymentStatus: order.payment_status,
    });

    if (!autoFulfillAllowed) {
      // Sprint 17. Forward the gate state into the ops email so the
      // subject can prefix [HOLD · <mode>] and the body lists the
      // specific missing inputs / code. AUTO_FULFILLED_PLANS without
      // a gate hold (subscription tiers etc.) pass undefined and the
      // email behaves as before.
      const fulfillmentHold = fulfillmentGate
        && (fulfillmentGate.mode === "human_review" || fulfillmentGate.mode === "blocked")
        ? {
            mode: fulfillmentGate.mode,
            code: fulfillmentGate.code,
            message: fulfillmentGate.message,
            missingInputs: fulfillmentGate.missing_inputs,
          }
        : undefined;
      sendWorkOrderPaidNotifications({
        id: orderId,
        plan: orderPlan,
        serviceSlug: order.service_slug as string | null,
        email: (order.email as string | null) ?? email,
        tenderTitle: order.tender_title as string | null,
        agency: order.agency as string | null,
        paymentStatus: order.payment_status as string | null,
        amountCents: order.amount_cents as number | null,
        currency: order.currency as string | null,
        fulfillmentHold,
      }).catch((err) => {
        console.error("[tp:work_order_email:failed]", {
          workOrderId: orderId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    // Schedule deliverable generation after the webhook returns. Each
    // generator handles its own LLM call → file rendering → Blob upload →
    // email, and writes status into proposal_packages so the dashboard can
    // poll for "ready" without holding the webhook lambda open.
    if (!autoFulfillAllowed) {
      return;
    }

    if (orderPlan === BID_PLAN) {
      console.info("[tp:bid_no_bid:auto_generate_scheduled]", { workOrderId: orderId });
      after(async () => {
        try {
          await generateBidNoBid({ workOrderId: orderId });
        } catch (err) {
          console.error("[tp:bid_no_bid:auto_generate_failed]", {
            workOrderId: orderId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      });
    } else if (orderPlan === PROPOSAL_PLAN) {
      after(async () => {
        try {
          await generateProposalPackage({ workOrderId: orderId });
        } catch (err) {
          console.error("[tp:proposal_draft:auto_generate_failed]", {
            workOrderId: orderId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      });
    } else if (orderPlan === ROSTER_PLAN) {
      after(async () => {
        try {
          await generateRosterFastTrack({ workOrderId: orderId });
        } catch (err) {
          console.error("[tp:roster_fast_track:auto_generate_failed]", {
            workOrderId: orderId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      });
    }
  }
}
