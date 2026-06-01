import { sql } from "@/lib/db";
import { slugFromLabel, type SectorSlug } from "@/lib/crawlers/sector-map";

/**
 * Live "opportunity signal" for the public assessment wizard.
 *
 * This is a deliberately COARSE pond-size estimate — "how many open UN tenders
 * sit in your sector + geography right now" — shown live as the user fills the
 * wizard so they feel the size of the opportunity before they finish (the
 * launch-priority "wow" moment in AGENTS.md).
 *
 * It is NOT the personalized matcher in `src/lib/assessment/match.ts`. That one
 * scores, thresholds, applies registration/value/language filters, and returns
 * a ranked list. Here we only *count* the corpus the user is fishing in, framed
 * honestly as a corpus signal ("we're tracking N"), never a match promise. The
 * final assessment narrows this pond — so the teaser is always ≥ the personal
 * match count, which keeps it truthful and avoids the "teaser said 47, results
 * showed 12" trust break.
 *
 * Sector match = stored slug OR a compact, high-precision keyword hit on the
 * tender text (mirrors how the real matcher derives sector signal from
 * sector+title+description, since `tenders.sector` stores `sourceHint ?? slug`
 * and isn't a clean slug column). Geography = the user's selected countries
 * plus globally-open notices. Grants are counted sector-only (most are
 * multi-country) and surfaced under a softer "may be eligible" framing.
 */

export interface OpportunitySignal {
  /** Open tenders in the user's sector(s) + geography (incl. globally-open). */
  tenders: number;
  /** Distinct agencies represented in that pool. */
  agencies: number;
  /** Of those tenders, how many close within 30 days. */
  closingSoon: number;
  /** Open grants in the user's sector(s) they may be eligible for. */
  grants: number;
  /** Sector labels we could map to a known slug (echoed for the UI caption). */
  mappedSectors: string[];
}

// Compact, high-precision keyword sets per slug. Each term is used as a
// case-insensitive `%term%` ILIKE against `sector || title || description`.
// Tuned to avoid false-positive traps (e.g. bare "security" would swallow
// "food security"; bare "water" pulls noise — so we use phrases instead).
const SLUG_TEASER_KEYWORDS: Record<SectorSlug, string[]> = {
  it: ["software", "information technology", "ict", "computer", "network equipment", "digital platform", "data center", "system integration"],
  education: ["education", "training", "curriculum", "vocational", "e-learning", "capacity building", "scholarship"],
  healthcare: ["health", "medical", "hospital", "clinic", "pharmaceutic", "vaccine", "medicine", "laboratory"],
  logistics: ["logistic", "transport", "freight", "shipping", "warehous", "supply chain", "distribution", "fleet", "cargo", "customs", "supply and delivery"],
  construction: ["construction", "infrastructure", "civil works", "rehabilitation of", "road works", "building works"],
  consulting: ["consultancy", "advisory services", "technical assistance", "professional services", "feasibility study", "management consult"],
  monitoring_evaluation: ["monitoring and evaluation", "evaluation services", "impact assessment", "baseline study", "midline", "endline", "third-party monitoring"],
  food: ["food supply", "food assistance", "catering", "nutrition", "school feeding", "ready-to-use therapeutic"],
  security: ["security services", "security guard", "guarding", "surveillance", "safety and security", "security equipment"],
  language_services: ["translation", "interpretation", "language services", "transcription", "editorial services", "localization"],
  engineering: ["engineering", "mechanical", "electrical installation", "fabrication", "industrial equipment", "electromechanical"],
  environment: ["environmental", "climate", "waste management", "recycling", "pollution", "biodiversity", "reforestation"],
  agriculture: ["agricultur", "farming", "irrigation", "livestock", "rural development", "seeds", "fisheries", "agronom"],
  water_sanitation: ["water supply", "water and sanitation", "drinking water", "wastewater", "sanitation", "wash ", "hygiene", "borehole", "latrine", "sewer"],
  energy: ["renewable energy", "solar", "photovoltaic", "power supply", "power generation", "electrification", "energy efficiency"],
};

