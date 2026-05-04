import { normalizeSector, type SectorSlug } from "@/lib/crawlers/sector-map";

export type GrantsGovDetailPatch = {
  description: string | null;
  sector: SectorSlug | null;
  themes: string[];
  eligible_org_types: string[];
  value_range: string | null;
  deadline: string | null;
  reasons: string[];
};

type GrantsGovRef = {
  source_url?: string | null;
  reference_id?: string | null;
  title?: string | null;
};

type GrantsGovApplicantType = {
  description?: string | null;
};

type GrantsGovCategory = {
  description?: string | null;
};

type GrantsGovNotice = {
  synopsisDesc?: string | null;
  forecastDesc?: string | null;
  responseDateStr?: string | null;
  responseDate?: string | null;
  estimatedFundingFormatted?: string | null;
  awardCeilingFormatted?: string | null;
  awardFloorFormatted?: string | null;
  estimatedFunding?: string | null;
  awardCeiling?: string | null;
  awardFloor?: string | null;
  applicantTypes?: GrantsGovApplicantType[];
  applicantEligibilityDesc?: string | null;
  fundingActivityCategories?: GrantsGovCategory[];
  fundingInstruments?: GrantsGovCategory[];
};

type GrantsGovDetail = {
  id?: number;
  opportunityNumber?: string;
  opportunityTitle?: string;
  synopsis?: GrantsGovNotice;
  forecast?: GrantsGovNotice;
};

const DETAIL_ENDPOINT = "https://apply07.grants.gov/grantsws/rest/opportunity/details";

const THEME_BY_CATEGORY: Record<string, string[]> = {
  agriculture: ["agriculture", "food security", "rural development"],
  "community development": ["civil society", "livelihoods", "resilience"],
  education: ["education", "training", "youth"],
  employment: ["livelihoods", "workforce", "skills"],
  environment: ["environment", "climate", "natural resources"],
  "food and nutrition": ["food security", "nutrition", "health"],
  health: ["health", "public health", "medical"],
  humanities: ["education", "civil society"],
  "income security": ["livelihoods", "social protection"],
  "information and statistics": ["data", "digital", "governance"],
  "law, justice and legal services": ["rule of law", "governance", "security"],
  "natural resources": ["environment", "biodiversity", "natural resources"],
  "regional development": ["regional development", "infrastructure", "resilience"],
  science: ["research", "innovation", "technology"],
  "science and technology": ["research", "innovation", "technology"],
};

