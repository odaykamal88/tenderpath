/**
 * Static catalogue of agencies the user can self-submit to.
 *
 * Inclusion criteria: agency operates an open vendor portal where a vendor can
 * complete registration without TenderPath acting on their behalf. Agencies
 * that require a TenderPath staff submission, or whose registration is
 * embassy/in-person, are intentionally excluded from the launch list.
 */

export interface AgencyPackage {
  /** URL-safe identifier matching the user's roster selection. */
  slug: string;
  /** Display label (proper UN abbreviation). */
  label: string;
  /** Short rationale for why a vendor would register here. */
  why: string;
  /** Public portal name shown in the submission instructions PDF. */
  portalLabel: string;
  /** Public portal URL. */
  portalUrl: string;
  /** Ordered registration steps written from the vendor's perspective. */
  submissionSteps: string[];
  /** Documents the agency requires for vendor approval. */
  requiredDocuments: string[];
  /** Caveats and operational notes (rate limits, language, file size). */
  notes: string[];
  /** Suggested category/UNSPSC families to register against. */
  categoryHints: string[];
}

const UNGM: AgencyPackage = {
  slug: "ungm",
  label: "UNGM",
  why: "United Nations Global Marketplace — registration here is visible to ~30 UN agencies including WFP, UNICEF, UNDP, UNHCR, IOM, UNOPS, and others.",
  portalLabel: "UNGM (United Nations Global Marketplace)",
  portalUrl: "https://www.ungm.org/Account/Account/Register",
  submissionSteps: [
    "Create your UNGM account at https://www.ungm.org/Account/Account/Register using a company email address that you'll keep long-term.",
    "Complete the company-profile sections: contact information, ownership structure, financials (last 3 years), and references.",
    "Select UNSPSC product/service codes that match your offering. Be specific — UN buyers filter by exact codes.",
    "Upload required documents under the Documents tab using the filenames specified in the file-naming page of this package.",
    "Add your country and regional presence under Geographic Coverage. UN agencies match by exact country.",
    "Submit for verification. UNGM Level 1 is automatic; Level 2 (eligibility for higher-value tenders) requires an additional review.",
    "Once Level 1 is granted, enable email notifications for tender opportunities in your selected UNSPSC categories.",
  ],
  requiredDocuments: [
    "Certificate of incorporation",
    "Audited financial statements (last 3 years)",
    "Company profile / capability statement",
    "List of relevant projects and references",
    "Tax registration certificate",
    "ISO certifications (if applicable)",
    "Quality assurance policy",
    "Business continuity / risk management policy",
    "Code of conduct / anti-corruption policy",
    "Bank account details letter (on bank letterhead)",
  ],
  notes: [
    "UNGM is the single best return-on-effort registration for an SME vendor — one account exposes you to ~30 UN agencies.",
    "PDF uploads have a 5 MB per-file limit; combine smaller files into one PDF where it makes sense.",
    "Use the same legal company name on every document — UNGM matches across uploads.",
  ],
  categoryHints: [
    "Look up UNSPSC at https://www.unspsc.org and pick 3-8 specific codes",
    "Avoid overly broad codes — exact matches surface tenders, broad ones get filtered out",
  ],
};

const WFP: AgencyPackage = {
  slug: "wfp",
  label: "WFP",
  why: "World Food Programme — operates its own supplier database in parallel to UNGM for logistics, food, and humanitarian-response contracts.",
  portalLabel: "WFP Supplier Registration",
  portalUrl: "https://www.wfp.org/procurement",
  submissionSteps: [
    "Register on UNGM first (UNGM-registered vendors are visible to WFP automatically for most categories).",
    "For food-supply contracts, complete WFP's supplementary food-supplier registration via the WFP procurement portal.",
    "Submit Hazard Analysis Critical Control Point (HACCP) certificates and food-safety policies if you are a food vendor.",
    "For logistics or transport contracts, attach fleet capacity statements and previous humanitarian-response references.",
    "Confirm geographic coverage matches your fleet/warehouse footprint — WFP routes locally first.",
  ],
  requiredDocuments: [
    "UNGM Level 1 confirmation",
    "HACCP / ISO 22000 certificate (food vendors)",
    "Fleet capacity statement (logistics vendors)",
    "Insurance certificates",
    "References from prior humanitarian-response operations",
  ],
  notes: [
    "WFP procurement is dominated by emergency response — fast-turnaround capacity is more valuable than low price.",
    "Active CRMs in Rome (HQ) and country offices — register at both levels if you operate in a WFP country office.",
  ],
  categoryHints: [
    "Logistics, food, NFI, fleet, warehousing, fuel — typical WFP categories",
    "Avoid generic 'consulting' — WFP buys delivery, not advice",
  ],
};

