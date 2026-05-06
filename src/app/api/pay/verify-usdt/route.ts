import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { Resend } from "resend";

export const runtime = "nodejs";
export const maxDuration = 20;

const USDT_TRC20_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

// Minimum micro-USDT (6 decimals) per plan — 95% of price to absorb fees.
const PLAN_MIN_USDT: Record<string, number> = {
  "bid-no-bid":              37_050_000,
  "grants-tenders-matching": 46_550_000,
  "proposal-draft":         284_050_000,
  "roster-fast-track":      711_750_000,
  "founding-member":        370_500_000,
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
  let body: { txid?: string; work_order_id?: string | number; plan?: string; email?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { txid, work_order_id: rawId, plan, email } = body;

  if (!txid || typeof txid !== "string" || !/^[0-9a-fA-F]{64}$/.test(txid.trim())) {
    return NextResponse.json(
      { error: "Invalid transaction ID. Must be a 64-character hex string from TronScan." },
      { status: 400 },
    );
  }
  if (!rawId || !plan) {
    return NextResponse.json({ error: "work_order_id and plan are required" }, { status: 400 });
  }
  const workOrderId = Number(rawId);
  if (!Number.isInteger(workOrderId) || workOrderId <= 0) {
    return NextResponse.json({ error: "Invalid work_order_id" }, { status: 400 });
  }

  // Fetch TronScan
  let txData: TronScanResponse;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    const res = await fetch(
      `https://apilist.tronscanapi.com/api/transaction-info?hash=${encodeURIComponent(txid.trim())}`,
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
  if (minAmount) {
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
  }

  // Update work order
  const rows = await sql`
    UPDATE work_orders
    SET
      usdt_txid         = ${txid.trim()},
      payment_status    = 'pending_verification',
      email             = COALESCE(email, ${email?.trim() ?? null}),
      updated_at        = NOW()
    WHERE id = ${workOrderId}
    RETURNING id, plan, email, tender_title, agency
  `;

  if (rows.length === 0) {
    return NextResponse.json({ error: "Work order not found." }, { status: 404 });
  }

  const order = rows[0];
  sendOpsAlert(
    order.id as number,
    order.plan as string,
    (order.email as string | null) ?? email?.trim() ?? null,
    txid.trim(),
  ).catch((err) => console.error("[verify-usdt] ops email failed", err));

  return NextResponse.json({
    ok: true,
    message: "Transaction verified. We'll activate your order within 4 business hours.",
  });
}
