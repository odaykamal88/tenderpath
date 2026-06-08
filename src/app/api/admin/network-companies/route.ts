import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";
import { ensureNetworkMatchingColumns } from "@/lib/network/schema";
import { buildNetworkCompanyProfile } from "@/lib/network/profile";
import { matchNetworkCompany } from "@/lib/network/match";

// Creating a company crawls the website + runs two Claude calls + an initial
// match pass, so allow more than the default serverless budget.
export const maxDuration = 120;

function cleanStr(v: unknown, max = 2000): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

function toStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  // Accept a comma-separated string from a plain text input too.
  if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}

export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.authorized) return guard.response!;
  await ensureNetworkMatchingColumns();

  const [rows, fresh] = await Promise.all([
    sql`
      SELECT
        c.id, c.name, c.website, c.services_text, c.countries, c.sectors, c.org_type,
        c.profile_status, c.profile_error, c.contact_name, c.contact_email, c.contact_phone,
        c.notes, c.is_active, c.last_matched_at, c.created_at, c.updated_at,
        c.ai_analysis->>'detected_industry' AS detected_industry,
        COALESCE(mc.total, 0)::int AS match_count,
        COALESCE(mc.fresh, 0)::int AS fresh_count,
        COALESCE(mc.top_score, 0)::int AS top_score
      FROM network_companies c
      LEFT JOIN (
        SELECT
          m.network_company_id,
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE m.status = 'new') AS fresh,
          MAX(m.score) AS top_score
        FROM network_company_matches m
        JOIN tenders t ON t.id = m.tender_id
        WHERE t.status = 'open' AND COALESCE(t.has_broken_link, false) = false
        GROUP BY m.network_company_id
      ) mc ON mc.network_company_id = c.id
      ORDER BY c.is_active DESC, COALESCE(mc.fresh, 0) DESC, c.created_at DESC
    `,
    sql`
      SELECT
        m.id, m.score, m.match_reasons, m.status, m.first_seen_at,
        c.id AS company_id, c.name AS company_name, c.contact_name, c.contact_email, c.contact_linkedin,
        t.id AS tender_id, t.title AS tender_title, t.agency AS tender_agency,
        t.country AS tender_country, t.sector AS tender_sector, t.deadline AS tender_deadline,
        t.estimated_value AS tender_value, t.source_url AS tender_source_url, t.reference_id AS tender_reference,
        t.opportunity_type AS tender_type
      FROM network_company_matches m
      JOIN network_companies c ON c.id = m.network_company_id
      JOIN tenders t ON t.id = m.tender_id
      WHERE m.status = 'new' AND c.is_active = TRUE
        AND t.status = 'open' AND COALESCE(t.has_broken_link, false) = false
      ORDER BY t.deadline ASC NULLS LAST, m.score DESC
      LIMIT 100
    `,
  ]);

  return NextResponse.json({ companies: rows, fresh, total: rows.length });
}

export async function POST(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.authorized) return guard.response!;
  await ensureNetworkMatchingColumns();

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

  const name = cleanStr(b.name, 200);
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const website = cleanStr(b.website, 500);
  const servicesText = cleanStr(b.services_text, 4000);
  const countries = toStringArray(b.countries);
  const sectors = toStringArray(b.sectors);
  const orgType = cleanStr(b.org_type, 100);
  const contactName = cleanStr(b.contact_name, 200);
  const contactEmail = cleanStr(b.contact_email, 320);
  const contactPhone = cleanStr(b.contact_phone, 50);
  const contactLinkedin = cleanStr(b.contact_linkedin, 500);
  const notes = cleanStr(b.notes, 4000);

  if (!website && !servicesText) {
    return NextResponse.json(
      { error: "Provide a website or a service description so we can build a match profile." },
      { status: 400 },
    );
  }

  const inserted = await sql`
    INSERT INTO network_companies (
      name, website, services_text, countries, sectors, org_type,
      contact_name, contact_email, contact_phone, contact_linkedin, notes, created_by, profile_status
    ) VALUES (
      ${name}, ${website}, ${servicesText},
      ${JSON.stringify(countries)}::jsonb, ${JSON.stringify(sectors)}::jsonb, ${orgType},
      ${contactName}, ${contactEmail}, ${contactPhone}, ${contactLinkedin}, ${notes},
      ${guard.user?.id ?? null}, 'pending'
    )
    RETURNING id
  `;
  const id = Number(inserted[0].id);

  // Build the profile (crawl + AI) and run an initial match inline so the
  // company is immediately useful. Failures are recorded on the row, not thrown.
  const profile = await buildNetworkCompanyProfile({
    id, website, services_text: servicesText, countries, sectors, org_type: orgType,
  });
  const match = profile.status === "ready" ? await matchNetworkCompany(id) : null;

  const rows = await sql`
    SELECT
      c.id, c.name, c.website, c.services_text, c.countries, c.sectors, c.org_type,
      c.profile_status, c.profile_error, c.contact_name, c.contact_email, c.contact_phone,
      c.notes, c.is_active, c.last_matched_at, c.created_at, c.updated_at,
      c.ai_analysis->>'detected_industry' AS detected_industry
    FROM network_companies c WHERE c.id = ${id}
  `;
  return NextResponse.json(
    { company: rows[0], profile: { status: profile.status, error: profile.error ?? null }, match },
    { status: 201 },
  );
}
