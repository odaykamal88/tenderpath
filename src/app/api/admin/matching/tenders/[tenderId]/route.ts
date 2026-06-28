import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";

type TenderDetailRow = {
  id: number;
  title: string;
  description: string | null;
  agency: string | null;
  country: string | null;
  country_code: string | null;
  region: string | null;
  sector: string | null;
  deadline: string | null;
  estimated_value: string | null;
  source_url: string | null;
  source_name: string | null;
  opportunity_type: string | null;
  eligibility_summary: string | null;
  required_registrations: string | null;
  requirements: unknown;
  jv_allowed: boolean | null;
  experience_level: string | null;
  submission_language: string | null;
  reference_id: string | null;
  status: string | null;
  has_broken_link: boolean | null;
  copy_count: number | string | null;
  sibling_ids: number[] | null;
  source_names: string[] | null;
  reference_ids: string[] | null;
};

type CandidateRow = {
  id: number;
  company_name: string | null;
  email: string | null;
  website: string | null;
  description: string | null;
  sector: string | null;
  countries: unknown;
  org_type: string | null;
  readiness_score: number | null;
  services: unknown;
  capabilities: unknown;
  final_url: string | null;
  tier: string | null;
  ungm_status: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  relationship_notes: string | null;
  already_matched: boolean;
};

function asArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v)).map((v) => v.trim()).filter(Boolean);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return asArray(parsed);
    } catch {
      return [trimmed];
    }
  }
  return [];
}

