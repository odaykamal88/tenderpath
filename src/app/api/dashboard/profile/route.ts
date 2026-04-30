/**
 * GET  /api/dashboard/profile — return user profile, auto-populating from
 *      latest assessment when profile_source is 'unset'.
 * PATCH /api/dashboard/profile — save manual profile edits.
 */
import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireAuth } from "@/lib/subscription-guard";

interface ProfileRow {
  business_name: string | null;
  website: string | null;
  sector: string | null;
  country_focus: string[] | null;
  org_type: string | null;
  profile_description: string | null;
  profile_source: string | null;
}

interface AssessmentRow {
  company_name: string;
  website: string | null;
  sector: string | null;
  countries: string[] | null;
  org_type: string | null;
  description: string | null;
  ai_analysis: {
    detected_industry?: string;
    sectors?: string[];
    summary?: string;
  } | null;
}

export async function GET(request: Request) {
  const guard = await requireAuth(request);
  if (!guard.authorized) return guard.response!;
  const user = guard.user!;

  // Ensure profile columns exist (safe no-op on newer DBs)
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS business_name TEXT`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS website TEXT`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS sector TEXT`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS country_focus JSONB DEFAULT '[]'`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS org_type TEXT`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_description TEXT`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_source TEXT DEFAULT 'unset'`;

  const rows = await sql`
    SELECT business_name, website, sector, country_focus,
           org_type, profile_description, profile_source
    FROM users WHERE id = ${user.id}
  `;
  const profile = rows[0] as ProfileRow | undefined;

  const source = profile?.profile_source ?? "unset";
  const hasProfile = source !== "unset" && profile?.business_name;

  if (hasProfile) {
    return NextResponse.json({
      business_name: profile!.business_name,
      website: profile!.website,
      sector: profile!.sector,
      country_focus: (profile!.country_focus as string[] | null) ?? [],
      org_type: profile!.org_type,
      profile_description: profile!.profile_description,
      profile_source: source,
    });
  }

  // Auto-populate from latest assessment
  const aRows = await sql`
    SELECT company_name, website, sector, countries, org_type,
           description, ai_analysis
    FROM assessments
    WHERE email = ${user.email}
    ORDER BY created_at DESC
    LIMIT 1
  `;

  if (!aRows.length) {
    return NextResponse.json({
      business_name: null,
      website: null,
      sector: null,
      country_focus: [],
      org_type: null,
      profile_description: null,
      profile_source: "unset",
    });
  }

  const a = aRows[0] as AssessmentRow;
  const ai = a.ai_analysis;
  const inferredSector = a.sector ?? ai?.detected_industry ?? (ai?.sectors?.[0] ?? null);
  const inferredDescription = ai?.summary ?? a.description ?? null;

  // Write assessment-sourced profile back to users row
  await sql`
    UPDATE users SET
      business_name = ${a.company_name},
      website       = ${a.website ?? null},
      sector        = ${inferredSector ?? null},
      country_focus = ${JSON.stringify(a.countries ?? [])}::jsonb,
      org_type      = ${a.org_type ?? null},
      profile_description = ${inferredDescription ?? null},
      profile_source = 'assessment'
    WHERE id = ${user.id}
  `;

  return NextResponse.json({
    business_name: a.company_name,
    website: a.website ?? null,
    sector: inferredSector ?? null,
    country_focus: a.countries ?? [],
    org_type: a.org_type ?? null,
    profile_description: inferredDescription ?? null,
    profile_source: "assessment",
  });
}

export async function PATCH(request: Request) {
  const guard = await requireAuth(request);
  if (!guard.authorized) return guard.response!;
  const user = guard.user!;

  const body = await request.json() as Partial<{
    business_name: string;
    website: string;
    sector: string;
    country_focus: string[];
    org_type: string;
    profile_description: string;
  }>;

  await sql`
    UPDATE users SET
      business_name       = COALESCE(${body.business_name ?? null}, business_name),
      website             = COALESCE(${body.website ?? null}, website),
      sector              = COALESCE(${body.sector ?? null}, sector),
      country_focus       = COALESCE(${body.country_focus != null ? JSON.stringify(body.country_focus) : null}::jsonb, country_focus),
      org_type            = COALESCE(${body.org_type ?? null}, org_type),
      profile_description = COALESCE(${body.profile_description ?? null}, profile_description),
      profile_source      = 'manual',
      updated_at          = NOW()
    WHERE id = ${user.id}
  `;

  return NextResponse.json({ ok: true });
}