function compact(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function stripHtml(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function grantsGovOppId(ref: GrantsGovRef): string | null {
  const fromUrl = ref.source_url?.match(/search-results-detail\/(\d+)/i)?.[1];
  if (fromUrl) return fromUrl;
  const fromRef = ref.reference_id?.match(/GRANTS_GOV:(\d+)/i)?.[1];
  return fromRef ?? null;
}

function dateFromResponse(value: string | null | undefined): string | null {
  if (!value) return null;
  const isoish = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoish) return `${isoish[1]}-${isoish[2]}-${isoish[3]}`;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function applicantOrgTypes(applicantTypes: GrantsGovApplicantType[] = [], eligibility = ""): string[] {
  const text = `${applicantTypes.map((a) => a.description ?? "").join(" ")} ${eligibility}`.toLowerCase();
  const out: string[] = [];
  if (/\b(nonprofits?|non-profit|ngo|community based|community-based|civil society|foundation|charit)/.test(text)) out.push("NGO");
  if (/\b(for profit|small business|business|commercial|private sector|sme)\b/.test(text)) out.push("company");
  if (/\b(universit|institution of higher education|college|school|academic|research)\b/.test(text)) {
    out.push("education_institution", "research_institution");
  }
  if (/\b(state|county|city|township|special district|government|tribal|municipal|public housing|sea\b|educational agenc)/.test(text)) {
    out.push("government_entity");
  }
  if (/\b(cooperative|co-op)\b/.test(text)) out.push("cooperative");
  return compact(out);
}

function themesFromCategories(categories: GrantsGovCategory[] = []): string[] {
  const out: string[] = [];
  for (const category of categories) {
    const key = category.description?.toLowerCase().trim();
    if (!key) continue;
    if (category.description) out.push(category.description);
    out.push(...(THEME_BY_CATEGORY[key] ?? []));
  }
  return compact(out);
}

function valueRange(notice: GrantsGovNotice): string | null {
  const ceiling = notice.awardCeilingFormatted ?? notice.awardCeiling;
  const floor = notice.awardFloorFormatted ?? notice.awardFloor;
  const total = notice.estimatedFundingFormatted ?? notice.estimatedFunding;
  if (ceiling && ceiling.toLowerCase() !== "none" && floor && floor.toLowerCase() !== "none") {
    return `$${floor}-$${ceiling}`;
  }
  if (ceiling && ceiling.toLowerCase() !== "none") return `Up to $${ceiling}`;
  if (total && total.toLowerCase() !== "none") return `Total funding $${total}`;
  return null;
}

function isAlumniPublicDiplomacy(detail: GrantsGovDetail, notice: GrantsGovNotice): boolean {
  const text = `${detail.opportunityTitle ?? ""} ${detail.opportunityNumber ?? ""} ${notice.synopsisDesc ?? ""} ${notice.forecastDesc ?? ""}`;
  return /\b(alumni engagement innovation fund|aeif)\b/i.test(text);
}

export async function fetchGrantsGovDetail(oppId: string): Promise<GrantsGovDetail> {
  const body = new URLSearchParams();
  body.set("oppId", oppId);
  const response = await fetch(DETAIL_ENDPOINT, {
    method: "POST",
    body,
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": "Tenderpath grant metadata enrichment (+https://tenderpath.me)",
    },
  });
  if (!response.ok) {
    throw new Error(`Grants.gov detail ${oppId} failed: HTTP ${response.status}`);
  }
  return await response.json() as GrantsGovDetail;
}

export function grantsGovDetailPatch(detail: GrantsGovDetail): GrantsGovDetailPatch {
  const notice = detail.synopsis ?? detail.forecast ?? {};
  const alumniPublicDiplomacy = isAlumniPublicDiplomacy(detail, notice);
  const rawDescription = notice.synopsisDesc ?? notice.forecastDesc ?? null;
  const description = stripHtml(rawDescription);
  const eligibility = stripHtml(notice.applicantEligibilityDesc);
  const categoryText = (notice.fundingActivityCategories ?? [])
    .map((category) => category.description ?? "")
    .join(" ");
  const themes = alumniPublicDiplomacy
    ? ["education", "training", "youth", "capacity building", "civil society"]
    : themesFromCategories(notice.fundingActivityCategories);
  const eligibleOrgTypes = alumniPublicDiplomacy
    ? compact([...applicantOrgTypes(notice.applicantTypes, eligibility), "NGO", "education_institution", "research_institution"])
    : applicantOrgTypes(notice.applicantTypes, eligibility);
  const sector = alumniPublicDiplomacy
    ? "education"
    : normalizeSector(categoryText, detail.opportunityTitle ?? "", description)[0] ?? null;
  const deadline = dateFromResponse(notice.responseDateStr ?? notice.responseDate);
  const reasons = compact([
    description.length >= 80 ? "description from Grants.gov synopsis/forecast" : null,
    sector ? "sector from Grants.gov funding category/detail" : null,
    themes.length ? "themes from Grants.gov funding activity categories" : null,
    eligibleOrgTypes.length ? "eligible org types from Grants.gov applicant types/eligibility text" : null,
    valueRange(notice) ? "value range from Grants.gov funding amounts" : null,
    deadline ? "deadline from Grants.gov response date" : null,
    alumniPublicDiplomacy ? "alumni/public-diplomacy grant pattern" : null,
  ]);

  return {
    description: description.length >= 80 ? description : null,
    sector,
    themes,
    eligible_org_types: eligibleOrgTypes,
    value_range: valueRange(notice),
    deadline,
    reasons,
  };
}
