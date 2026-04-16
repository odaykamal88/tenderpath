/**
 * OCDS (Open Contracting Data Standard) release → RawTender normalizer.
 * Used by TED EU, UK FTS, and any other OCDS-conformant feed.
 * Spec: https://standard.open-contracting.org/
 */
import type { RawTender } from "./types";

interface OCDSAmount {
  amount?: number;
  currency?: string;
}

interface OCDSPeriod {
  startDate?: string;
  endDate?: string;
}

interface OCDSAddress {
  countryName?: string;
  region?: string;
}

export interface OCDSRelease {
  ocid?: string;
  id?: string;
  language?: string;
  buyer?: { name?: string; address?: OCDSAddress };
  tender?: {
    id?: string;
    title?: string;
    description?: string;
    status?: string;
    procurementMethod?: string;
    mainProcurementCategory?: string;
    value?: OCDSAmount;
    tenderPeriod?: OCDSPeriod;
    items?: Array<{ classification?: { description?: string } }>;
    procuringEntity?: { name?: string };
    eligibilityCriteria?: string;
  };
}

const ISO_COUNTRY: Record<string, string> = {
  "United Kingdom": "GB", Kenya: "KE", Uganda: "UG", Tanzania: "TZ",
  Ethiopia: "ET", Rwanda: "RW", "South Sudan": "SS", Somalia: "SO",
  Nigeria: "NG", Ghana: "GH", "South Africa": "ZA", Egypt: "EG",
  India: "IN", Bangladesh: "BD", Pakistan: "PK", "United States": "US",
  Germany: "DE", France: "FR", Belgium: "BE", Netherlands: "NL",
};

export function ocdsToRawTender(
  release: OCDSRelease,
  opts: { sourcePrefix: string; sourceName: string; sourceTier: number; urlBuilder?: (release: OCDSRelease) => string | null },
): RawTender | null {
  const t = release.tender;
  if (!t?.title) return null;

  const refId = release.ocid || release.id || t.id;
  if (!refId) return null;

  const country = release.buyer?.address?.countryName ?? "Global";
  const sector = t.mainProcurementCategory
    ?? t.items?.[0]?.classification?.description
    ?? null;

  const value = t.value;
  const estimated = value?.amount
    ? `${value.currency ?? ""} ${value.amount.toLocaleString()}`.trim()
    : null;

  return {
    reference_id: `${opts.sourcePrefix}-${refId}`,
    title: t.title.slice(0, 500),
    description: t.description ?? null,
    agency: t.procuringEntity?.name ?? release.buyer?.name ?? opts.sourceName,
    country,
    country_code: ISO_COUNTRY[country] ?? null,
    region: release.buyer?.address?.region ?? null,
    sector,
    deadline: t.tenderPeriod?.endDate?.slice(0, 10) ?? null,
    estimated_value: estimated,
    source_url: opts.urlBuilder?.(release) ?? null,
    opportunity_type: mapMethod(t.procurementMethod),
    eligibility_summary: t.eligibilityCriteria ?? null,
    experience_level: null,
    submission_language: release.language === "fr" ? "French" : "English",
    source_tier: opts.sourceTier,
    source_name: opts.sourceName,
  };
}

function mapMethod(method?: string): string {
  if (!method) return "RFP";
  const m = method.toLowerCase();
  if (m.includes("open")) return "RFP";
  if (m.includes("limited") || m.includes("selective")) return "RFQ";
  if (m.includes("direct")) return "Direct Award";
  return "RFP";
}
