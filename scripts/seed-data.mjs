#!/usr/bin/env node
/**
 * Seed tenders and grants into Neon for local testing.
 * Run: node scripts/seed-data.mjs
 */
import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required. Refusing to seed against a hardcoded database.");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

const tenders = [
  {
    reference_id: "UNGM-2026-KE-001",
    title: "Technical Assistance for Public Financial Management Reform in Kenya",
    description: "Seeking qualified firms to provide technical advisory services for PFM reform including budget transparency, procurement modernization, and audit capacity building.",
    agency: "World Bank",
    country: "Kenya",
    country_code: "KE",
    region: "East Africa",
    sector: "Consulting Services",
    deadline: "2026-06-15",
    estimated_value: "$500,000 - $1,200,000",
    source_url: "https://ungm.org/tenders/KE-001",
    status: "open",
    requirements: JSON.stringify(["UNGM registration", "ISO 9001", "5+ years PFM experience", "East Africa presence"]),
    source_tier: 1,
    source_name: "UNGM",
    opportunity_type: "RFP",
    experience_level: "senior",
  },
  {
    reference_id: "UNDP-2026-UG-015",
    title: "Governance and Institutional Strengthening Programme - Uganda",
    description: "Implementation partner needed for a 3-year governance strengthening programme covering local government capacity building, anti-corruption frameworks, and citizen engagement.",
    agency: "UNDP",
    country: "Uganda",
    country_code: "UG",
    region: "East Africa",
    sector: "Governance",
    deadline: "2026-07-01",
    estimated_value: "$2,000,000 - $5,000,000",
    source_url: "https://procurement-notices.undp.org/UG-015",
    status: "open",
    requirements: JSON.stringify(["UNGM registration", "Prior UNDP experience", "Governance expertise", "Local office in Uganda"]),
    source_tier: 1,
    source_name: "UNDP",
    opportunity_type: "RFP",
    experience_level: "senior",
  },
  {
    reference_id: "UNICEF-2026-TZ-008",
    title: "Child Protection Systems Strengthening in Tanzania",
    description: "Consultancy firm to support national child protection system assessment, policy development, and community-based protection mechanism strengthening.",
    agency: "UNICEF",
    country: "Tanzania",
    country_code: "TZ",
    region: "East Africa",
    sector: "Social Development",
    deadline: "2026-05-30",
    estimated_value: "$300,000 - $800,000",
    source_url: "https://supply.unicef.org/TZ-008",
    status: "open",
    requirements: JSON.stringify(["Child safeguarding policy", "Social protection experience", "Swahili language capacity"]),
    source_tier: 1,
    source_name: "UNICEF",
    opportunity_type: "RFP",
    experience_level: "mid",
  },
  {
    reference_id: "AfDB-2026-KE-042",
    title: "Infrastructure Project Management Consultancy - Nairobi Urban Transport",
    description: "Project management and supervision services for urban transport infrastructure development in Greater Nairobi Metropolitan Area.",
    agency: "AfDB",
    country: "Kenya",
    country_code: "KE",
    region: "East Africa",
    sector: "Infrastructure",
    deadline: "2026-08-15",
    estimated_value: "$1,500,000 - $3,000,000",
    source_url: "https://afdb.org/procurement/KE-042",
    status: "open",
    requirements: JSON.stringify(["Infrastructure management experience", "Engineering certifications", "Kenya operations"]),
    source_tier: 2,
    source_name: "AfDB",
    opportunity_type: "RFP",
    experience_level: "senior",
  },
  {
    reference_id: "WHO-2026-EA-003",
    title: "Health Systems Assessment and Policy Advisory - East Africa Regional",
    description: "Regional consultancy to conduct health systems performance assessments across 5 East African countries and develop policy recommendations for universal health coverage.",
    agency: "WHO",
    country: "Kenya",
    country_code: "KE",
    region: "East Africa",
    sector: "Health",
    deadline: "2026-06-30",
    estimated_value: "$400,000 - $900,000",
    source_url: "https://who.int/procurement/EA-003",
    status: "open",
    requirements: JSON.stringify(["Health systems expertise", "Regional East Africa experience", "WHO framework familiarity"]),
    source_tier: 1,
    source_name: "WHO",
    opportunity_type: "RFP",
    experience_level: "senior",
  },
  {
    reference_id: "EU-2026-UG-017",
    title: "Public Administration Reform Technical Assistance - Uganda",
    description: "Provision of long-term technical assistance to Uganda's Ministry of Public Service for civil service reform, digitalization of government services, and performance management systems.",
    agency: "EU Delegation",
    country: "Uganda",
    country_code: "UG",
    region: "East Africa",
    sector: "Public Administration",
    deadline: "2026-07-20",
    estimated_value: "$800,000 - $2,000,000",
    source_url: "https://eeas.europa.eu/delegations/UG-017",
    status: "open",
    requirements: JSON.stringify(["Public administration experience", "EU project management", "Digitalization expertise"]),
    source_tier: 2,
    source_name: "EU",
    opportunity_type: "RFP",
    experience_level: "senior",
  },
  {
    reference_id: "USAID-2026-KE-029",
    title: "Democracy, Human Rights, and Governance Activity - Kenya",
    description: "Implementation partner for a 5-year DHRG activity in Kenya focusing on civic participation, legislative strengthening, and anti-corruption.",
    agency: "USAID",
    country: "Kenya",
    country_code: "KE",
    region: "East Africa",
    sector: "Governance",
    deadline: "2026-09-01",
    estimated_value: "$5,000,000 - $15,000,000",
    source_url: "https://sam.gov/opp/KE-029",
    status: "open",
    requirements: JSON.stringify(["USAID experience", "Governance programming", "Kenya presence", "DUNS registration"]),
    source_tier: 1,
    source_name: "USAID/SAM.gov",
    opportunity_type: "RFA",
    experience_level: "senior",
  },
  {
    reference_id: "WFP-2026-TZ-011",
    title: "Supply Chain and Logistics Optimization Consultancy - Tanzania",
    description: "Consultancy to optimize WFP's supply chain and logistics operations in Tanzania, including warehouse management, transport routing, and last-mile delivery.",
    agency: "WFP",
    country: "Tanzania",
    country_code: "TZ",
    region: "East Africa",
    sector: "Logistics",
    deadline: "2026-06-20",
    estimated_value: "$200,000 - $500,000",
    source_url: "https://ungm.org/tenders/WFP-TZ-011",
    status: "open",
    requirements: JSON.stringify(["Supply chain expertise", "WFP/UN logistics experience", "Tanzania operations"]),
    source_tier: 1,
    source_name: "WFP",
    opportunity_type: "RFQ",
    experience_level: "mid",
  },
  {
    reference_id: "GIZ-2026-KE-055",
    title: "Climate Change Adaptation and Resilience Building - Arid Counties Kenya",
    description: "Technical consultancy for community-based climate adaptation interventions in Kenya's arid and semi-arid counties.",
    agency: "GIZ",
    country: "Kenya",
    country_code: "KE",
    region: "East Africa",
    sector: "Environment",
    deadline: "2026-07-10",
    estimated_value: "$600,000 - $1,500,000",
    source_url: "https://giz.de/procurement/KE-055",
    status: "open",
    requirements: JSON.stringify(["Climate adaptation experience", "Community engagement", "Kenya ASAL knowledge"]),
    source_tier: 2,
    source_name: "GIZ",
    opportunity_type: "RFP",
    experience_level: "mid",
  },
  {
    reference_id: "DFID-2026-EA-007",
    title: "Financial Management and Accountability Programme - East Africa",
    description: "Multi-country programme to strengthen public financial management, accountability mechanisms, and fiscal transparency across Kenya, Uganda, and Tanzania.",
    agency: "FCDO",
    country: "Kenya",
    country_code: "KE",
    region: "East Africa",
    sector: "Financial Management",
    deadline: "2026-08-01",
    estimated_value: "$3,000,000 - $8,000,000",
    source_url: "https://contractsfinder.service.gov.uk/EA-007",
    status: "open",
    requirements: JSON.stringify(["PFM expertise", "Multi-country East Africa", "FCDO experience", "Financial auditing capacity"]),
    source_tier: 1,
    source_name: "FCDO",
    opportunity_type: "RFP",
    experience_level: "senior",
  },
];

async function seed() {
  console.log("Seeding tenders...");
  for (const t of tenders) {
    await sql`
      INSERT INTO tenders (
        reference_id, title, description, agency, country, country_code,
        region, sector, deadline, estimated_value, source_url, status,
        requirements, source_tier, source_name, opportunity_type, experience_level
      ) VALUES (
        ${t.reference_id}, ${t.title}, ${t.description}, ${t.agency},
        ${t.country}, ${t.country_code}, ${t.region}, ${t.sector},
        ${t.deadline}, ${t.estimated_value}, ${t.source_url}, ${t.status},
        ${t.requirements}, ${t.source_tier}, ${t.source_name},
        ${t.opportunity_type}, ${t.experience_level}
      ) ON CONFLICT (reference_id) DO NOTHING
    `;
  }
  console.log(`  ✓ ${tenders.length} tenders seeded`);

  // No seed grants. Historical grants rows may remain in existing databases,
  // but grants.gov is no longer part of the active ingestion stack.

  // Verify
  const tc = await sql`SELECT count(*) as count FROM tenders`;
  const gc = await sql`SELECT count(*) as count FROM grants`;
  console.log(`\nDatabase totals: ${tc[0].count} tenders, ${gc[0].count} grants`);
}

seed().catch(console.error);
