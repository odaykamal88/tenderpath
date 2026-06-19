/* Agency + facet harmonization for the tender filter UIs (admin matching +
 * dashboard browse).
 *
 * Stored `tenders.agency` is free text that varies by crawler — "AFD",
 * "AFD (France)", "AFD - Agence française de développement"; "UNDP" vs
 * "UN Development Programme (UNDP)". Left raw, the country/agency filters show a
 * dozen near-duplicate rows for the same organisation. This collapses the common
 * multilateral / IFI / bilateral-donor variants to one canonical label so the
 * filter shows one row per agency, while a selected canonical label still
 * resolves back to *every* raw variant present in the DB (via `canonicalToRaws`)
 * so the SQL predicate stays exact. Long-tail agencies fall back to a cleaned
 * raw value (decoded entities, trimmed, whitespace-collapsed, case-deduped).
 *
 * Seeded from the funder→agency table in `developmentaid-npo.ts`. Kept
 * deliberately separate from that ingest-time mapping: this operates on
 * already-stored values for display/filtering, so coupling it to crawl logic
 * would risk one breaking the other. Conservative by design — when in doubt it
 * leaves the value alone rather than risk merging two distinct agencies. */
import { decodeHtmlEntities } from "@/lib/text/entities";

// First match wins, so order from most-specific to most-generic where a string
// could plausibly hit two rows. Acronyms are matched on word boundaries.
const AGENCY_ALIASES: { canonical: string; re: RegExp }[] = [
  // UN system
  { canonical: "UN Development Programme (UNDP)", re: /\bUNDP\b|united nations development programme/i },
  { canonical: "UN Children's Fund (UNICEF)", re: /\bUNICEF\b/i },
  { canonical: "UN Refugee Agency (UNHCR)", re: /\bUNHCR\b|high commissioner for refugees/i },
  { canonical: "UN Relief and Works Agency (UNRWA)", re: /\bUNRWA\b/i },
  { canonical: "UN Office for Project Services (UNOPS)", re: /\bUNOPS\b/i },
  { canonical: "UN Population Fund (UNFPA)", re: /\bUNFPA\b/i },
  { canonical: "UN-Habitat", re: /\bUN[- ]?HABITAT\b/i },
  { canonical: "UN Women", re: /\bUN[ ]?WOMEN\b/i },
  { canonical: "UNESCO", re: /\bUNESCO\b/i },
  { canonical: "UN Industrial Development Organization (UNIDO)", re: /\bUNIDO\b/i },
  { canonical: "UN Environment Programme (UNEP)", re: /\bUNEP\b/i },
  { canonical: "UN Office on Drugs and Crime (UNODC)", re: /\bUNODC\b/i },
  { canonical: "UN Office for Humanitarian Affairs (OCHA)", re: /\bOCHA\b/i },
  { canonical: "UN Volunteers (UNV)", re: /\bUNV\b/i },
  { canonical: "World Food Programme (WFP)", re: /\bWFP\b|world food programme/i },
  { canonical: "World Health Organization (WHO)", re: /\bWHO\b|world health organization/i },
  { canonical: "Food and Agriculture Organization (FAO)", re: /\bFAO\b|food and agriculture organization/i },
  { canonical: "International Labour Organization (ILO)", re: /\bILO\b/i },
  { canonical: "International Fund for Agricultural Development (IFAD)", re: /\bIFAD\b/i },
  { canonical: "International Organization for Migration (IOM)", re: /\bIOM\b/i },
  // Red Cross / Red Crescent
  { canonical: "International Federation of Red Cross (IFRC)", re: /\bIFRC\b/i },
  { canonical: "International Committee of the Red Cross (ICRC)", re: /\bICRC\b/i },
  // IFIs / development banks
  { canonical: "World Bank", re: /\bworld bank\b/i },
  { canonical: "Asian Development Bank (ADB)", re: /\basian development bank\b|\bADB\b/i },
  { canonical: "African Development Bank (AfDB)", re: /\bafrican development bank\b|\bAfDB\b/i },
  { canonical: "European Bank for Reconstruction & Development (EBRD)", re: /\bEBRD\b|european bank for reconstruction/i },
  { canonical: "Islamic Development Bank (IsDB)", re: /\bIsDB\b|islamic development bank/i },
  { canonical: "Inter-American Development Bank (IDB)", re: /\binter-?american development bank\b/i },
  // Bilateral donors / agencies
  { canonical: "European Union", re: /\beuropean union\b|\bECHO\b|europeaid/i },
  { canonical: "USAID", re: /\bUSAID\b/i },
  { canonical: "GIZ", re: /\bGIZ\b/i },
  { canonical: "KfW Development Bank", re: /\bKfW\b/i },
  { canonical: "AFD (France)", re: /\bAFD\b|agence fran[çc]aise de d[ée]veloppement/i },
  { canonical: "Sida (Sweden)", re: /\bSIDA\b/i },
  { canonical: "FCDO (UK)", re: /\bFCDO\b|\bDFID\b/i },
  { canonical: "Austrian Development Agency (ADA)", re: /\bADA\b|austrian development agency/i },
  { canonical: "Norwegian Refugee Council (NRC)", re: /\bNRC\b|norwegian refugee council/i },
  { canonical: "Japan International Cooperation Agency (JICA)", re: /\bJICA\b/i },
  // Global health funds
  { canonical: "Gavi", re: /\bGAVI\b/i },
  { canonical: "The Global Fund", re: /\bglobal fund\b/i },
];

