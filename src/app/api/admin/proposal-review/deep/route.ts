import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";
import { generateDeepReview, type DeepReviewTender } from "@/lib/proposal-package/review-deep";
import { recordCalibrationEvent, valueBand } from "@/lib/calibration/store";

// Admin-fulfilled deep proposal review (P1.1 paid tier). Reachable in the beta
// while the self-serve ~$150 checkout is P0.4-gated: an operator runs the deep
// adjudication for a customer's pasted draft. Owner-scoped calibration write.
export const maxDuration = 300;

const MIN_DRAFT_CHARS = 400;

function stableHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export async function POST(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.authorized) return guard.response!;

  let body: {
    draftText?: unknown;
    tenderId?: unknown;
    tenderTitle?: unknown;
    tenderAgency?: unknown;
    solicitationText?: unknown;
    userId?: unknown;
    revision?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const draftText = typeof body.draftText === "string" ? body.draftText.trim() : "";
  if (draftText.length < MIN_DRAFT_CHARS) {
    return NextResponse.json({ error: `Paste the applicant's draft (≥ ${MIN_DRAFT_CHARS} characters).` }, { status: 400 });
  }

  const solicitationText = typeof body.solicitationText === "string" ? body.solicitationText.trim() : "";
  const forUserId = Number.isInteger(Number(body.userId)) && Number(body.userId) > 0 ? Number(body.userId) : null;
  const revision = Number.isInteger(Number(body.revision)) && Number(body.revision) > 0 ? Number(body.revision) : 1;

  // Resolve the call.
  let tender: DeepReviewTender | null = null;
  let estimatedValue: string | null = null;
  const tenderId = Number.isInteger(Number(body.tenderId)) && Number(body.tenderId) > 0 ? Number(body.tenderId) : null;
  if (tenderId) {
    const rows = await sql`
      SELECT id, title, agency, country, deadline, opportunity_type, description, estimated_value
      FROM tenders WHERE id = ${tenderId} LIMIT 1
    `;
    const t = rows[0];
    if (!t) return NextResponse.json({ error: "Tender not found" }, { status: 404 });
    estimatedValue = (t.estimated_value as string | null) ?? null;
    tender = {
      tender_id: Number(t.id),
      title: String(t.title ?? "Opportunity"),
      agency: (t.agency as string | null) ?? null,
      country: (t.country as string | null) ?? null,
      deadline: t.deadline ? new Date(t.deadline as string).toISOString() : null,
      opportunity_type: (t.opportunity_type as string | null) ?? null,
      description: (t.description as string | null) ?? null,
    };
  } else {
    const tenderTitle = typeof body.tenderTitle === "string" ? body.tenderTitle.trim() : "";
    if (!tenderTitle && !solicitationText) {
      return NextResponse.json(
        { error: "Provide a tenderId, or a tenderTitle + solicitationText to review against." },
        { status: 400 },
      );
    }
    tender = {
      tender_id: null,
      title: tenderTitle || "Pasted opportunity",
      agency: typeof body.tenderAgency === "string" ? body.tenderAgency.trim() || null : null,
      country: null,
      deadline: null,
      opportunity_type: null,
      description: solicitationText || null,
    };
  }

  // Applicant identity (owner of the review) — the customer when given, else the operator.
  let organisation: string | null = null;
  let orgType: string | null = null;
  if (forUserId) {
    const u = await sql`SELECT business_name, name, org_type FROM users WHERE id = ${forUserId} LIMIT 1`;
    if (u[0]) {
      organisation = (u[0].business_name as string | null) ?? (u[0].name as string | null) ?? null;
      orgType = (u[0].org_type as string | null) ?? null;
    }
  }

  const review = await generateDeepReview({
    tender,
    solicitationText: solicitationText || null,
    draftText,
    applicant: { user_id: forUserId, organisation, org_type: orgType },
    revision,
  });

  const ownerId = forUserId ?? guard.user!.id;
  await recordCalibrationEvent({
    userId: ownerId,
    source: "proposal_review",
    eventType: "match",
    tenderId: tender.tender_id,
    agency: tender.agency,
    tenderType: tender.opportunity_type,
    valueBand: valueBand(estimatedValue),
    country: tender.country,
    systemOutput: {
      reviewDepth: "deep",
      scoring_totals: review.scoring_totals,
      threshold_clearance: review.scoring_totals.threshold_clearance,
      contestability: { band: review.contestability.band },
      goNoGo: { lean: review.go_no_go.lean },
      blockingGates: review.admin_gates.filter((g) => g.status === "missing").length,
      quality: review.output_quality?.status,
    },
    vendorAction: "pending",
    dedupKey: `review-deep:${ownerId}:${tender.tender_id ?? "paste-" + stableHash(draftText)}`,
  });

  console.log("[proposal-review:deep_generated]", {
    adminId: guard.user!.id,
    forUserId,
    tenderId: tender.tender_id,
    clearance: review.scoring_totals.threshold_clearance,
    criteria: review.scoring.length,
    lean: review.go_no_go.lean,
  });

  return NextResponse.json({ review }, { status: 200 });
}
