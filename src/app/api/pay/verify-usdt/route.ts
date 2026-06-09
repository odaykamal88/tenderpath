import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { sql } from "@/lib/db";
import { Resend } from "resend";
import { requireAuth } from "@/lib/subscription-guard";
import { generateBidNoBid, BID_PLAN } from "@/lib/bid-no-bid/generate";
import { generateProposalPackage } from "@/lib/proposal-package/generate-proposal";
import { generateRosterFastTrack } from "@/lib/proposal-package/generate-roster";
import { PROPOSAL_PLAN, ROSTER_PLAN } from "@/lib/proposal-package/types";
import { isComingSoonTier } from "@/lib/pricing";
import { ensurePaymentIntegritySchema } from "@/lib/payment-integrity";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import {
  evaluateServiceFulfillmentGate,
  markWorkOrderForFulfillmentGate,
} from "@/lib/service-fulfillment-gates";

export const runtime = "nodejs";
export const maxDuration = 20;

// Plans that are auto-fulfilled (deliverable generated and emailed) the moment
// TronGrid confirms a valid transfer. The user does not wait for ops review.
const AUTO_FULFILLED_PLANS = new Set([BID_PLAN, PROPOSAL_PLAN, ROSTER_PLAN]);

const USDT_TRC20_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

// Minimum micro-USDT (6 decimals) per plan — 95% of price to absorb fees.
const PLAN_MIN_USDT: Record<string, number> = {
  "bid-no-bid":              37_050_000,
  "grants-tenders-matching": 46_550_000,
  "proposal-draft":         284_050_000,
  "roster-fast-track":      711_750_000,
};

interface TronScanTransfer {
  to_address?: string;
  contract_address?: string;
  symbol?: string;
  amount_str?: string;
}

interface TronScanResponse {
  contractRet?: string;
  trc20TransferInfo?: TronScanTransfer[];
}

interface WorkOrderPaymentRow {
  id: number;
  plan: string;
  service_slug: string | null;
  email: string | null;
  payment_status: string | null;
  usdt_txid: string | null;
}

function workOrderPlanMatches(order: WorkOrderPaymentRow, plan: string): boolean {
  return order.plan === plan
    || order.service_slug === plan
    || (plan === PROPOSAL_PLAN && order.service_slug === "proposal")
    || (plan === ROSTER_PLAN && order.service_slug === "lta-roster");
}

async function sendOpsAlert(orderId: number, plan: string, email: string | null, txid: string) {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return;
  const from = process.env.RESEND_FROM_EMAIL ?? "TenderPath <no-reply@tenderpath.me>";
  const ops = process.env.WORK_ORDER_OPS_EMAIL ?? process.env.OPS_EMAIL ?? "info@tenderpath.me";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.tenderpath.me";
  const resend = new Resend(key);
  await resend.emails.send({
    from,
    to: ops,
    subject: `USDT payment submitted — work order #${orderId} (${plan})`,
    text: [
      `Work order #${orderId} — plan: ${plan}`,
      `Customer: ${email ?? "unknown"}`,
      `TXID: ${txid}`,
      `TronScan: https://tronscan.org/#/transaction/${txid}`,
      "",
      "Transaction verified against wallet address and amount.",
      "Activate: " + appUrl + "/admin/work-orders",
    ].join("\n"),
  });
}

