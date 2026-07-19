import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";
import { ensureNetworkMatchingColumns } from "@/lib/network/schema";
import { buildNetworkCompanyProfile } from "@/lib/network/profile";
import { matchNetworkCompany } from "@/lib/network/match";

// Creating a company crawls the website + runs AI + an initial match — give it
// more than the default serverless budget (mirrors POST /network-companies).
export const maxDuration = 120;

function parseId(v: unknown): number | null {
  const id = Number(v);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function toStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  return [];
}

/**
 * POST /api/admin/network-companies/from-prospect  { prospect_id }
 *
 * Promotes a web-discovered `network_external_prospects` row into a real CRM
 * contact (`network_companies`): seeds the company from the prospect's fields,
 * builds its match profile + an initial match, and links the prospect back
 * (status='added_to_network') so it shows "In network" everywhere. Idempotent —
 * if the prospect is already linked, returns the existing company. Closes the
 * Matching → Network/Sales-CRM seam (no manual re-entry).
 */
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
  const prospectId = parseId((body as Record<string, unknown>)?.prospect_id);
  if (!prospectId) return NextResponse.json({ error: "prospect_id is required" }, { status: 400 });

  const rows = await sql`
    SELECT id, network_company_id, name, website, country, countries, sectors, org_type, services_text
    FROM network_external_prospects WHERE id = ${prospectId} LIMIT 1
  `;
  if (!rows.length) return NextResponse.json({ error: "Prospect not found" }, { status: 404 });
  const p = rows[0];

  // Already promoted — return the existing company, don't duplicate.
  if (p.network_company_id) {
    return NextResponse.json({ company_id: Number(p.network_company_id), alreadyLinked: true });
  }

  const name = String(p.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "Prospect has no name" }, { status: 400 });
  const website = (p.website as string | null) ?? null;
  const servicesText = (p.services_text as string | null) ?? null;
  // Prefer the structured countries list; fall back to the single country field.
  const countries = toStringArray(p.countries).length
    ? toStringArray(p.countries)
    : (p.country ? [String(p.country).trim()].filter(Boolean) : []);
  const sectors = toStringArray(p.sectors);
  const orgType = (p.org_type as string | null) ?? null;

  const inserted = await sql`
    INSERT INTO network_companies (
      name, website, services_text, countries, sectors, org_type, created_by, profile_status, notes
    ) VALUES (
      ${name}, ${website}, ${servicesText},
      ${JSON.stringify(countries)}::jsonb, ${JSON.stringify(sectors)}::jsonb, ${orgType},
      ${guard.user?.id ?? null}, 'pending',
      ${"Added from web discovery on a matched tender."}
    )
    RETURNING id
  `;
  const companyId = Number(inserted[0].id);

  // Link the prospect back immediately so it reads "In network" even if the
  // profile build is slow or fails (the company still exists to work).
  await sql`
    UPDATE network_external_prospects
    SET network_company_id = ${companyId}, status = 'added_to_network', updated_at = NOW()
    WHERE id = ${prospectId}
  `;

  // Build profile + initial match inline. Failures are recorded on the row.
  const profile = await buildNetworkCompanyProfile({
    id: companyId, website, services_text: servicesText, countries, sectors, org_type: orgType,
  });
  const match = profile.status === "ready" ? await matchNetworkCompany(companyId) : null;

  return NextResponse.json(
    { company_id: companyId, profile: { status: profile.status, error: profile.error ?? null }, match },
    { status: 201 },
  );
}