const UNICEF: AgencyPackage = {
  slug: "unicef",
  label: "UNICEF",
  why: "United Nations Children's Fund — large procurement of NFI (non-food items), child-protection supplies, education materials, and WASH equipment.",
  portalLabel: "UNICEF Supply Division",
  portalUrl: "https://www.unicef.org/supply/working-with-unicef",
  submissionSteps: [
    "Register on UNGM (UNICEF imports UNGM-registered vendors automatically for most NFI categories).",
    "Complete the UNICEF Supply Division supplier-self-registration form.",
    "Submit product specifications and quality certifications for any catalogued items (e.g. school-in-a-box, vaccine carriers).",
    "Confirm geographic coverage and warehousing locations.",
    "Submit references from prior child-protection, education, or health contracts.",
  ],
  requiredDocuments: [
    "UNGM Level 1 confirmation",
    "Product specifications / technical data sheets",
    "Quality and safety certifications",
    "References from prior UNICEF or similar humanitarian contracts",
    "Child-protection policy",
  ],
  notes: [
    "UNICEF Supply Division (Copenhagen) handles global catalogue items; UNICEF country offices handle local procurement.",
    "Child-protection policy is mandatory across all UNICEF vendor relationships.",
  ],
  categoryHints: [
    "Education materials, WASH equipment, child-protection supplies, vaccine cold-chain, NFI",
  ],
};

const UNDP: AgencyPackage = {
  slug: "undp",
  label: "UNDP",
  why: "United Nations Development Programme — broad procurement across consulting, IT, construction, environment, and capacity building, with active country offices.",
  portalLabel: "UNDP eTendering",
  portalUrl: "https://procurement-notices.undp.org",
  submissionSteps: [
    "Register on UNGM (UNDP imports UNGM-registered vendors automatically).",
    "Create an account on the UNDP eTendering portal (separate from UNGM) at the URL above.",
    "Search and bookmark tenders by country office — UNDP country offices procure locally.",
    "Subscribe to notifications for the geographies and categories where you operate.",
    "Upload your company profile, capability statement, and references to UNDP eTendering for fast bid responses.",
  ],
  requiredDocuments: [
    "UNGM Level 1 confirmation",
    "Company profile / capability statement",
    "Audited financial statements",
    "References from prior development-sector contracts",
    "ISO certifications (if applicable)",
  ],
  notes: [
    "UNDP procurement is highly decentralised — each country office issues its own tenders. Register where you can deliver.",
    "Most UNDP tenders are RFPs or RFQs with a 2-3 week response window. Build your bid library early.",
  ],
  categoryHints: [
    "Consulting, governance, environment, IT, capacity building, M&E",
  ],
};

const IOM: AgencyPackage = {
  slug: "iom",
  label: "IOM",
  why: "International Organization for Migration — active procurement for accommodation, transport, NFI, and health-services in migration-response operations.",
  portalLabel: "IOM Procurement",
  portalUrl: "https://www.iom.int/procurement-opportunities",
  submissionSteps: [
    "Register on UNGM (IOM imports UNGM-registered vendors automatically).",
    "Identify the IOM country offices you operate in via the IOM website's mission list.",
    "Email each country office's procurement focal point with your capability statement and request to be added to their roster.",
    "Submit Long-Term Agreement (LTA) interest for accommodation, transport, or NFI categories if you have the capacity for repeat-business contracts.",
    "Subscribe to UNGM notifications for IOM tenders in your geographies.",
  ],
  requiredDocuments: [
    "UNGM Level 1 confirmation",
    "Company profile / capability statement",
    "References from prior migration-response or humanitarian work",
    "Insurance certificates",
    "Country-specific licensing (e.g. accommodation, transport)",
  ],
  notes: [
    "IOM operations are organised by mission (country office). Build relationships with the country-level procurement focal point — registration alone often isn't enough.",
    "LTAs are the most valuable IOM relationships — they convert one bid into 1-3 years of repeat work.",
  ],
  categoryHints: [
    "Accommodation, transport, NFI, health services, fleet, fuel, food",
  ],
};