// Tenders posted globally / multi-country count toward every geography — they
// are biddable regardless of the user's country list.
const GLOBAL_COUNTRY_MARKERS = ["global", "worldwide", "multiple", "multi-country", "various", "international"];

function labelsToSlugs(labels: string[]): { slugs: SectorSlug[]; mapped: string[] } {
  const slugs = new Set<SectorSlug>();
  const mapped: string[] = [];
  for (const label of labels) {
    const slug = slugFromLabel(label);
    if (slug) {
      slugs.add(slug);
      mapped.push(label);
    }
  }
  return { slugs: [...slugs], mapped };
}

/**
 * Returns the opportunity signal for a sector/geography pair, or null when
 * there is nothing meaningful to show (no mappable sector, or the count is
 * zero / the query failed). Returning null keeps the wizard quiet rather than
 * flashing a discouraging "0 opportunities" — the UI only renders on signal.
 */
export async function getOpportunitySignal(
  sectorLabels: string[],
  countries: string[],
): Promise<OpportunitySignal | null> {
  const { slugs, mapped } = labelsToSlugs(sectorLabels);
  if (slugs.length === 0 || countries.length === 0) return null;

  const slugArr = slugs as string[];
  const keywordPatterns = [
    ...new Set(slugs.flatMap((s) => SLUG_TEASER_KEYWORDS[s])),
  ].map((term) => `%${term}%`);
  const countriesLower = countries.map((c) => c.trim().toLowerCase()).filter(Boolean);
  const geoMarkers = [...countriesLower, ...GLOBAL_COUNTRY_MARKERS];

  try {
    const [tenderRows, grantRows] = await Promise.all([
      sql`
        SELECT
          COUNT(*)::int AS tenders,
          COUNT(DISTINCT agency)::int AS agencies,
          COUNT(*) FILTER (
            WHERE deadline IS NOT NULL AND deadline <= CURRENT_DATE + 30
          )::int AS closing_soon
        FROM tenders
        WHERE status = 'open'
          AND (deadline IS NULL OR deadline >= CURRENT_DATE)
          AND source_url IS NOT NULL AND TRIM(source_url) <> ''
          AND LOWER(country) = ANY(${geoMarkers}::text[])
          AND (
            LOWER(COALESCE(sector, '')) = ANY(${slugArr}::text[])
            OR (COALESCE(sector, '') || ' ' || COALESCE(title, '') || ' ' || COALESCE(description, ''))
               ILIKE ANY(${keywordPatterns}::text[])
          )
      `,
      sql`
        SELECT COUNT(*)::int AS grants
        FROM grants
        WHERE status = 'open'
          AND (deadline IS NULL OR deadline >= NOW())
          AND (
            LOWER(COALESCE(sector, '')) = ANY(${slugArr}::text[])
            OR (COALESCE(sector, '') || ' ' || COALESCE(title, '') || ' ' || COALESCE(description, ''))
               ILIKE ANY(${keywordPatterns}::text[])
          )
      `,
    ]);

    const tenders = Number(tenderRows?.[0]?.tenders ?? 0);
    if (tenders <= 0) return null;

    return {
      tenders,
      agencies: Number(tenderRows?.[0]?.agencies ?? 0),
      closingSoon: Number(tenderRows?.[0]?.closing_soon ?? 0),
      grants: Number(grantRows?.[0]?.grants ?? 0),
      mappedSectors: mapped,
    };
  } catch (err) {
    // Fail quiet: the wizard simply doesn't show the strip. Never block intake.
    console.warn("[tp:assessment:opportunity_signal_failed]", {
      error: err instanceof Error ? err.message : String(err),
      sectors: mapped.length,
      countries: countriesLower.length,
    });
    return null;
  }
}