/** Clean a raw stored value for display: decode entities, collapse whitespace. */
function cleanLabel(raw: string | null | undefined): string {
  return decodeHtmlEntities(raw ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Canonical display label for a stored agency value: a curated alias when the
 * value matches a known organisation, else the cleaned raw value. `null` only
 * for empty input.
 */
export function canonicalAgency(raw: string | null | undefined): string | null {
  const cleaned = cleanLabel(raw);
  if (!cleaned) return null;
  for (const a of AGENCY_ALIASES) {
    if (a.re.test(cleaned)) return a.canonical;
  }
  return cleaned;
}

/**
 * Collapse a DISTINCT agency column into a harmonized suggestion list plus a
 * map from each canonical label back to the *raw* stored values that feed it —
 * so a filter on a canonical label can `WHERE t.agency = ANY(rawValues)` and
 * still match every variant.
 */
export function buildAgencyHarmonization(rawValues: Array<string | null>): {
  labels: string[];
  canonicalToRaws: Map<string, string[]>;
} {
  const canonicalToRaws = new Map<string, string[]>();
  for (const raw of rawValues) {
    if (!raw || !raw.trim()) continue;
    const label = canonicalAgency(raw);
    if (!label) continue;
    const arr = canonicalToRaws.get(label) ?? [];
    // Store the untouched DB value so the ANY() predicate matches exactly.
    if (!arr.includes(raw)) arr.push(raw);
    canonicalToRaws.set(label, arr);
  }
  const labels = [...canonicalToRaws.keys()].sort((a, b) => a.localeCompare(b));
  return { labels, canonicalToRaws };
}

/**
 * Resolve a requested agency filter value to the raw DB values it should match.
 * Returns the raw set when the request equals a known canonical label
 * (case-insensitive); `null` when it's free-typed text the caller should treat
 * as a partial ILIKE instead.
 */
export function resolveAgencyRaws(
  requested: string,
  canonicalToRaws: Map<string, string[]>,
): string[] | null {
  const want = requested.trim().toLowerCase();
  if (!want) return null;
  for (const [label, raws] of canonicalToRaws) {
    if (label.toLowerCase() === want) return raws;
  }
  return null;
}

/**
 * Generic facet harmonizer for plain text columns (country, sector): decode
 * entities, collapse whitespace, de-duplicate case-insensitively (keeping the
 * first-seen casing), and sort. `dropCoded` removes JSON-blob / numeric-code
 * values that are unreadable as type-in suggestions (those rows stay reachable
 * via partial ILIKE).
 */
export function harmonizeFacetValues(
  values: Array<string | null>,
  opts: { dropCoded?: boolean } = {},
): string[] {
  const seen = new Map<string, string>();
  for (const raw of values) {
    const v = cleanLabel(raw);
    if (!v) continue;
    if (opts.dropCoded && (/^[[{]/.test(v) || /sector_(code|description)/i.test(v) || /^[\d\s,.\-]+$/.test(v))) {
      continue;
    }
    const key = v.toLowerCase();
    if (!seen.has(key)) seen.set(key, v);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}