function normalized(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function tokenSet(value: string): Set<string> {
  return new Set(
    normalized(value)
      .split(" ")
      .filter((t) => t.length > 3 && !["services", "service", "solutions", "solution", "company", "support"].includes(t)),
  );
}

function hasTextOverlap(a: string | null | undefined, b: string | null | undefined): boolean {
  const aa = normalized(a);
  const bb = normalized(b);
  if (!aa || !bb) return false;
  if (aa.includes(bb) || bb.includes(aa)) return true;
  const aTokens = tokenSet(aa);
  for (const t of tokenSet(bb)) if (aTokens.has(t)) return true;
  return false;
}

function phraseHits(tenderText: string, phrases: string[], max = 3): string[] {
  const text = normalized(tenderText);
  const textTokens = tokenSet(text);
  const hits: string[] = [];
  for (const phrase of phrases) {
    const p = normalized(phrase);
    if (p.length < 4) continue;
    if (text.includes(p)) {
      hits.push(phrase);
    } else {
      let overlap = 0;
      for (const token of tokenSet(p)) if (textTokens.has(token)) overlap++;
      if (overlap >= Math.min(2, Math.max(1, tokenSet(p).size))) hits.push(phrase);
    }
    if (hits.length >= max) break;
  }
  return hits;
}

function countryHit(candidateCountries: string[], tenderCountry: string | null): { hit: boolean; label: string | null } {
  const country = normalized(tenderCountry);
  if (!country) return { hit: false, label: null };
  for (const c of candidateCountries) {
    const cc = normalized(c);
    if (!cc) continue;
    if (cc === country || cc.includes(country) || country.includes(cc)) return { hit: true, label: c };
    if (["global", "worldwide", "regional", "international"].includes(cc)) return { hit: true, label: c };
  }
  return { hit: false, label: null };
}

type ScoredCandidate = CandidateRow & {
  fit_score: number;
  fit_reasons: string[];
  fit_caveats: string[];
  assessment_count: number;
  assessment_ids: number[];
};

function vendorKey(candidate: CandidateRow): string {
  const company = normalized(candidate.company_name);
  if (company) return `company:${company}`;
  const email = normalized(candidate.email);
  if (email) return `email:${email}`;
  const website = normalized(candidate.website);
  if (website) return `website:${website}`;
  return `assessment:${candidate.id}`;
}

function compareCandidates(a: Pick<ScoredCandidate, "already_matched" | "fit_score" | "readiness_score" | "id">, b: Pick<ScoredCandidate, "already_matched" | "fit_score" | "readiness_score" | "id">): number {
  return (b.already_matched ? 1 : 0) - (a.already_matched ? 1 : 0)
    || b.fit_score - a.fit_score
    || (b.readiness_score ?? 0) - (a.readiness_score ?? 0)
    || b.id - a.id;
}

function scoreCandidate(tender: TenderDetailRow, candidate: CandidateRow): ScoredCandidate {
  const tenderText = [
    tender.title,
    tender.description,
    tender.sector,
    tender.eligibility_summary,
    tender.required_registrations,
    typeof tender.requirements === "string" ? tender.requirements : JSON.stringify(tender.requirements ?? ""),
  ].filter(Boolean).join(" ");

  const services = asArray(candidate.services);
  const capabilities = asArray(candidate.capabilities);
  const countries = asArray(candidate.countries);
  const reasons: string[] = [];
  const caveats: string[] = [];
  let score = 0;

  if (candidate.already_matched) {
    score += 100;
    reasons.push("already routed to this opportunity");
  }

  if (hasTextOverlap(candidate.sector, tender.sector)) {
    score += 28;
    reasons.push(`sector aligns: ${candidate.sector}`);
  }

  const capabilityHits = phraseHits(tenderText, capabilities, 3);
  if (capabilityHits.length) {
    score += Math.min(30, capabilityHits.length * 10);
    reasons.push(`capability evidence: ${capabilityHits.join(", ")}`);
  } else if (!capabilities.length) {
    caveats.push("no capability tags");
  }

  const serviceHits = phraseHits(tenderText, services, 2);
  if (serviceHits.length) {
    score += Math.min(14, serviceHits.length * 7);
    reasons.push(`service overlap: ${serviceHits.join(", ")}`);
  }

  const geo = countryHit(countries, tender.country);
  if (geo.hit) {
    score += 14;
    reasons.push(`geography covers ${geo.label}`);
  } else if (tender.country) {
    caveats.push(`no explicit ${tender.country} coverage`);
  }

  if (candidate.ungm_status === "registered") {
    score += 7;
    reasons.push("UNGM registered");
  } else if (!candidate.ungm_status || candidate.ungm_status === "unknown") {
    caveats.push("UNGM status unknown");
  }

  if (candidate.tier === "T1") {
    score += 7;
    reasons.push("Tier T1 vendor");
  } else if (candidate.tier === "T2") {
    score += 4;
    reasons.push("Tier T2 vendor");
  }

  if (typeof candidate.readiness_score === "number") {
    score += Math.min(18, Math.max(0, Math.round(candidate.readiness_score * 0.18)));
    if (candidate.readiness_score >= 75) reasons.push(`readiness ${candidate.readiness_score}`);
  }

  if (!reasons.length) reasons.push("needs manual review");
  return {
    ...candidate,
    countries,
    services,
    capabilities,
    fit_score: Math.min(100, score),
    fit_reasons: reasons.slice(0, 5),
    fit_caveats: caveats.slice(0, 3),
    assessment_count: 1,
    assessment_ids: [candidate.id],
  };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ tenderId: string }> }
) {
  const guard = await requireAdmin(request);
  if (!guard.authorized) return guard.response!;

  const { tenderId: rawId } = await context.params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid tender id" }, { status: 400 });
  }

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 250), 1), 500);

  try {
    const tenderRows = (await sql`
      WITH target AS (
        SELECT
          id, title, description, agency, country, country_code, region, sector,
          deadline, estimated_value, source_url, source_name, opportunity_type,
          eligibility_summary, required_registrations, requirements,
          jv_allowed, experience_level, submission_language, reference_id,
          status, has_broken_link, created_at, updated_at,
          LEFT(BTRIM(REGEXP_REPLACE(LOWER(COALESCE(title, '')),  '[^a-z0-9]+', ' ', 'g')), 120) AS key_title,
          CASE
            WHEN LOWER(COALESCE(agency, '')) LIKE '%undp%' OR LOWER(COALESCE(agency, '')) LIKE '%united nations development programme%' THEN 'un development programme undp'
            WHEN LOWER(COALESCE(agency, '')) LIKE '%unicef%' THEN 'un children fund unicef'
            WHEN LOWER(COALESCE(agency, '')) LIKE '%unhcr%' OR LOWER(COALESCE(agency, '')) LIKE '%high commissioner for refugees%' THEN 'un refugee agency unhcr'
            WHEN LOWER(COALESCE(agency, '')) LIKE '%unops%' THEN 'unops'
            WHEN LOWER(COALESCE(agency, '')) LIKE '%unrwa%' THEN 'unrwa'
            WHEN LOWER(COALESCE(agency, '')) LIKE '%world bank%' THEN 'world bank'
            WHEN LOWER(COALESCE(agency, '')) LIKE '%asian development bank%' OR LOWER(COALESCE(agency, '')) = 'adb' THEN 'asian development bank adb'
            WHEN LOWER(COALESCE(agency, '')) LIKE '%african development bank%' OR LOWER(COALESCE(agency, '')) = 'afdb' THEN 'african development bank afdb'
            WHEN LOWER(COALESCE(agency, '')) LIKE '%ebrd%' OR LOWER(COALESCE(agency, '')) LIKE '%european bank for reconstruction%' THEN 'ebrd'
            WHEN LOWER(COALESCE(agency, '')) LIKE '%isdb%' OR LOWER(COALESCE(agency, '')) LIKE '%islamic development bank%' THEN 'isdb'
            WHEN LOWER(COALESCE(agency, '')) LIKE '%usaid%' THEN 'usaid'
            WHEN LOWER(COALESCE(agency, '')) LIKE '%giz%' THEN 'giz'
            WHEN LOWER(COALESCE(agency, '')) LIKE '%jica%' THEN 'jica'
            ELSE LEFT(BTRIM(REGEXP_REPLACE(LOWER(COALESCE(agency, '')), '[^a-z0-9]+', ' ', 'g')), 120)
          END AS key_agency,
          COALESCE(deadline::date::text, '') AS key_deadline
        FROM tenders
        WHERE id = ${id}
        LIMIT 1
      ),
      siblings AS (
        SELECT t.id, t.source_name, t.reference_id
        FROM tenders t
        JOIN target x
          ON LEFT(BTRIM(REGEXP_REPLACE(LOWER(COALESCE(t.title, '')),  '[^a-z0-9]+', ' ', 'g')), 120) = x.key_title
         AND CASE
            WHEN LOWER(COALESCE(t.agency, '')) LIKE '%undp%' OR LOWER(COALESCE(t.agency, '')) LIKE '%united nations development programme%' THEN 'un development programme undp'
            WHEN LOWER(COALESCE(t.agency, '')) LIKE '%unicef%' THEN 'un children fund unicef'
            WHEN LOWER(COALESCE(t.agency, '')) LIKE '%unhcr%' OR LOWER(COALESCE(t.agency, '')) LIKE '%high commissioner for refugees%' THEN 'un refugee agency unhcr'
            WHEN LOWER(COALESCE(t.agency, '')) LIKE '%unops%' THEN 'unops'
            WHEN LOWER(COALESCE(t.agency, '')) LIKE '%unrwa%' THEN 'unrwa'
            WHEN LOWER(COALESCE(t.agency, '')) LIKE '%world bank%' THEN 'world bank'
            WHEN LOWER(COALESCE(t.agency, '')) LIKE '%asian development bank%' OR LOWER(COALESCE(t.agency, '')) = 'adb' THEN 'asian development bank adb'
            WHEN LOWER(COALESCE(t.agency, '')) LIKE '%african development bank%' OR LOWER(COALESCE(t.agency, '')) = 'afdb' THEN 'african development bank afdb'
            WHEN LOWER(COALESCE(t.agency, '')) LIKE '%ebrd%' OR LOWER(COALESCE(t.agency, '')) LIKE '%european bank for reconstruction%' THEN 'ebrd'
            WHEN LOWER(COALESCE(t.agency, '')) LIKE '%isdb%' OR LOWER(COALESCE(t.agency, '')) LIKE '%islamic development bank%' THEN 'isdb'
            WHEN LOWER(COALESCE(t.agency, '')) LIKE '%usaid%' THEN 'usaid'
            WHEN LOWER(COALESCE(t.agency, '')) LIKE '%giz%' THEN 'giz'
            WHEN LOWER(COALESCE(t.agency, '')) LIKE '%jica%' THEN 'jica'
            ELSE LEFT(BTRIM(REGEXP_REPLACE(LOWER(COALESCE(t.agency, '')), '[^a-z0-9]+', ' ', 'g')), 120)
          END = x.key_agency
         AND COALESCE(t.deadline::date::text, '') = x.key_deadline
      )
      SELECT
        target.id, target.title, target.description, target.agency, target.country,
        target.country_code, target.region, target.sector, target.deadline,
        target.estimated_value, target.source_url, target.source_name,
        target.opportunity_type, target.eligibility_summary,
        target.required_registrations, target.requirements, target.jv_allowed,
        target.experience_level, target.submission_language, target.reference_id,
        target.status, target.has_broken_link, target.created_at, target.updated_at,
        (SELECT COUNT(*)::int FROM siblings) AS copy_count,
        (SELECT ARRAY_AGG(id ORDER BY id) FROM siblings) AS sibling_ids,
        (SELECT ARRAY_REMOVE(ARRAY_AGG(DISTINCT source_name ORDER BY source_name), NULL) FROM siblings) AS source_names,
        (SELECT ARRAY_REMOVE(ARRAY_AGG(DISTINCT reference_id ORDER BY reference_id), NULL) FROM siblings) AS reference_ids
      FROM target
    `) as TenderDetailRow[];

    if (!tenderRows.length) {
      return NextResponse.json({ error: "Tender not found" }, { status: 404 });
    }

    const tender = tenderRows[0];
    const siblingIds = Array.isArray(tender.sibling_ids) && tender.sibling_ids.length ? tender.sibling_ids : [id];

    const [candidateRows, matchRows] = await Promise.all([
      sql`
      SELECT
        a.id, a.company_name, a.email, a.website, a.description,
        a.sector, a.countries, a.org_type, a.readiness_score, a.created_at,
        a.ai_analysis->'services' AS services,
        a.ai_analysis->'capabilities' AS capabilities,
        a.crawled_data->>'finalUrl' AS final_url,
        vp.tier, vp.ungm_status, vp.contact_name, vp.contact_email,
        vp.contact_phone, vp.relationship_notes,
        vp.updated_at AS profile_updated_at,
        EXISTS (
          SELECT 1 FROM tender_vendor_matches m
          WHERE m.tender_id = ANY(${siblingIds}::int[]) AND m.assessment_id = a.id
        ) AS already_matched
      FROM assessments a
      LEFT JOIN vendor_profiles vp ON vp.assessment_id = a.id
      WHERE (
        ${q} = ''
        OR a.company_name ILIKE ${`%${q}%`}
        OR a.email ILIKE ${`%${q}%`}
        OR a.sector ILIKE ${`%${q}%`}
        OR a.description ILIKE ${`%${q}%`}
      )
      ORDER BY a.created_at DESC
      LIMIT ${limit}
    `,
      sql`
      SELECT
        m.id, m.tender_id, m.assessment_id, m.routed_service, m.status,
        m.fit_reasoning, m.outcome, m.created_at, m.updated_at,
        a.company_name AS vendor_company, a.email AS vendor_email,
        vp.tier AS vendor_tier,
        u.email AS created_by_email
      FROM tender_vendor_matches m
      JOIN assessments a ON a.id = m.assessment_id
      LEFT JOIN vendor_profiles vp ON vp.assessment_id = a.id
      LEFT JOIN users u ON u.id = m.created_by
      WHERE m.tender_id = ANY(${siblingIds}::int[])
      ORDER BY m.updated_at DESC
    `,
    ]);

    const byVendor = new Map<string, ScoredCandidate>();
    for (const candidate of (candidateRows as CandidateRow[]).map((row) => scoreCandidate(tender, row))) {
      const key = vendorKey(candidate);
      const existing = byVendor.get(key);
      if (!existing) {
        byVendor.set(key, candidate);
        continue;
      }
      const assessmentIds = [...existing.assessment_ids, candidate.id];
      const assessmentCount = existing.assessment_count + 1;
      if (compareCandidates(existing, candidate) > 0) {
        byVendor.set(key, { ...candidate, assessment_count: assessmentCount, assessment_ids: assessmentIds });
      } else {
        existing.assessment_count = assessmentCount;
        existing.assessment_ids = assessmentIds;
      }
    }

    const candidates = [...byVendor.values()].sort(compareCandidates);

    return NextResponse.json({
      tender,
      candidates,
      matches: matchRows,
    });
  } catch (err) {
    console.error("[matching:tender-detail:db_error]", { tenderId: id, err });
    return NextResponse.json({ error: "Failed to load tender matching detail" }, { status: 500 });
  }
}
