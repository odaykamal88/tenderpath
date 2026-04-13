# UN PROCUREMENT NAVIGATOR — MOAT & DEFENSE GUIDELINES

> **Directive to all agents in this swarm:** Read this document before building any feature. These principles are non-negotiable and apply to every workflow, component, and integration you build.

---

## Threat Model

AI cloning tools can replicate our public-facing portal, assessment forms, and pricing UI. The deeper threat in this market is that a procurement consulting firm with AI capability could build a similar frontend. **Our defense is the institutional knowledge layer, the tender data pipeline, the accumulated win/loss intelligence, and the network effects between vendors on the platform.**

---

## Principle 1: The Institutional Knowledge Base Is the Moat

- Our codified understanding of UN procurement — agency-specific evaluation criteria, roster requirements, procurement thresholds, filing formats, shortlist dynamics — is the core defensible asset.
- This knowledge base must be:
  - Stored as structured, machine-readable data on the backend
  - Never exposed in the frontend or in any client-accessible API response in raw form
  - Continuously updated from new tender documents, debrief data, and filing outcomes
- **The frontend displays recommendations. The backend contains the reasoning.** A cloner gets the recommendation UI with no institutional intelligence behind it.

## Principle 2: Tender Data Pipeline Is a Backend Asset

- The scraping, normalization, deduplication, and indexing of UN tenders across 40+ agencies is an invisible infrastructure investment.
- This pipeline must be:
  - Fully server-side with no client-side data fetching from source portals
  - Enriched with our proprietary metadata: win probability scores, competitive density estimates, category benchmarks
  - Historicized: retain all closed tenders and award data for benchmarking
- A competitor cloning the UI sees a list of tenders. They don't see the enrichment layer, the matching algorithm, or the historical dataset that powers our recommendations.

## Principle 3: Proposal Generation Logic Is Server-Side Only

- The AI agents that analyze TORs, generate technical proposals, build financial submissions, and assemble compliance packages are the highest-value features.
- All proposal generation must:
  - Run entirely on the backend
  - Use templates stored in our template library (not shipped to the browser)
  - Incorporate vendor-specific data from their stored profile
  - Be calibrated to agency-specific evaluation preferences learned from historical data
- **Test:** If someone clones every page, they get a proposal request form. The "Generate Proposal" button produces nothing without our backend engine, template library, and vendor data.

## Principle 4: Vendor Profiles Accumulate Value Over Time

- From the first interaction (readiness assessment), build a persistent vendor profile:
  - Company details, capabilities, past performance records, team CVs
  - UNSPSC code mapping and category alignment
  - Document vault (certifications, financial statements, compliance docs)
  - Submission history: every tender applied for, every proposal generated
  - Win/loss record with debrief data
- After 3-6 months on the platform, a vendor's profile is a comprehensive, submission-ready asset. Switching to a competitor means rebuilding from scratch and losing their submission history.

## Principle 5: Win/Loss Data Creates a Compounding Intelligence Advantage

- Every submission outcome — win, loss, shortlisted, disqualified — feeds back into the system.
- Track and learn from:
  - Which proposal structures win by agency and category
  - Which pricing ranges are competitive for different contract types
  - Which compliance gaps most frequently cause disqualification
  - Which roster applications get approved and why
- After 100 submissions, our system has pattern data no competitor can match without the same volume of real-world outcomes. **This is the flywheel: more vendors → more submissions → more outcome data → better proposals → higher win rates → more vendors.**

## Principle 6: Matching Algorithm Is Invisible and Proprietary

- The smart matching engine that scores vendor-tender fit is core IP.
- Matching criteria (UNSPSC overlap, geographic alignment, financial capacity fit, competitive density, win probability) must be computed server-side.
- The frontend shows a ranked list of opportunities with fit scores. It never reveals:
  - How fit scores are calculated
  - What weights each criterion carries
  - How win probability is estimated
  - What competitive density means algorithmically

## Principle 7: Commission Tracking Creates Relationship Lock-In

- Vendors who use our platform and win contracts have a financial relationship with us (success-based advisory fees).
- This creates a retention mechanism beyond product stickiness: they're in a commercial agreement that incentivizes continued use.
- Build the commission tracking and invoicing system as a first-class feature — it's both a revenue stream and a retention tool.

## Principle 8: Network Effects Between Vendors

