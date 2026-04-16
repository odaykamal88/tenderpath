import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireSubscription } from "@/lib/subscription-guard";

/**
 * FIX #2 in action: Tenders list requires tender-intelligence tier or above.
 */
export async function GET(request: Request) {
  const guard = await requireSubscription(request, "tender-intelligence");
  if (!guard.authorized) return guard.response!;

  const url = new URL(request.url);
  const sector = url.searchParams.get("sector");
  const country = url.searchParams.get("country");
  const agency = url.searchParams.get("agency");
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get("limit") ?? "20", 10)));
  const offset = (page - 1) * limit;

  let tenders;
  if (sector && country) {
    tenders = await sql`
      SELECT id, title, agency, reference_id, deadline, country, region, sector, source_url, status, created_at
      FROM tenders
      WHERE status = 'open' AND sector = ${sector} AND country = ${country}
      ORDER BY deadline ASC
      LIMIT ${limit} OFFSET ${offset}
    `;
  } else if (sector) {
    tenders = await sql`
      SELECT id, title, agency, reference_id, deadline, country, region, sector, source_url, status, created_at
      FROM tenders
      WHERE status = 'open' AND sector = ${sector}
      ORDER BY deadline ASC
      LIMIT ${limit} OFFSET ${offset}
    `;
  } else if (country) {
    tenders = await sql`
      SELECT id, title, agency, reference_id, deadline, country, region, sector, source_url, status, created_at
      FROM tenders
      WHERE status = 'open' AND country = ${country}
      ORDER BY deadline ASC
      LIMIT ${limit} OFFSET ${offset}
    `;
  } else if (agency) {
    tenders = await sql`
      SELECT id, title, agency, reference_id, deadline, country, region, sector, source_url, status, created_at
      FROM tenders
      WHERE status = 'open' AND agency = ${agency}
      ORDER BY deadline ASC
      LIMIT ${limit} OFFSET ${offset}
    `;
  } else {
    tenders = await sql`
      SELECT id, title, agency, reference_id, deadline, country, region, sector, source_url, status, created_at
      FROM tenders
      WHERE status = 'open'
      ORDER BY deadline ASC
      LIMIT ${limit} OFFSET ${offset}
    `;
  }

  return NextResponse.json({ tenders, page, limit });
}
