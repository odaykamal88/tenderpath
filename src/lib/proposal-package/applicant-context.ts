/**
 * applicant-context.ts — synthetic applicant context for Sprint 2 acceptance.
 *
 * Sprint 5 (evidence carry-forward) replaces this with a real lookup against
 * the applicant evidence library. For Sprint 2 we need a stable, plausible
 * UN supplier that can be scored against both UNICEF (services RFP) and
 * UNOPS (goods RFQ) fixtures — same company, two different procurement modes.
 *
 * Keep the data realistic enough that the LLM's per-criterion scoring and
 * disqualifier detection produce useful signal, but DO NOT add fields the
 * draft generator / scorer doesn't read — every key here is consumed in
 * draft-generator.ts and rubric-scorer.ts.
 */

export interface ApplicantContext {
  companyName: string;
  countryOfRegistration: string;
  unSupplierRegistration?: { vendorNumber: string; agencies: string[] };
  yearsOfExperience: number;
  sectorsCovered: string[];
  keyPersonnel: Array<{
    name: string;
    role: string;
    yearsExperience: number;
    sectors?: string[];
  }>;
  pastPerformance: Array<{
    client: string;
    project: string;
    year: number;
    value?: string;
    sector?: string;
  }>;
  certifications: string[];
  geographicReach: string[];
  capabilityNarrative?: string;
  languages?: string[];
  meetsUnSupplierBaseline?: boolean;
}

/**
 * Single synthetic applicant that plausibly fits BOTH fixtures:
 *   - UNICEF services LTA for oxygen plant repair + biomedical engineering
 *     (Atlas has biomedical engineering past performance + a Lead Biomedical
 *     Engineer + ISO 13485 + AirSep/NOVAIR/Atlas Copco authorization)
 *   - UNOPS goods RFQ for HDPE/GI pipes (Atlas has a water-infrastructure
 *     line, BS EN 10242 conformance, prior pipe supply to UNDP/ICRC)
 *
 * The dual-track narrative lets us demonstrate the scoring engine on two
 * methodologies (cumulative + lowest_compliant) with one applicant.
 */