const FAO: AgencyPackage = {
  slug: "fao",
  label: "FAO",
  why: "Food and Agriculture Organization — procurement is heavily relevant for food systems, agriculture, logistics, equipment, field services, and technical assistance suppliers.",
  portalLabel: "FAO Vendor Registration / UNGM",
  portalUrl: "https://www.fao.org/unfao/procurement/vendor-registration/vendorregistration/en",
  submissionSteps: [
    "Create or update your UNGM supplier account and complete Basic Registration.",
    "Under Coding, select UNSPSC codes that accurately describe your products or services.",
    "Under UN Organizations, select Food and Agriculture Organization of the United Nations (FAO) and submit your registration to FAO.",
    "Upload company profile, registration, financial, tax, quality, and relevant experience documents.",
    "For food, agriculture inputs, equipment, or field-service categories, attach product specifications, quality certificates, and delivery/geographic coverage evidence.",
    "Monitor FAO procurement notices and keep the UNGM profile current; registration does not guarantee invitation to tender.",
  ],
  requiredDocuments: [
    "UNGM Basic Registration confirmation with FAO selected",
    "Certificate of incorporation / business registration",
    "Tax registration certificate",
    "Audited financial statements or financial capacity evidence",
    "Company profile / capability statement",
    "Relevant product specifications or technical data sheets",
    "Quality certifications (e.g. ISO, HACCP, organic/food safety where relevant)",
    "Past performance references for agriculture, food systems, logistics, or field delivery",
    "UN Supplier Code of Conduct acknowledgement",
    "Anti-fraud / anti-corruption policy or signed declaration",
  ],
  notes: [
    "FAO's public vendor guidance says its vendor registration system is interfaced with UNGM and is the primary source used to identify vendors for invitations.",
    "FAO evaluates experience, ability to supply/perform, financial soundness, and relevance of offered goods or services.",
    "Classification matters: inaccurate UNSPSC/product coding can keep a relevant supplier invisible to FAO buyers.",
  ],
  categoryHints: [
    "Agriculture inputs, seeds, fertilizers, livestock, irrigation, food processing, rural infrastructure, agritech, technical assistance",
    "Add exact product and service codes; avoid only broad agriculture or consulting categories",
  ],
};

const UNOPS: AgencyPackage = {
  slug: "unops",
  label: "UNOPS",
  why: "United Nations Office for Project Services — major procurement implementer for infrastructure, engineering, health, vehicles, equipment, operations, and project services.",
  portalLabel: "UNOPS Supplier Resource Centre / UNGM",
  portalUrl: "https://www.unops.org/business-opportunities/supplier-resource-centre",
  submissionSteps: [
    "Register as a supplier on UNGM and complete your company profile, declarations, and UNSPSC coding.",
    "Use UNOPS Supplier Resource Centre guidance to align your profile with UNOPS procurement categories and eligibility expectations.",
    "Subscribe to UNGM tender alerts for UNOPS and the countries where you can deliver.",
    "Prepare technical evidence for infrastructure, engineering, procurement, logistics, health, or project-service categories as relevant.",
    "Keep financial, legal, and past-performance documents current so you can respond quickly when a UNOPS solicitation opens.",
  ],
  requiredDocuments: [
    "UNGM supplier registration confirmation",
    "Certificate of incorporation / business registration",
    "Tax registration certificate",
    "Audited financial statements or financial capacity evidence",
    "Company profile / capability statement",
    "Past performance references and completion certificates",
    "Quality, health, safety, and environmental policies where relevant",
    "Technical licenses, professional registrations, or manufacturer authorizations",
    "Insurance certificates for works/logistics where relevant",
    "UN Supplier Code of Conduct acknowledgement",
  ],
  notes: [
    "UNOPS uses UNGM and publishes supplier guidance through its Supplier Resource Centre.",
    "UNOPS work often has strong compliance, safety, and delivery-evidence requirements; do not rely on a generic company profile.",
    "For infrastructure and technical supply categories, past performance and licensing evidence are often decisive.",
  ],
  categoryHints: [
    "Infrastructure, engineering, construction supervision, health equipment, vehicles, project operations, procurement services, logistics",
    "Map categories to specific UNSPSC families and countries, not only global capability statements",
  ],
};

