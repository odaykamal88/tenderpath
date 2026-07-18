import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";

// PR-N (2026-05-23): one-click upsell flow from a completed bid/no-bid
// memo into a paid proposal-draft work order. The user lands on a
// bid/no-bid result and can hit "Use this for proposal" — that POSTs
// here, we mint a NEW work_orders row pre-populated with the bid/no-bid
// intake + a snapshot of the memo, then the client redirects to
// /pay?plan=proposal-draft&work_order_id={new_id}.
//
// Why a new work_orders row and not a re-purpose of the existing one:
//   - The bid/no-bid memo is its own deliverable with its own PDF and
//     proposal_packages row. Reusing the row would lose the audit trail.
//   - Different generator (generateProposalPackage) reads from intake
//     keyed on plan='proposal-draft' fields. Pre-loading the intake
//     from bid/no-bid means the proposal generator starts grounded.
//   - Independent payment + checkout — Stripe sees a fresh subscription/
//     payment intent, not a mutated one.
//
// Auth: bearer-protected via requireAuth + double-check on ownership of
// the source work order.

export const runtime = "nodejs";
export const maxDuration = 30;

const BID_PLAN = "bid-no-bid";
const PROPOSAL_PLAN = "proposal-draft";

interface SourceWorkOrder {
  id: number;
  user_id: number | null;
  email: string | null;
  plan: string;
  service_slug: string | null;
  pipeline_item_id: number | null;
  tender_title: string | null;
  agency: string | null;
  tender_url: string | null;
  intake: Record<string, unknown> | null;
  payment_status: string | null;
}

interface BidPackage {
  output: Record<string, unknown> | null;
  pdf_url: string | null;
}

function pickIntakeSnapshot(
  source: SourceWorkOrder,
  bidOutput: Record<string, unknown> | null,
): Record<string, unknown> {
  const sourceIntake = source.intake ?? {};
  // Whitelist the fields the proposal generator can read — the bid/no-bid
  // intake schema is broader and we don't want to leak fields that the
  // proposal generator might misinterpret (e.g. bid-no-bid-only tender
  // context flags). Everything else is reachable later via the linked
  // source_work_order_id metadata.
  const carryFields: Array<keyof typeof sourceIntake> = [
    "tender_context",
    "additional_details",
    "tender_file_url",
    "tender_file_name",
    "supporting_link_urls",
    "financial_documents_url",
    "financial_documents_filename",
    "vault_doc_id",
    "confirmed_primary_sector",
  ];
  const carried: Record<string, unknown> = {};
  for (const k of carryFields) {
    if (sourceIntake[k as string] !== undefined) {
      carried[k as string] = sourceIntake[k as string];
    }
  }

  // Snapshot of the bid/no-bid recommendation + headline so the proposal
  // generator can echo back "based on your bid/no-bid analysis..." for
  // continuity. Only the high-signal fields — we keep this lean since
  // intake is full-text-searched downstream.
  if (bidOutput) {
    const snapshot: Record<string, unknown> = {};
    if (typeof bidOutput.recommendation === "string") snapshot.recommendation = bidOutput.recommendation;
    if (typeof bidOutput.headline === "string") snapshot.headline = bidOutput.headline;
    if (typeof bidOutput.summary === "string") snapshot.summary = bidOutput.summary;
    if (Array.isArray(bidOutput.win_themes)) snapshot.win_themes = bidOutput.win_themes;
    if (Array.isArray(bidOutput.gaps)) snapshot.gaps = bidOutput.gaps;
    if (Array.isArray(bidOutput.next_steps)) snapshot.next_steps = bidOutput.next_steps;
    if (Object.keys(snapshot).length > 0) {
      carried.bid_no_bid_snapshot = snapshot;
    }
  }
  return carried;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const guard = await requireAuth(request);
  if (!guard.authorized) return guard.response!;

  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    return NextResponse.json({ error: "Invalid work order id" }, { status: 400 });
  }

  const sourceRows = (await sql`
    SELECT id, user_id, email, plan, service_slug, pipeline_item_id, tender_title, agency, tender_url, intake, payment_status
    FROM work_orders
    WHERE id = ${numericId}
      AND (
        user_id = ${guard.user!.id}
        OR (user_id IS NULL AND email IS NOT NULL AND LOWER(email) = LOWER(${guard.user!.email}))
      )
    LIMIT 1
  `) as unknown as SourceWorkOrder[];

  const source = sourceRows[0];
  if (!source) {
    return NextResponse.json({ error: "Work order not found" }, { status: 404 });
  }

  if (source.plan !== BID_PLAN && source.service_slug !== BID_PLAN) {
    return NextResponse.json(
      { error: "Only bid/no-bid work orders can be exported to a proposal." },
      { status: 400 },
    );
  }
  if (source.payment_status !== "paid") {
    return NextResponse.json(
      { error: "Bid/No-Bid must be paid + delivered before exporting to proposal." },
      { status: 402 },
    );
  }

  // Pull the bid/no-bid output to snapshot into the new intake.
  const bidPackages = (await sql`
    SELECT output, pdf_url
    FROM proposal_packages
    WHERE work_order_id = ${source.id} AND plan = ${BID_PLAN}
    ORDER BY created_at DESC
    LIMIT 1
  `) as unknown as BidPackage[];
  const bidOutput = bidPackages[0]?.output ?? null;

  const intakeForProposal = pickIntakeSnapshot(source, bidOutput);
  // Stamp a reference back to the source for downstream telemetry +
  // future "view bid/no-bid that generated this" affordance.
  intakeForProposal.exported_from_work_order_id = source.id;
  intakeForProposal.exported_from = "bid-no-bid";
  intakeForProposal.exported_at = new Date().toISOString();

  const inserted = (await sql`
    INSERT INTO work_orders (
      user_id, plan, service_slug, status, payment_status,
      pipeline_item_id, tender_title, agency, tender_url, intake, email
    ) VALUES (
      ${guard.user!.id},
      ${PROPOSAL_PLAN},
      ${PROPOSAL_PLAN},
      'new',
      'unpaid',
      ${source.pipeline_item_id},
      ${source.tender_title},
      ${source.agency},
      ${source.tender_url},
      ${JSON.stringify(intakeForProposal)}::jsonb,
      ${source.email ?? guard.user!.email}
    )
    RETURNING id
  `) as unknown as Array<{ id: number }>;

  const newWorkOrderId = inserted[0]?.id;
  if (!newWorkOrderId) {
    console.error("[bid_no_bid:export_to_proposal:insert_failed]", {
      sourceWorkOrderId: source.id,
      userId: guard.user!.id,
    });
    return NextResponse.json(
      { error: "Could not create proposal work order. Please try again." },
      { status: 500 },
    );
  }

  console.info("[bid_no_bid:export_to_proposal:success]", {
    sourceWorkOrderId: source.id,
    newWorkOrderId,
    userId: guard.user!.id,
  });

  // Client redirects to /pay?plan=proposal-draft&work_order_id={new}.
  // Building the URL server-side so the response carries the canonical
  // form the client should land on.
  const params2 = new URLSearchParams({
    plan: PROPOSAL_PLAN,
    work_order_id: String(newWorkOrderId),
  });
  if (source.tender_title) params2.set("tender", source.tender_title);
  if (source.agency) params2.set("agency", source.agency);
  if (source.pipeline_item_id) params2.set("pipeline_item_id", String(source.pipeline_item_id));

  return NextResponse.json({
    ok: true,
    workOrderId: newWorkOrderId,
    payHref: `/pay?${params2.toString()}`,
  });
}