- As the platform grows, build features that create vendor-to-vendor value:
  - Teaming/consortium matching: connect complementary vendors for joint bids
  - Anonymized benchmarking: show vendors how their readiness compares to others in their category
  - Referral program: vendors who win contracts refer others
- These network effects are impossible to replicate by cloning a URL. They require a critical mass of active users.

## Principle 9: Content and SEO as Distribution Moat

- Publish high-value content targeting procurement-adjacent search queries:
  - "How to register on UNGM" guides
  - Agency-specific procurement explainers
  - Roster registration walkthroughs
  - Tender alert digests and analysis
- Each published piece builds organic traffic that a clone must spend months/years to compete with.
- Gate the highest-value content (readiness assessment, proposal tools) behind registration.

## Principle 10: UNGM and Agency Portal Integrations

- Where possible, build direct integrations with UNGM registration, tender notification systems, and agency procurement portals.
- These integrations are:
  - Invisible to frontend cloners
  - Time-consuming to build and maintain
  - Subject to change (portal updates) which rewards the team that monitors actively
- Even basic UNGM profile auto-fill from our vendor database is a significant UX advantage that requires backend infrastructure.

## Principle 11: Grants Expansion — Broader TAM, Same Architecture

- Grants are a parallel opportunity type alongside tenders. The matching engine, readiness assessment, and application preparation workflows apply with minimal modification.
- Grants expand the addressable market from contract-capable vendors to NGOs, social enterprises, cooperatives, research institutions, and early-stage businesses — a 5-10x TAM multiplier.

### Grant Data Sources to Ingest

- UNDP Grants Portal (country programme grants, GEF Small Grants Programme)
- World Bank Trust Funds and country-level grant facilities
- Islamic Development Bank (IsDB) grant programmes — high MENA relevance, nobody aggregates these
- Arab Fund for Economic and Social Development (AFESD) — same, massively underserved
- African Development Bank grant windows
- EU External Action / EuropeAid grants
- Bilateral donors: USAID, GIZ, DFID/FCDO, SIDA, JICA, KOICA
- IFAD country programmes (agriculture/rural development)
- Regional funds: Arab Gulf Programme for Development (AGFUND), OPEC Fund (OFID)

### Assessment Modifications for Grants

- Add organization type to intake: NGO, SME, cooperative, research institution, government entity
- Add development theme tags: climate, gender, food security, digital inclusion, health, education, WASH, governance
- Adjust readiness scoring weights: grants emphasize impact methodology (30%), M&E frameworks (20%), past grant management experience (20%), organizational capacity (15%), financial controls (15%)
- Country-profile matching: surface only grants available in the user's target countries and relevant to their sector/theme combination

### Grant Application Preparation — Revenue Model

- Tier 1 ($99-149): Grant matching report with eligibility analysis and gap identification
- Tier 2 ($299-499): Full application package — concept note or proposal drafted by AI, logframe/results framework, budget template populated, compliance documents assembled
- Tier 3 ($499-999): Premium preparation with M&E framework design, theory of change narrative, and partnership mapping

### Moat Considerations Specific to Grants

- Grant success/failure data is even harder to obtain than tender outcomes — every data point we accumulate is defensible
- Donor preference patterns (what GIZ funds vs. what USAID funds vs. what IsDB funds) are institutional knowledge that improves with volume
- Bilingual Arabic/English grant applications are a massive differentiator — most MENA applicants struggle to write competitive proposals in English, and many Arab donors accept or prefer Arabic submissions
- The logframe and M&E generation engine is server-side only — this is specialized AI logic that a frontend clone cannot replicate

---

## Build Checklist — Apply to Every Feature

Before shipping any feature, verify:

- [ ] Core logic (matching, scoring, proposal generation, tender analysis) runs server-side only
- [ ] Feature adds data to the vendor's persistent profile
- [ ] Feature generates outcome data that improves the system over time
- [ ] Unauthenticated users see marketing content and readiness teaser, never full product
- [ ] Feature creates or deepens switching cost (submission history, document vault, win/loss data)
- [ ] Institutional knowledge is structured, backend-only, and continuously updated
- [ ] If cloned, the feature produces no value without our data pipeline, knowledge base, or vendor profiles
- [ ] Content is SEO-optimized for organic discovery in procurement-adjacent searches