export async function POST(req: NextRequest) {
  const guard = await requireAuth(req);
  if (!guard.authorized) return guard.response!;
  const user = guard.user!;

  let body: { txid?: string; work_order_id?: string | number; plan?: string; email?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { txid, work_order_id: rawId, plan } = body;

  if (!txid || typeof txid !== "string" || !/^[0-9a-fA-F]{64}$/.test(txid.trim())) {
    return NextResponse.json(
      { error: "Invalid transaction ID. Must be a 64-character hex string from TronScan." },
      { status: 400 },
    );
  }
  if (!rawId || !plan) {
    return NextResponse.json({ error: "work_order_id and plan are required" }, { status: 400 });
  }
  const userLimit = enforceRateLimit(req, {
    namespace: "pay:verify-usdt:user",
    limit: 10,
    windowMs: 10 * 60 * 1000,
    keyParts: [user.id, rawId],
  });
  if (userLimit) return userLimit;

  const normalizedTxid = txid.trim();
  if (typeof PLAN_MIN_USDT[plan] !== "number") {
    return NextResponse.json({ error: "Unsupported USDT payment plan." }, { status: 400 });
  }
  // Product-wide "coming soon" gate (e.g. Roster/LTA) — don't verify/fulfil a
  // crypto payment for a held-back tier.
  if (isComingSoonTier(plan)) {
    return NextResponse.json(
      { error: "This service is coming soon and isn't available for purchase yet.", code: "PLAN_COMING_SOON" },
      { status: 403 },
    );
  }
  const workOrderId = Number(rawId);
  if (!Number.isInteger(workOrderId) || workOrderId <= 0) {
    return NextResponse.json({ error: "Invalid work_order_id" }, { status: 400 });
  }

  await ensurePaymentIntegritySchema();

  const ownedRows = await sql`
    SELECT id, plan, service_slug, email, payment_status, usdt_txid
    FROM work_orders
    WHERE id = ${workOrderId}
      AND (
        user_id = ${user.id}
        OR (email IS NOT NULL AND LOWER(email) = LOWER(${user.email}))
      )
    LIMIT 1
  ` as unknown as WorkOrderPaymentRow[];
  const ownedOrder = ownedRows[0];
  if (!ownedOrder) {
    console.warn("[verify-usdt:ownership_blocked]", { workOrderId, userId: user.id });
    return NextResponse.json({ error: "Work order not found." }, { status: 404 });
  }
  if (!workOrderPlanMatches(ownedOrder, plan)) {
    return NextResponse.json({ error: "This payment plan does not match the work order." }, { status: 409 });
  }
  if (ownedOrder.payment_status === "paid") {
    return NextResponse.json({ error: "This work order is already marked paid." }, { status: 409 });
  }
  if (ownedOrder.usdt_txid && ownedOrder.usdt_txid !== normalizedTxid) {
    return NextResponse.json({ error: "This work order already has a submitted USDT transaction." }, { status: 409 });
  }

  const duplicateTx = await sql`
    SELECT id FROM work_orders
    WHERE usdt_txid = ${normalizedTxid}
      AND id <> ${workOrderId}
    LIMIT 1
  `;
  if (duplicateTx.length) {
    console.warn("[verify-usdt:duplicate_txid_blocked]", { workOrderId, existingWorkOrderId: duplicateTx[0].id });
    return NextResponse.json({ error: "This USDT transaction has already been submitted." }, { status: 409 });
  }

  const gate = await evaluateServiceFulfillmentGate({ plan, workOrderId });
  if (!gate.payment_allowed) {
    return NextResponse.json(
      {
        error: gate.message,
        code: gate.code,
        missing_inputs: gate.missing_inputs,
        readiness: gate,
      },
      { status: 409 },
    );
  }

  // Fetch TronScan
  let txData: TronScanResponse;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    const res = await fetch(
      `https://apilist.tronscanapi.com/api/transaction-info?hash=${encodeURIComponent(normalizedTxid)}`,
      { signal: controller.signal, headers: { Accept: "application/json" } },
    );
    clearTimeout(timer);
    if (!res.ok) {
      return NextResponse.json(
        { error: "TronScan lookup failed. Wait a minute and try again." },
        { status: 502 },
      );
    }
    txData = (await res.json()) as TronScanResponse;
  } catch (err) {
    console.error("[verify-usdt] tronscan fetch", err);
    return NextResponse.json(
      { error: "Could not reach TronScan. Check your internet or try again shortly." },
      { status: 502 },
    );
  }

  if (txData.contractRet !== "SUCCESS") {
    return NextResponse.json(
      { error: "Transaction is not yet confirmed. Wait a few minutes and try again." },
      { status: 422 },
    );
  }

  const transfers = Array.isArray(txData.trc20TransferInfo) ? txData.trc20TransferInfo : [];
  const usdtTransfer = transfers.find(
    (t) =>
      t.contract_address === USDT_TRC20_CONTRACT ||
      t.symbol?.toUpperCase() === "USDT",
  );

  if (!usdtTransfer) {
    return NextResponse.json(
      { error: "No USDT TRC20 transfer found in this transaction." },
      { status: 422 },
    );
  }

  const walletAddress =
    process.env.NEXT_PUBLIC_USDT_TRC20_ADDRESS || "TKh1rcVFrbLX6mTKw9gJcZYoJZR4VSuCWF";
  if (usdtTransfer.to_address !== walletAddress) {
    return NextResponse.json(
      { error: "This transaction was not sent to our USDT wallet address." },
      { status: 422 },
    );
  }

  const minAmount = PLAN_MIN_USDT[plan];
  const sent = Number(usdtTransfer.amount_str ?? "0");
  if (sent < minAmount) {
    const sentDisplay = (sent / 1_000_000).toFixed(2);
    const expectedDisplay = (minAmount / 1_000_000).toFixed(2);
    return NextResponse.json(
      {
        error: `Amount sent (${sentDisplay} USDT) is less than the required ${expectedDisplay} USDT for this plan.`,
      },
      { status: 422 },
    );
  }

  // Decide downstream payment_status. Auto-fulfilled plans (bid-no-bid today)
  // go straight to "paid" because TronGrid has already confirmed the contract,
  // destination wallet, and minimum amount — no human in the loop.
  const autoPlan = AUTO_FULFILLED_PLANS.has(plan);
  const autoFulfilled = autoPlan && gate.auto_fulfill_allowed;
  const nextPaymentStatus = autoPlan ? "paid" : "pending_verification";

  const rows = await sql`
    UPDATE work_orders
    SET
      usdt_txid         = ${normalizedTxid},
      payment_status    = ${nextPaymentStatus},
      email             = COALESCE(email, ${user.email}),
      updated_at        = NOW()
    WHERE id = ${workOrderId}
      AND (
        user_id = ${user.id}
        OR (email IS NOT NULL AND LOWER(email) = LOWER(${user.email}))
      )
      AND payment_status IS DISTINCT FROM 'paid'
      AND (usdt_txid IS NULL OR usdt_txid = ${normalizedTxid})
    RETURNING id, plan, email, tender_title, agency
  `;

  if (rows.length === 0) {
    return NextResponse.json({ error: "Work order not found." }, { status: 404 });
  }

  const order = rows[0];
  if (!gate.auto_fulfill_allowed) {
    await markWorkOrderForFulfillmentGate(order.id as number, gate);
  }
  sendOpsAlert(
    order.id as number,
    order.plan as string,
    (order.email as string | null) ?? user.email,
    normalizedTxid,
  ).catch((err) => console.error("[verify-usdt] ops email failed", err));

  if (autoFulfilled) {
    const orderId = order.id as number;
    // Kick off generation after the response. The user dashboards into the
    // work-order page where the deliverable appears within a few minutes; the
    // ready email notifies them too. Each generator handles its own pipeline.
    after(async () => {
      try {
        if (plan === BID_PLAN) {
          await generateBidNoBid({ workOrderId: orderId });
        } else if (plan === PROPOSAL_PLAN) {
          await generateProposalPackage({ workOrderId: orderId });
        } else if (plan === ROSTER_PLAN) {
          await generateRosterFastTrack({ workOrderId: orderId });
        }
      } catch (err) {
        console.error("[verify-usdt] auto-generate failed", {
          workOrderId: orderId,
          plan,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    const message = (() => {
      if (plan === BID_PLAN) {
        return "Transaction verified. We're generating your Bid/No-Bid analysis now — you'll receive the PDF by email and in your dashboard within a few minutes.";
      }
      if (plan === PROPOSAL_PLAN) {
        return "Transaction verified. We're drafting your proposal package now — you'll receive the ZIP bundle by email and in your dashboard within 15-30 minutes.";
      }
      if (plan === ROSTER_PLAN) {
        return "Transaction verified. We're preparing your roster registration package now — you'll receive the bundle by email and in your dashboard within 15-30 minutes.";
      }
      return "Transaction verified.";
    })();

    return NextResponse.json({ ok: true, message });
  }

  return NextResponse.json({
    ok: true,
    message: gate.mode === "human_review"
      ? "Transaction verified. This order is in the human QA queue because the source package needs review before fulfillment."
      : "Transaction verified. We'll activate your order within 4 business hours.",
  });
}
