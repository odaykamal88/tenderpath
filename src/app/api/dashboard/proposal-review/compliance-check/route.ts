import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";
import { runComplianceGapCheck, type ComplianceCheckTender } from "@/lib/proposal-package/compliance-check";
import { recordCalibrationEvent, valueBand } from "@/lib/calibration/store";

// The FREE shallow compliance-gap check (P1.1 wedge). Authenticated so the read
// is owner-scoped (P0.1) and the calibration row (P0.2) has an owner. Runs one
// Haiku pass; keep the function window generous but bounded.
export const maxDuration = 60;

const MIN_DRAFT_CHARS = 200;

function stableHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export async function POST(request: Request) {
  const guard = await requireAuth(request);
  if (!guard.authorized) return guard.response!;
  const user = guard.user!;

  let body: {
    draftText?: unknown;
    tenderId?: unknown;
    tenderTitle?: unknown;
    tenderAgency?: unknown;
    tenderText?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const draftText = typeof body.draftText === "string" ? body.draftText.trim() : "";
  if (draftText.length < MIN_DRAFT_CHARS) {
    return NextResponse.json(
      { error: `Paste your draft proposal (at least ${MIN_DRAFT_CHARS} characters) so we have something to check.` },
      { status: 400 },
    );
  }

  // Resolve the call. A tenderId loads the (public) tender row; otherwise the
  // caller pastes the tender/TOR text directly. One of the two is required.
  let tender: ComplianceCheckTender | null = null;
  const tenderId = Number.isInteger(Number(body.tenderId)) && Number(body.tenderId) > 0 ? Number(body.tenderId) : null;
  if (tenderId) {
    const rows = await sql`
      SELECT id, title, agency, country, deadline, opportunity_type, description, requirements, estimated_value
      FROM tenders WHERE id = ${tenderId} LIMIT 1
    `;
    const t = rows[0];
    if (!t) return NextResponse.json({ error: "Tender not found" }, { status: 404 });
    tender = {
      tender_id: Number(t.id),
      title: String(t.title ?? "Opportunity"),
      agency: (t.agency as string | null) ?? null,
      country: (t.country as string | null) ?? null,
      deadline: t.deadline ? new Date(t.deadline as string).toISOString() : null,
      opportunity_type: (t.opportunity_type as string | null) ?? null,
      description: (t.description as string | null) ?? null,
      requirementsText: t.requirements ? JSON.stringify(t.requirements) : null,
      estimated_value: (t.estimated_value as string | null) ?? null,
    };
  } else {
    const tenderText = typeof body.tenderText === "string" ? body.tenderText.trim() : "";
    const tenderTitle = typeof body.tenderTitle === "string" ? body.tenderTitle.trim() : "";
    if (!tenderText && !tenderTitle) {
      return NextResponse.json(
        { error: "Provide a tenderId, or paste the tender/TOR text (tenderText) to check against." },
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
      description: tenderText || null,
      requirementsText: null,
      estimated_value: null,
    };
  }

  const companyContext = [
    user.business_name || user.name || null,
    user.org_type ? `(${user.org_type})` : null,
    user.sector ? `Sector: ${user.sector}` : null,
    user.profile_description ? `About: ${user.profile_description}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const check = await runComplianceGapCheck({
    tender,
    draftText,
    applicant: {
      user_id: user.id,
      organisation: user.business_name ?? user.name ?? null,
      org_type: user.org_type ?? null,
    },
    companyContext,
  });

  // Calibration corpus (P0.2): owner-scoped to the customer. Idempotent per
  // (user, tender) — re-running the check refreshes the row, preserving outcome.
  await recordCalibrationEvent({
    userId: user.id,
    source: "proposal_review",
    eventType: "match",
    tenderId: tender.tender_id,
    agency: tender.agency,
    tenderType: tender.opportunity_type,
    valueBand: valueBand(tender.estimated_value ?? null),
    country: tender.country,
    systemOutput: {
      reviewDepth: "shallow",
      compliance: { status: check.compliance_verdict.status, blockingGates: check.admin_gates.filter((g) => g.severity === "BLOCK").length },
      contestability: { band: check.contestability.band, thinEvidence: check.contestability.basis.length === 0 },
      goNoGo: { lean: check.go_no_go.lean },
      quality: check.output_quality.status,
    },
    vendorAction: "pending",
    dedupKey: `review:${user.id}:${tender.tender_id ?? "paste-" + stableHash(draftText)}`,
  });

  console.log("[proposal-review:compliance_check]", {
    userId: user.id,
    tenderId: tender.tender_id,
    verdict: check.compliance_verdict.status,
    lean: check.go_no_go.lean,
    gates: check.admin_gates.length,
  });

  return NextResponse.json({ check }, { status: 200 });
}
