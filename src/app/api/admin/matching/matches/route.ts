import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";

const ROUTED_SERVICES = new Set([
  "bid-no-bid",
  "proposal-draft",
  "roster-fast-track",
  "matching",
]);
const STATUSES = new Set([
  "suggested",
  "contacted",
  "applied",
  "shortlisted",
  "won",
  "lost",
]);

export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.authorized) return guard.response!;

  const url = new URL(request.url);
  const status = url.searchParams.get("status")?.trim() ?? "";
  const routedService = url.searchParams.get("routed_service")?.trim() ?? "";
  const q = url.searchParams.get("q")?.trim() ?? "";
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 500), 1), 1000);

  const rows = await sql`
    SELECT
      m.id, m.tender_id, m.assessment_id, m.routed_service, m.status,
      m.fit_reasoning, m.outcome, m.created_by, m.created_at, m.updated_at,
      t.title AS tender_title, t.agency AS tender_agency, t.country AS tender_country,
      t.sector AS tender_sector, t.deadline AS tender_deadline,
      t.source_url AS tender_source_url, t.reference_id AS tender_reference,
      a.company_name AS vendor_company, a.email AS vendor_email,
      a.countries AS vendor_countries, a.sector AS vendor_sector,
      vp.tier AS vendor_tier
    FROM tender_vendor_matches m
    JOIN tenders t ON t.id = m.tender_id
    JOIN assessments a ON a.id = m.assessment_id
    LEFT JOIN vendor_profiles vp ON vp.assessment_id = a.id
    WHERE (${status} = '' OR m.status = ${status})
      AND (${routedService} = '' OR m.routed_service = ${routedService})
      AND (
        ${q} = ''
        OR t.title ILIKE ${`%${q}%`}
        OR t.agency ILIKE ${`%${q}%`}
        OR a.company_name ILIKE ${`%${q}%`}
      )
    ORDER BY m.updated_at DESC
    LIMIT ${limit}
  `;

  return NextResponse.json({ matches: rows, total: rows.length });
}

export async function POST(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.authorized) return guard.response!;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;

  const tenderId = Number(b.tender_id);
  const assessmentId = Number(b.assessment_id);
  const routedService = String(b.routed_service ?? "").trim();
  const status = String(b.status ?? "suggested").trim();
  const fitReasoning = String(b.fit_reasoning ?? "").trim();
  const outcome = b.outcome == null ? null : (String(b.outcome).trim() || null);

  if (!Number.isInteger(tenderId) || tenderId <= 0) {
    return NextResponse.json({ error: "tender_id required" }, { status: 400 });
  }
  if (!Number.isInteger(assessmentId) || assessmentId <= 0) {
    return NextResponse.json({ error: "assessment_id required" }, { status: 400 });
  }
  if (!ROUTED_SERVICES.has(routedService)) {
    return NextResponse.json(
      { error: `routed_service must be one of: ${[...ROUTED_SERVICES].join(", ")}` },
      { status: 400 }
    );
  }
  if (!STATUSES.has(status)) {
    return NextResponse.json(
      { error: `status must be one of: ${[...STATUSES].join(", ")}` },
      { status: 400 }
    );
  }
  if (fitReasoning.length < 10) {
    return NextResponse.json({ error: "fit_reasoning must be at least 10 characters" }, { status: 400 });
  }
  if (fitReasoning.length > 4000) {
    return NextResponse.json({ error: "fit_reasoning too long (max 4000 chars)" }, { status: 400 });
  }

  try {
    const inserted = await sql`
      INSERT INTO tender_vendor_matches (
        tender_id, assessment_id, routed_service, status,
        fit_reasoning, outcome, created_by
      ) VALUES (
        ${tenderId}, ${assessmentId}, ${routedService}, ${status},
        ${fitReasoning}, ${outcome}, ${guard.user?.id ?? null}
      )
      RETURNING id, tender_id, assessment_id, routed_service, status,
                fit_reasoning, outcome, created_by, created_at, updated_at
    `;
    return NextResponse.json({ match: inserted[0] }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("tender_vendor_matches_unique") || msg.includes("duplicate key")) {
      return NextResponse.json(
        { error: "A match already exists for this tender + vendor — use PATCH to update.", code: "DUPLICATE" },
        { status: 409 }
      );
    }
    if (msg.includes("violates foreign key")) {
      return NextResponse.json({ error: "tender_id or assessment_id not found" }, { status: 404 });
    }
    console.error("[matching:match-create:db_error]", err);
    return NextResponse.json({ error: "Failed to create match" }, { status: 500 });
  }
}
