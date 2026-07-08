import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";
import { ensureNetworkMatchingColumns } from "@/lib/network/schema";

// Bulk import inserts CRM records only — NO per-row crawl/AI (that's what made
// importing 45 owner-contacts impractical one-at-a-time). Profiling + matching
// run later via a company's "Re-match" button or the daily cron. So this is fast
// and a generous row cap is safe.
export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_ROWS = 2000;

function cleanStr(v: unknown, max = 2000): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

function toStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
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
  const rowsIn = (body as { rows?: unknown })?.rows;
  if (!Array.isArray(rowsIn)) {
    return NextResponse.json({ error: "Expected { rows: [...] }" }, { status: 400 });
  }
  if (rowsIn.length > MAX_ROWS) {
    return NextResponse.json({ error: `Too many rows (max ${MAX_ROWS} per import).` }, { status: 413 });
  }

  // Existing names (case-insensitive) so re-running an import skips dupes rather
  // than creating a second copy of the same company.
  const existingRows = await sql`SELECT LOWER(TRIM(name)) AS key FROM network_companies`;
  const seen = new Set<string>(existingRows.map((r) => String(r.key)));

  const createdBy = guard.user?.id ?? null;
  let inserted = 0;
  const skippedNames: string[] = [];
  const failedNames: string[] = [];
  const ids: number[] = [];

  for (const raw of rowsIn) {
    const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const name = cleanStr(r.name, 200);
    if (!name) { skippedNames.push("(no name)"); continue; }
    const key = name.toLowerCase();
    if (seen.has(key)) { skippedNames.push(name); continue; }
    seen.add(key);

    const website = cleanStr(r.website, 500);
    const servicesText = cleanStr(r.services_text, 4000);
    const countries = toStringArray(r.countries);
    const sectors = toStringArray(r.sectors);
    const contactName = cleanStr(r.contact_name, 200);
    const contactTitle = cleanStr(r.contact_title, 200);
    const contactEmail = cleanStr(r.contact_email, 320);
    const contactEmailStatus = cleanStr(r.contact_email_status, 40);
    const contactLinkedin = cleanStr(r.contact_linkedin, 500);
    const unBuyer = cleanStr(r.un_buyer, 300);
    const city = cleanStr(r.city, 120);
    const notes = cleanStr(r.notes, 4000);

    try {
      const out = await sql`
        INSERT INTO network_companies (
          name, website, services_text, countries, sectors,
          contact_name, contact_title, contact_email, contact_email_status, contact_linkedin,
          un_buyer, city, notes, created_by, profile_status, pipeline_stage
        ) VALUES (
          ${name}, ${website}, ${servicesText},
          ${JSON.stringify(countries)}::jsonb, ${JSON.stringify(sectors)}::jsonb,
          ${contactName}, ${contactTitle}, ${contactEmail}, ${contactEmailStatus}, ${contactLinkedin},
          ${unBuyer}, ${city}, ${notes}, ${createdBy}, 'pending', 'lead'
        )
        RETURNING id
      `;
      const id = Number(out[0].id);
      ids.push(id);
      inserted++;
      // Activity log is best-effort: the company is already inserted, so a failure
      // logging its 'import' event must NOT flip it into the failed bucket.
      try {
        await sql`
          INSERT INTO network_company_activity (network_company_id, kind, body, created_by)
          VALUES (${id}, 'import', 'Imported from spreadsheet', ${createdBy})
        `;
      } catch (logErr) {
        console.error("[network:import:bulk_activity_failed]", { id, error: logErr instanceof Error ? logErr.message : String(logErr) });
      }
    } catch (err) {
      failedNames.push(name);
      console.error("[network:import:bulk_insert_failed]", { name, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return NextResponse.json({
    inserted,
    skipped: skippedNames.length,
    failed: failedNames.length,
    skippedNames: skippedNames.slice(0, 100),
    failedNames: failedNames.slice(0, 100),
    ids,
  });
}
