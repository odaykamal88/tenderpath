/**
 * GET  /api/dashboard/profile — return user profile, auto-populating from
 *      latest assessment when profile_source is 'unset'.
 * PATCH /api/dashboard/profile — save manual profile edits.
 */
import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireAuth } from "@/lib/subscription-guard";
import type { MinedProfileFacts } from "@/lib/applicant-evidence/profile-miner";

interface ProfileRow {
  business_name: string | null;
  website: string | null;
  sector: string | null;
  country_focus: string[] | null;
  org_type: string | null;
  profile_description: string | null;
  profile_source: string | null;
  contact_phone: string | null;
  // Sprint 13. Surface the JSONB column Sprint 8e populates from
  // free-text intake (years_of_experience, sectors_covered,
  // agencies_worked_with, geographic_reach, key_capabilities). The Vault
  // page renders these so the user can see what was inferred from their
  // own typed answers — an evidence-adjacent trust signal.
  mined_profile_facts: MinedProfileFacts | null;
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

interface DerivedProfile {
  business_name: string | null;
  website: string | null;
  sector: string | null;
  country_focus: string[];
  org_type: string | null;
  profile_description: string | null;
}

/** The canonical company identity a completed assessment resolves to — the same
 *  mapping the original auto-populate used, factored out so GET (re-sync) and
 *  POST (force-sync) stay identical. */
function deriveFromAssessment(a: AssessmentRow): DerivedProfile {
  const ai = a.ai_analysis;
  return {
    business_name: a.company_name,
    website: a.website ?? null,
    sector: a.sector ?? ai?.detected_industry ?? ai?.sectors?.[0] ?? null,
    country_focus: Array.isArray(a.countries) ? a.countries : [],
    org_type: a.org_type ?? null,
    profile_description: ai?.summary ?? a.description ?? null,
  };
}

/** True when the cached users-row profile no longer matches the assessment it
 *  claims to mirror — i.e. a newer assessment has resolved a different company.
 *  Drives both the GET re-sync write-skip and the manual-profile "update?" hint. */
function profilesDiffer(profile: ProfileRow | undefined, d: DerivedProfile): boolean {
  if (!profile) return true;
  const norm = (s: string | null | undefined) => (s ?? "").trim();
  return (
    norm(profile.business_name) !== norm(d.business_name) ||
    norm(profile.website) !== norm(d.website) ||
    norm(profile.sector) !== norm(d.sector) ||
    norm(profile.org_type) !== norm(d.org_type) ||
    norm(profile.profile_description) !== norm(d.profile_description) ||
    JSON.stringify((profile.country_focus as string[] | null) ?? []) !== JSON.stringify(d.country_focus)
  );
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
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS contact_phone TEXT`;

  const rows = await sql`
    SELECT business_name, website, sector, country_focus,
           org_type, profile_description, profile_source, contact_phone,
           mined_profile_facts
    FROM users WHERE id = ${user.id}
  `;
  const profile = rows[0] as ProfileRow | undefined;

  const source = profile?.profile_source ?? "unset";
  // Sprint 13. Pre-Sprint-8e accounts have NULL here; empty-object JSONB
  // ({}) collapses to null for the UI so the Vault badge doesn't render
  // an empty card.
  const minedFacts =
    profile?.mined_profile_facts && Object.keys(profile.mined_profile_facts).length > 0
      ? profile.mined_profile_facts
      : null;
  const base = {
    email: user.email ?? null,
    contact_phone: profile?.contact_phone ?? null,
    mined_profile_facts: minedFacts,
  };

  // Latest assessment for this user — the source of truth for company identity.
  const aRows = await sql`
    SELECT company_name, website, sector, countries, org_type,
           description, ai_analysis
    FROM assessments
    WHERE email = ${user.email}
    ORDER BY created_at DESC
    LIMIT 1
  `;
  const derived = aRows.length ? deriveFromAssessment(aRows[0] as AssessmentRow) : null;

  // Manual edits win — never auto-overwrite them. But if a newer assessment now
  // describes a different company, hand the UI a non-destructive "update?" hint
  // (audit 2026-06-19 blocker #3: an earlier/manual profile diverging from the
  // latest assessment, which also leaked into the submission-wizard prefill).
  if (source === "manual" && profile?.business_name) {
    const differs = derived ? profilesDiffer(profile, derived) : false;
    return NextResponse.json({
      ...base,
      business_name: profile.business_name,
      website: profile.website,
      sector: profile.sector,
      country_focus: (profile.country_focus as string[] | null) ?? [],
      org_type: profile.org_type,
      profile_description: profile.profile_description,
      profile_source: "manual",
      assessment_differs: differs,
      latest_assessment: differs ? derived : null,
    });
  }

  // No assessment yet → nothing to mirror.
  if (!derived) {
    // Keep an existing assessment-derived profile if its assessment row was
    // since deleted; otherwise report unset.
    const keep = source === "assessment" && profile?.business_name ? profile : null;
    return NextResponse.json({
      ...base,
      business_name: keep?.business_name ?? null,
      website: keep?.website ?? null,
      sector: keep?.sector ?? null,
      country_focus: (keep?.country_focus as string[] | null) ?? [],
      org_type: keep?.org_type ?? null,
      profile_description: keep?.profile_description ?? null,
      profile_source: keep ? "assessment" : "unset",
      assessment_differs: false,
      latest_assessment: null,
    });
  }

  // 'unset' or 'assessment' → mirror the latest assessment. Re-sync the users
  // row only when something actually changed, so an assessment-derived profile
  // tracks the newest assessment instead of freezing on the first one (the
  // original bug: the populate fired once, then never refreshed).
  if (source === "unset" || profilesDiffer(profile, derived)) {
    await sql`
      UPDATE users SET
        business_name = ${derived.business_name},
        website       = ${derived.website},
        sector        = ${derived.sector},
        country_focus = ${JSON.stringify(derived.country_focus)}::jsonb,
        org_type      = ${derived.org_type},
        profile_description = ${derived.profile_description},
        profile_source = 'assessment'
      WHERE id = ${user.id}
    `;
  }

  return NextResponse.json({
    ...base,
    business_name: derived.business_name,
    website: derived.website,
    sector: derived.sector,
    country_focus: derived.country_focus,
    org_type: derived.org_type,
    profile_description: derived.profile_description,
    profile_source: "assessment",
    assessment_differs: false,
    latest_assessment: null,
  });
}

export async function PATCH(request: Request) {
  const guard = await requireAuth(request);
  if (!guard.authorized) return guard.response!;
  const user = guard.user!;

  const body = await request.json() as Partial<{
    contact_phone: string;
    business_name: string;
    website: string;
    sector: string;
    country_focus: string[];
    org_type: string;
    profile_description: string;
  }>;

  await sql`
    UPDATE users SET
      contact_phone       = COALESCE(${body.contact_phone ?? null}, contact_phone),
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

/**
 * POST /api/dashboard/profile — force-refresh the profile from the user's
 * latest assessment and re-mark it assessment-derived. Backs the "Update from
 * latest assessment" affordance the GET surfaces when a manual profile has
 * diverged from a newer assessment, so the user can opt in without re-typing.
 */
export async function POST(request: Request) {
  const guard = await requireAuth(request);
  if (!guard.authorized) return guard.response!;
  const user = guard.user!;

  const aRows = await sql`
    SELECT company_name, website, sector, countries, org_type,
           description, ai_analysis
    FROM assessments
    WHERE email = ${user.email}
    ORDER BY created_at DESC
    LIMIT 1
  `;
  if (!aRows.length) {
    return NextResponse.json({ error: "No assessment found to sync from." }, { status: 404 });
  }

  const d = deriveFromAssessment(aRows[0] as AssessmentRow);
  await sql`
    UPDATE users SET
      business_name       = ${d.business_name},
      website             = ${d.website},
      sector              = ${d.sector},
      country_focus       = ${JSON.stringify(d.country_focus)}::jsonb,
      org_type            = ${d.org_type},
      profile_description  = ${d.profile_description},
      profile_source      = 'assessment',
      updated_at          = NOW()
    WHERE id = ${user.id}
  `;

  return NextResponse.json({
    ok: true,
    business_name: d.business_name,
    website: d.website,
    sector: d.sector,
    country_focus: d.country_focus,
    org_type: d.org_type,
    profile_description: d.profile_description,
    profile_source: "assessment",
  });
}
