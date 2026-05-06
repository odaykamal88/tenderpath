import { sql } from "@/lib/db";

export type LandingTender = {
  reference: string;
  title: string;
  agency: string;
  country: string;
  value: string | null;
};

const FALLBACK_TENDERS: LandingTender[] = [
  {
    reference: "UNGM",
    title: "Recent UN opportunity",
    agency: "UN",
    country: "Global",
    value: null,
  },
];

function compactTitle(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/\b(request for proposal|invitation to bid|expression of interest)\b[:\s-]*/gi, "")
    .trim()
    .slice(0, 86);
}

function shortRef(reference: string | null, sourceName: string | null): string {
  const raw = reference?.trim() || sourceName?.trim() || "LIVE";
  return raw.replace(/^UNGM-/, "").replace(/^GRANTS_GOV:/, "").slice(0, 22);
}

export async function getLandingTenders(limit = 8): Promise<LandingTender[]> {
  try {
    const rows = await sql`
      SELECT reference_id, title, agency, country, region, estimated_value, source_name
      FROM tenders
      WHERE status = 'open'
        AND source_url IS NOT NULL
        AND TRIM(source_url) <> ''
        AND title IS NOT NULL
        AND TRIM(title) <> ''
        AND title ~ '^[[:ascii:]]+$'
        AND (submission_language IS NULL OR LOWER(submission_language) IN ('', 'english', 'en'))
        AND COALESCE(source_name, '') NOT ILIKE '%DevelopmentAid%'
        AND (deadline IS NULL OR deadline > CURRENT_DATE)
      ORDER BY
        CASE WHEN deadline IS NULL THEN 1 ELSE 0 END,
        deadline ASC,
        updated_at DESC NULLS LAST,
        created_at DESC NULLS LAST
      LIMIT ${Math.max(1, Math.min(12, limit))}
    `;

    const tenders = rows
      .map((row): LandingTender => ({
        reference: shortRef(row.reference_id as string | null, row.source_name as string | null),
        title: compactTitle(String(row.title ?? "")),
        agency: String(row.agency ?? "UN"),
        country: String(row.country ?? row.region ?? "Global"),
        value: row.estimated_value ? String(row.estimated_value) : null,
      }))
      .filter((tender) => tender.title.length > 8);

    return tenders.length ? tenders : FALLBACK_TENDERS;
  } catch (err) {
    console.error("[landing:recent-tenders]", err instanceof Error ? err.message : String(err));
    return FALLBACK_TENDERS;
  }
}
