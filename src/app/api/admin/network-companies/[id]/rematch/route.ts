import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";
import { ensureNetworkMatchingColumns } from "@/lib/network/schema";
import { buildNetworkCompanyProfile } from "@/lib/network/profile";
import { matchNetworkCompany } from "@/lib/network/match";

// May rebuild a failed/pending profile (crawl + AI) before matching.
export const maxDuration = 120;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(request);
  if (!guard.authorized) return guard.response!;
  await ensureNetworkMatchingColumns();

  const { id: rawId } = await context.params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid company id" }, { status: 400 });
  }

  const rows = await sql`
    SELECT id, website, services_text, countries, sectors, org_type, profile_status
    FROM network_companies WHERE id = ${id} LIMIT 1
  `;
  if (!rows.length) return NextResponse.json({ error: "Company not found" }, { status: 404 });
  const c = rows[0];

  // If the profile isn't ready (never built, or a prior build failed), rebuild
  // first so "re-match now" doubles as a "fix profile" action.
  let profile: { status: string; error: string | null } | null = null;
  if (c.profile_status !== "ready") {
    const res = await buildNetworkCompanyProfile({
      id,
      website: c.website as string | null,
      services_text: c.services_text as string | null,
      countries: (c.countries as string[]) ?? [],
      sectors: (c.sectors as string[]) ?? [],
      org_type: c.org_type as string | null,
    });
    profile = { status: res.status, error: res.error ?? null };
    if (res.status !== "ready") {
      return NextResponse.json({ profile, match: null }, { status: 200 });
    }
  }

  const match = await matchNetworkCompany(id);
  return NextResponse.json({ profile, match });
}
