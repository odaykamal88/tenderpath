export type SourceCoverageStatus =
  | "direct-crawler"
  | "covered-by-ungm"
  | "covered-by-platform"
  | "disabled-intentionally"
  | "blocked"
  | "not-implemented";

export interface SourceCoverageEntry {
  label: string;
  canonicalPlatform: string;
  status: SourceCoverageStatus;
  notes: string;
}

export const SOURCE_COVERAGE: SourceCoverageEntry[] = [
  {
    label: "UNGM",
    canonicalPlatform: "UNGM",
    status: "direct-crawler",
    notes: "Canonical UN procurement hub; crawled through the browser worker.",
  },
  {
    label: "UNICEF",
    canonicalPlatform: "UNGM",
    status: "covered-by-ungm",
    notes: "UNICEF procurement is expected through UNGM agency coverage.",
  },
  {
    label: "WFP",
    canonicalPlatform: "UNGM",
    status: "covered-by-ungm",
    notes: "Direct WFP crawler remains disabled while UNGM coverage is the source of truth.",
  },
  {
    label: "WHO",
    canonicalPlatform: "UNGM",
    status: "covered-by-ungm",
    notes: "WHO procurement is expected through UNGM agency coverage.",
  },
  {
    label: "FAO",
    canonicalPlatform: "UNGM",
    status: "covered-by-ungm",
    notes: "FAO procurement is visible in current UNGM agency coverage and should be tracked explicitly.",
  },
  {
    label: "UNOPS",
    canonicalPlatform: "UNGM",
    status: "covered-by-ungm",
    notes: "UNOPS posts are expected through UNGM; standalone UNOPS crawler remains disabled to avoid duplicate/noisy coverage.",
  },
  {
    label: "UNHCR",
    canonicalPlatform: "UNGM",
    status: "covered-by-ungm",
    notes: "UNHCR procurement is visible through UNGM agency coverage.",
  },
  {
    label: "ILO",
    canonicalPlatform: "UNGM",
    status: "covered-by-ungm",
    notes: "ILO procurement is visible through UNGM agency coverage.",
  },
  {
    label: "UNFPA",
    canonicalPlatform: "UNGM",
    status: "covered-by-ungm",
    notes: "UNFPA procurement is visible through UNGM agency coverage.",
  },
  {
    label: "UNESCO",
    canonicalPlatform: "UNGM",
    status: "covered-by-ungm",
    notes: "UNESCO procurement is visible through UNGM agency coverage.",
  },
  {
    label: "UN-Women",
    canonicalPlatform: "UNGM",
    status: "covered-by-ungm",
    notes: "UN-Women procurement is visible through UNGM agency coverage.",
  },
  {
    label: "UNIDO",
    canonicalPlatform: "UNGM",
    status: "covered-by-ungm",
    notes: "UNIDO procurement is visible through UNGM agency coverage.",
  },
  {
    label: "IAEA",
    canonicalPlatform: "UNGM",
    status: "covered-by-ungm",
    notes: "IAEA procurement is visible through UNGM agency coverage.",
  },
  {
    label: "USAID/SAM.gov",
    canonicalPlatform: "SAM.gov",
    status: "covered-by-platform",
    notes: "USAID and successor/absorber notices are pulled through SAM.gov.",
  },
  {
    label: "EU",
    canonicalPlatform: "TED EU",
    status: "covered-by-platform",
    notes: "EU procurement notices are covered by TED EU.",
  },
  {
    label: "FCDO",
    canonicalPlatform: "UK Find a Tender",
    status: "covered-by-platform",
    notes: "FCDO notices are covered by UK Find a Tender when published there.",
  },
  {
    label: "UK Find a Tender",
    canonicalPlatform: "UK Find a Tender",
    status: "direct-crawler",
    notes: "OCDS API crawler is wired into scheduled sync.",
  },
  {
    label: "ADB",
    canonicalPlatform: "ADB",
    status: "blocked",
    notes: "Crawler exists but currently hits Cloudflare/worker failures; timeout capped to avoid burning cron budget.",
  },
  {
    label: "AfDB",
    canonicalPlatform: "AfDB",
    status: "blocked",
    notes: "Crawler exists but currently times out against protected documents listing; timeout capped to avoid burning cron budget.",
  },
  {
    label: "EBRD",
    canonicalPlatform: "EBRD",
    status: "blocked",
    notes: "ECEPP public notice list currently redirects to CAS login.",
  },
  {
    label: "KfW",
    canonicalPlatform: "KfW",
    status: "direct-crawler",
    notes: "GTAI/KfW crawler is implemented and live-smoke successful; source volume may be low and stale-sensitive.",
  },
];

const SOURCE_ALIAS_TO_CANONICAL = new Map(
  SOURCE_COVERAGE.map((entry) => [entry.label, entry.canonicalPlatform]),
);

export function canonicalCrawlerPlatform(sourceName: string | null | undefined): string | null {
  if (!sourceName) return null;
  return SOURCE_ALIAS_TO_CANONICAL.get(sourceName) ?? sourceName;
}
