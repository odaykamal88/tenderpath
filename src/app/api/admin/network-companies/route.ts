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

  // Minimum lead time on the outreach worklist: only surface matches whose
  // tender deadline is at least N days out, so there's still runway to reach
  // out and bid. 0 (or absent) = no floor, the legacy "everything" view.
  // Applied to BOTH the worklist and each company's Fresh count so the badge
  // and the list agree.
  const minDays = Math.max(0, Math.floor(Number(new URL(request.url).searchParams.get("min_days") ?? 0)) || 0);

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
          -- Count DISTINCT opportunities, not raw match rows. Cross-posted
          -- duplicates (same opportunity under different reference_ids → separate
          -- tenders rows) would otherwise inflate these badges above the deduped
          -- worklist below. Key mirrors dedupeTenders(): normalized title+agency+deadline.
          COUNT(DISTINCT (
            LEFT(BTRIM(REGEXP_REPLACE(LOWER(COALESCE(t.title, '')),  '[^a-z0-9]+', ' ', 'g')), 120) || '|' ||
            LEFT(BTRIM(REGEXP_REPLACE(LOWER(COALESCE(t.agency, '')), '[^a-z0-9]+', ' ', 'g')), 120) || '|' ||
            COALESCE(t.deadline::date::text, '')
          )) AS total,
          COUNT(DISTINCT (
            LEFT(BTRIM(REGEXP_REPLACE(LOWER(COALESCE(t.title, '')),  '[^a-z0-9]+', ' ', 'g')), 120) || '|' ||
            LEFT(BTRIM(REGEXP_REPLACE(LOWER(COALESCE(t.agency, '')), '[^a-z0-9]+', ' ', 'g')), 120) || '|' ||
            COALESCE(t.deadline::date::text, '')
          )) FILTER (
            WHERE m.status = 'new'
              AND (
                ${minDays} <= 0
                OR (t.deadline IS NOT NULL AND t.deadline >= CURRENT_DATE + (${minDays})::int)
              )
          ) AS fresh,
          MAX(m.score) AS top_score
        FROM network_company_matches m
        JOIN tenders t ON t.id = m.tender_id
        WHERE t.status = 'open' AND COALESCE(t.has_broken_link, false) = false
          AND t.deadline >= CURRENT_DATE
        GROUP BY m.network_company_id
      ) mc ON mc.network_company_id = c.id
      ORDER BY c.is_active DESC, COALESCE(mc.fresh, 0) DESC, c.created_at DESC
    `,
    // Outreach worklist. Collapses cross-posted duplicates per company: the same
    // opportunity is published by overlapping sources under different reference_ids
    // and stored as separate tenders rows, so one company can match the same
    // opportunity more than once and show it twice in a bundle. We keep one row per
    // (company, opportunity) on the crawler's canonical key (normalized
    // title+agency+deadline, matching dedupeTenders()), preferring the highest score.
    // LIMIT 1000 (raised 100→1000, 2026-06-19) applies AFTER dedup so far-out
    // tenders still surface; the per-company Fresh count above counts the same
    // distinct opportunities, so badge and list stay in agreement.
    sql`
      WITH worklist AS (
        SELECT
          m.id, m.score, m.match_reasons, m.status, m.first_seen_at,
          c.id AS company_id, c.name AS company_name, c.contact_name, c.contact_email, c.contact_linkedin,
          t.id AS tender_id, t.title AS tender_title, t.agency AS tender_agency,
          t.country AS tender_country, t.sector AS tender_sector, t.deadline AS tender_deadline,
          t.estimated_value AS tender_value, t.source_url AS tender_source_url, t.reference_id AS tender_reference,
          t.opportunity_type AS tender_type,
          -- Per-company engagement context (operator judgement aids; never shown to the prospect).
          COALESCE(eng.contacted_count, 0)::int AS contacted_count,
          COALESCE(eng.won_count, 0)::int AS won_count,
          COALESCE(eng.lost_count, 0)::int AS lost_count,
          (
            t.agency IS NOT NULL AND TRIM(t.agency) <> ''
            AND eng.lost_agencies IS NOT NULL
            AND LOWER(TRIM(t.agency)) = ANY(eng.lost_agencies)
          ) AS lost_agency_before
        FROM network_company_matches m
        JOIN network_companies c ON c.id = m.network_company_id
        JOIN tenders t ON t.id = m.tender_id
        LEFT JOIN (
          SELECT
            em.network_company_id AS cid,
            COUNT(*) FILTER (WHERE em.status = 'contacted') AS contacted_count,
            COUNT(*) FILTER (WHERE em.status = 'won') AS won_count,
            COUNT(*) FILTER (WHERE em.status = 'lost') AS lost_count,
            COALESCE(
              ARRAY_AGG(DISTINCT LOWER(TRIM(et.agency)))
                FILTER (WHERE em.status = 'lost' AND et.agency IS NOT NULL AND TRIM(et.agency) <> ''),
              '{}'::text[]
            ) AS lost_agencies
          FROM network_company_matches em
          JOIN tenders et ON et.id = em.tender_id
          GROUP BY em.network_company_id
        ) eng ON eng.cid = c.id
        WHERE m.status = 'new' AND c.is_active = TRUE
          AND t.status = 'open' AND COALESCE(t.has_broken_link, false) = false
          AND t.deadline >= CURRENT_DATE
          AND (
            ${minDays} <= 0
            OR (t.deadline IS NOT NULL AND t.deadline >= CURRENT_DATE + (${minDays})::int)
          )
      ),
      deduped AS (
        SELECT DISTINCT ON (
          company_id,
          LEFT(BTRIM(REGEXP_REPLACE(LOWER(COALESCE(tender_title, '')),  '[^a-z0-9]+', ' ', 'g')), 120),
          LEFT(BTRIM(REGEXP_REPLACE(LOWER(COALESCE(tender_agency, '')), '[^a-z0-9]+', ' ', 'g')), 120),
          tender_deadline::date
        ) *
        FROM worklist
        ORDER BY
          company_id,
          LEFT(BTRIM(REGEXP_REPLACE(LOWER(COALESCE(tender_title, '')),  '[^a-z0-9]+', ' ', 'g')), 120),
          LEFT(BTRIM(REGEXP_REPLACE(LOWER(COALESCE(tender_agency, '')), '[^a-z0-9]+', ' ', 'g')), 120),
          tender_deadline::date,
          score DESC, id DESC
      )
      SELECT * FROM deduped
      ORDER BY tender_deadline ASC NULLS LAST, score DESC
      LIMIT 1000
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