const WHO: AgencyPackage = {
  slug: "who",
  label: "WHO",
  why: "World Health Organization — relevant for health commodities, diagnostics, equipment, public-health services, research support, ICT, and country-office procurement.",
  portalLabel: "WHO Procurement / UNGM / WHO e-Tendering",
  portalUrl: "https://www.who.int/about/accountability/procurement/become-a-supplier",
  submissionSteps: [
    "Register on UNGM so WHO tender documentation and UNGM-published opportunities are accessible.",
    "Review WHO's supplier guidance and create the required account for WHO's electronic tendering process when a relevant tender requires it.",
    "Map your products/services to health-specific categories and the countries or regions where you can deliver.",
    "Prepare product registrations, quality certificates, technical specifications, and cold-chain or regulatory evidence where applicable.",
    "For local or regional supply, identify the relevant WHO regional/country office and monitor their procurement pages alongside UNGM.",
  ],
  requiredDocuments: [
    "UNGM supplier registration confirmation",
    "Certificate of incorporation / business registration",
    "Tax registration certificate",
    "Audited financial statements or financial capacity evidence",
    "Company profile / capability statement",
    "Product technical specifications / data sheets",
    "Quality and regulatory certifications (e.g. ISO, GMP, CE, WHO prequalification where applicable)",
    "Past performance references in health, public sector, donor, or emergency-response work",
    "Anti-corruption / code of conduct declaration",
    "Insurance or delivery-capacity evidence where relevant",
  ],
  notes: [
    "WHO public procurement guidance says suppliers interested in WHO tenders must register on UNGM to see tender documentation and participate.",
    "WHO procurement can happen at global, regional, and country-office levels; one registration workflow is not enough for every opportunity.",
    "Health products often require regulatory and quality evidence. Generic supplier registration does not replace product eligibility.",
  ],
  categoryHints: [
    "Medical equipment, diagnostics, laboratory supplies, health ICT, research support, emergency health logistics, public-health consulting",
    "Flag any WHO prequalification, GMP, ISO, CE, or national regulatory registrations explicitly",
  ],
};

export const AGENCY_PACKAGES: AgencyPackage[] = [UNGM, WFP, UNICEF, UNDP, IOM, FAO, UNOPS, WHO];

export function findAgencyPackage(slug: string | null | undefined): AgencyPackage | null {
  if (!slug) return null;
  const normalized = slug.trim().toLowerCase();
  return AGENCY_PACKAGES.find((a) => a.slug === normalized) ?? null;
}

/**
 * Infer the agency slug from a free-form `target_agency` intake string.
 * Returns null if no high-confidence match.
 */
export function inferAgencySlug(targetAgency: string | null | undefined): string | null {
  if (!targetAgency) return null;
  const t = targetAgency.toLowerCase();
  if (/(ungm|global marketplace)/.test(t)) return "ungm";
  if (/(\bwfp\b|world food)/.test(t)) return "wfp";
  if (/(unicef)/.test(t)) return "unicef";
  if (/(undp|development programme)/.test(t)) return "undp";
  if (/(\biom\b|migration)/.test(t)) return "iom";
  if (/(\bfao\b|food and agriculture)/.test(t)) return "fao";
  if (/(unops|project services)/.test(t)) return "unops";
  if (/(\bwho\b|world health)/.test(t)) return "who";
  return null;
}