export const DEMO_APPLICANT: ApplicantContext = {
  companyName: "Atlas Procurement & Engineering Services",
  countryOfRegistration: "Kenya",
  unSupplierRegistration: {
    vendorNumber: "UN-EAST-AFRICA-12345",
    agencies: ["UNGM", "UNICEF", "UNHCR", "WHO", "WFP"],
  },
  yearsOfExperience: 11,
  sectorsCovered: [
    "Biomedical engineering services (oxygen plants, sterilizers, X-ray, dialysis)",
    "Water and sanitation infrastructure (HDPE/GI pipes, valves, fittings)",
    "Procurement of medical and water-system equipment",
  ],
  keyPersonnel: [
    {
      name: "Dr. Asha Mwangi",
      role: "Lead Biomedical Engineer",
      yearsExperience: 14,
      sectors: ["oxygen plant repair", "biomedical equipment maintenance"],
    },
    {
      name: "Eng. Kofi Annan-Boateng",
      role: "Water Infrastructure Engineer",
      yearsExperience: 12,
      sectors: ["HDPE / GI pipe systems", "valve commissioning"],
    },
    {
      name: "Ms. Fatima Diallo",
      role: "Procurement & Compliance Lead",
      yearsExperience: 9,
      sectors: ["UN procurement compliance", "supplier registration"],
    },
  ],
  pastPerformance: [
    {
      client: "WHO Africa Region",
      project: "Maintenance LTA — 8 PSA oxygen plants across Kenya/Uganda/Tanzania",
      year: 2024,
      value: "USD 480,000",
      sector: "biomedical",
    },
    {
      client: "UNICEF Yemen",
      project: "Repair of 4 oxygen generation plants in Sana'a and Aden",
      year: 2023,
      value: "USD 312,000",
      sector: "biomedical",
    },
    {
      client: "UNDP Somalia",
      project: "Supply of HDPE pipes to Mogadishu water authority",
      year: 2024,
      value: "USD 220,000",
      sector: "water",
    },
    {
      client: "ICRC Sudan",
      project: "Supply of GI pipes and fittings for emergency water response",
      year: 2023,
      value: "USD 145,000",
      sector: "water",
    },
    {
      client: "MSF Democratic Republic of Congo",
      project: "Biomedical equipment maintenance, 12 health centers",
      year: 2022,
      value: "USD 95,000",
      sector: "biomedical",
    },
  ],
  certifications: [
    "ISO 9001:2015 (quality management)",
    "ISO 13485:2016 (medical devices)",
    "BS EN 10242 conformance assessment (GI fittings, threaded malleable iron)",
    "Authorized service provider for AirSep, NOVAIR, and Atlas Copco oxygen plants",
  ],
  geographicReach: [
    "East Africa (Kenya, Uganda, Tanzania, Rwanda) — full presence with local engineers",
    "Horn of Africa (Somalia, Ethiopia) — through long-standing local partners",
    "Sahel and West Africa (Mali, Burkina Faso, Niger) — project-by-project mobilization",
    "Middle East (Yemen, Sudan) — emergency-response biomedical capability via UNICEF Yemen LTA",
  ],
  capabilityNarrative:
    "Atlas operates as a dual-track supplier: a biomedical engineering services line that does oxygen-plant repair, sterilizer maintenance, and X-ray servicing under UN long-term arrangements; and a water-infrastructure supply line that delivers HDPE/GI piping and fittings to humanitarian water projects. Our biomedical line has handled multi-country LTAs for WHO and UNICEF; our water line ships within 90 days of contract signing and meets BS EN 10242 / equivalent specifications.",
  languages: ["English (working)", "Swahili (native)", "French (working)", "Arabic (intermediate)"],
  meetsUnSupplierBaseline: true,
};

/** Format an applicant as a prose block the LLM can consume in a prompt. */
export function formatApplicantForPrompt(a: ApplicantContext): string {
  const lines: string[] = [];
  lines.push(`Company: ${a.companyName}`);
  lines.push(`Registered in: ${a.countryOfRegistration}`);
  if (a.unSupplierRegistration) {
    lines.push(
      `UN supplier registration: vendor # ${a.unSupplierRegistration.vendorNumber} (active on ${a.unSupplierRegistration.agencies.join(", ")})`,
    );
  }
  lines.push(`Years of operation: ${a.yearsOfExperience}`);
  lines.push(`Sectors covered:`);
  for (const s of a.sectorsCovered) lines.push(`  • ${s}`);
  lines.push(`Key personnel:`);
  for (const p of a.keyPersonnel) {
    const sectors = p.sectors && p.sectors.length > 0 ? ` — focus: ${p.sectors.join(", ")}` : "";
    lines.push(`  • ${p.name}, ${p.role} (${p.yearsExperience}y)${sectors}`);
  }
  lines.push(`Past performance (relevant):`);
  for (const pp of a.pastPerformance) {
    const value = pp.value ? `, ${pp.value}` : "";
    const sector = pp.sector ? ` [${pp.sector}]` : "";
    lines.push(`  • ${pp.year} — ${pp.client}: ${pp.project}${value}${sector}`);
  }
  lines.push(`Certifications:`);
  for (const c of a.certifications) lines.push(`  • ${c}`);
  lines.push(`Geographic reach:`);
  for (const g of a.geographicReach) lines.push(`  • ${g}`);
  if (a.capabilityNarrative) {
    lines.push(`Capability narrative: ${a.capabilityNarrative}`);
  }
  if (a.languages && a.languages.length > 0) {
    lines.push(`Languages: ${a.languages.join("; ")}`);
  }
  if (a.meetsUnSupplierBaseline) {
    lines.push(`UN supplier baseline: claims compliance (non-bankrupt, no UN sanctions, no conflict of interest)`);
  }
  return lines.join("\n");
}
