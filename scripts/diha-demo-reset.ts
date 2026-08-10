/**
 * Reset the private DIHA walkthrough tenant against the configured database.
 *
 * Safe defaults:
 *   - dry-run unless --apply is present
 *   - refuses the public demo account
 *   - refuses to adopt an existing unmarked account
 *   - every destructive query is scoped to the confirmed fixture owner
 *   - password is supplied only through DIHA_DEMO_PASSWORD
 *
 * Production reset:
 *   DIHA_DEMO_EMAIL=... DIHA_DEMO_PASSWORD=... npm run demo:diha:reset -- \
 *     --apply --confirm-email=...
 */

import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { loadEnvConfig } from "@next/env";
import { parse } from "dotenv";
import { sql } from "../src/lib/db";
import { hashPassword } from "../src/lib/password";

loadEnvConfig(process.cwd());

const rawArgs = process.argv.slice(2);
const credentialFileArg = rawArgs
  .find((arg) => arg.startsWith("--credentials="))
  ?.slice("--credentials=".length);
const generateCredentials = rawArgs.includes("--generate-credentials");

if (credentialFileArg) {
  const credentialPath = resolve(process.cwd(), credentialFileArg);
  const filename = basename(credentialPath);
  if (!filename.startsWith(".env.") || !filename.endsWith(".local")) {
    throw new Error("Credential file must be an ignored .env.*.local file");
  }

  if (generateCredentials && !existsSync(credentialPath)) {
    const generatedPassword = randomBytes(24).toString("base64url");
    writeFileSync(
      credentialPath,
      `DIHA_DEMO_EMAIL=diha-walkthrough@tenderpath.me\nDIHA_DEMO_PASSWORD=${generatedPassword}\n`,
      { encoding: "utf8", mode: 0o600, flag: "wx" },
    );
  }

  if (!existsSync(credentialPath)) {
    throw new Error(`Credential file not found: ${credentialPath}`);
  }
  chmodSync(credentialPath, 0o600);
  Object.assign(process.env, parse(readFileSync(credentialPath)));
}

const FIXTURE_MARKER = "tenderpath-diha-walkthrough-v1";
const PUBLIC_DEMO_EMAIL = "demo@tenderpath.me";
const DEFAULT_EMAIL = "diha-walkthrough@tenderpath.me";
const COMPANY_NAME = "Asteria Development Systems";

type TenderRow = {
  id: number;
  reference_id: string | null;
  title: string;
  agency: string;
  country: string | null;
  sector: string | null;
  deadline: string;
  estimated_value: string | null;
  source_url: string;
  source_name: string;
  opportunity_type: string | null;
};

const args = new Set(rawArgs);
const apply = args.has("--apply");
const email = (process.env.DIHA_DEMO_EMAIL ?? DEFAULT_EMAIL).trim().toLowerCase();
const confirmEmail = process.argv
  .find((arg) => arg.startsWith("--confirm-email="))
  ?.slice("--confirm-email=".length)
  .trim()
  .toLowerCase();
const password = process.env.DIHA_DEMO_PASSWORD ?? "";

function assertSafeInputs(): void {
  if (!/^[-a-z0-9.+_]+@[-a-z0-9.]+\.[a-z]{2,}$/i.test(email)) {
    throw new Error("DIHA_DEMO_EMAIL must be a valid email address");
  }
  if (email === PUBLIC_DEMO_EMAIL) {
    throw new Error("The DIHA walkthrough must never use the reset-on-login public demo account");
  }
  if (!apply) return;
  if (confirmEmail !== email) {
    throw new Error(`Apply requires --confirm-email=${email}`);
  }
  if (password.length < 16) {
    throw new Error("DIHA_DEMO_PASSWORD must contain at least 16 characters");
  }
}

async function selectLiveTenderFixtures(): Promise<TenderRow[]> {
  const rows = await sql`
    WITH canonical AS (
      SELECT
        id, reference_id, title, agency, country, sector, deadline,
        estimated_value, source_url, source_name, opportunity_type,
        ROW_NUMBER() OVER (
          PARTITION BY COALESCE(NULLIF(dedup_key, ''), 'legacy:' || id::text)
          ORDER BY
            CASE source_name WHEN 'UNDP' THEN 1 WHEN 'UNDP Atlas' THEN 2 WHEN 'UNGM' THEN 3 ELSE 4 END,
            CASE WHEN LENGTH(COALESCE(description, '')) >= 120 THEN 0 ELSE 1 END,
            id DESC
        ) AS canonical_rank
      FROM tenders
      WHERE status = 'open'
        AND deadline BETWEEN CURRENT_DATE + 21 AND CURRENT_DATE + 180
        AND source_url LIKE 'http%'
        AND COALESCE(has_broken_link, false) = false
        AND source_name IN ('UNGM', 'World Bank', 'UNDP', 'TED EU', 'UK Find a Tender', 'SAM.gov')
        AND title ~* '(^|[^[:alnum:]_])(digital|data|monitoring|evaluation|evaluate|consulting|consultant|training|software|information|capacity|research|survey|surveys|studies)([^[:alnum:]_]|$)|technical assistance|expert services'
        AND title !~* 'information session|prior information notice|contract award'
    ),
    ranked AS (
      SELECT
        id, reference_id, title, agency, country, sector, deadline,
        estimated_value, source_url, source_name, opportunity_type,
        ROW_NUMBER() OVER (
          PARTITION BY source_name
          ORDER BY
            CASE
              WHEN title ~* '(^|[^[:alnum:]_])(evaluation|evaluate)([^[:alnum:]_]|$)' THEN 0
              WHEN title ~* '(^|[^[:alnum:]_])(monitoring|data)([^[:alnum:]_]|$)' THEN 1
              WHEN title ~* '(^|[^[:alnum:]_])(digital|software)([^[:alnum:]_]|$)' THEN 2
              WHEN title ~* '(^|[^[:alnum:]_])(training|capacity)([^[:alnum:]_]|$)' THEN 3
              WHEN title ~* '(^|[^[:alnum:]_])(research|survey|surveys|studies)([^[:alnum:]_]|$)' THEN 4
              ELSE 5
            END,
            deadline,
            id
        ) AS source_rank
      FROM canonical
      WHERE canonical_rank = 1
    )
    SELECT
      id, reference_id, title, agency, country, sector, deadline,
      estimated_value, source_url, source_name, opportunity_type
    FROM ranked
    WHERE source_rank <= 3
    ORDER BY
      CASE source_name
        -- Lead the live walkthrough with a primary URL that resolves without
        -- UNGM's intermittent bot challenge. UNGM opportunities remain in the
        -- fixture, but they are not the on-stage source-navigation target.
        WHEN 'World Bank' THEN 1
        WHEN 'UNDP' THEN 2
        WHEN 'TED EU' THEN 3
        WHEN 'UNGM' THEN 4
        WHEN 'UK Find a Tender' THEN 5
        WHEN 'SAM.gov' THEN 6
        ELSE 7
      END,
      source_rank
    LIMIT 10
  `;

  return rows as unknown as TenderRow[];
}

function buildGaps() {
  return [
    {
      gap: "Current audited financial statements are not on file",
      severity: "high",
      fix: "Add the latest signed audit and map the turnover evidence to the buyer's financial gate.",
      action_steps: [
        "Upload the latest signed audit and auditor opinion",
        "Confirm the turnover period requested in the tender",
      ],
      upsell_tier: "tender-intelligence",
    },
    {
      gap: "Two project references need buyer-verifiable contacts",
      severity: "medium",
      fix: "Turn the strongest delivery records into concise references with scope, value, dates, and a reachable client contact.",
      action_steps: [
        "Select two comparable public-sector assignments",
        "Confirm reference contacts and permission to approach them",
      ],
      upsell_tier: "submission-package",
    },
    {
      gap: "Safeguarding evidence needs a current owner and review date",
      severity: "low",
      fix: "Assign policy ownership and record the next annual review date before submission.",
      action_steps: ["Confirm the safeguarding policy owner and review date"],
      upsell_tier: "tender-intelligence",
    },
  ] as const;
}

function buildMatchedTenders(rows: TenderRow[]) {
  const fits = [89, 86, 83, 79, 75, 72, 69, 66, 63, 60];
  const buckets = ["act_now", "strong_fit", "strong_fit", "strong_fit", "strategic", "strategic", "adjacent", "adjacent", "watchlist", "watchlist"];

  return rows.map((row, index) => {
    const fit = fits[index] ?? Math.max(55, 89 - index * 5);
    const sector = row.sector ?? "public-sector delivery";
    return {
      id: Number(row.id),
      title: row.title,
      agency: row.agency,
      deadline: row.deadline,
      country: row.country ?? "Global",
      sector,
      score: fit,
      reference_id: row.reference_id,
      source_name: row.source_name,
      source_url: row.source_url,
      opportunity_type: row.opportunity_type ?? "Tender",
      procurement_category: row.sector,
      source_provenance: "primary",
      estimated_value: row.estimated_value,
      match_reasons: [
        `The scope overlaps Asteria's ${sector.replaceAll("_", " ")} delivery evidence.`,
        "The buyer and geography fit the team's multilateral and public-sector operating model.",
      ],
      structured_reasons: {
        summary: [
          `Capability alignment: ${sector.replaceAll("_", " ")}.`,
          "Relevant public-sector delivery model and regional partner network.",
        ],
        matchedSectors: [sector.replaceAll("_", " ")],
        matchedCapabilities: ["programme delivery", "monitoring and evaluation", "digital systems"],
        procurement: {
          category: row.sector,
          opportunityType: row.opportunity_type,
          sourceName: row.source_name,
          sourceUrl: row.source_url,
          sourceProvenance: "primary",
          sectorLabel: sector.replaceAll("_", " "),
          estimatedValue: row.estimated_value,
        },
        geographyAlignment: {
          userCountries: ["Egypt", "Kenya", "Uganda", "Jordan"],
          tenderCountry: row.country,
          mode: row.country === "Multiple destinations" ? "regional" : "auto-expanded",
        },
        scoreBreakdown: { sector: 30, capabilities: 28, geography: 17, agency: 14 },
        evidenceQuality: "rich",
        confidence: index < 3 ? "high" : "medium",
        caveats: [index === 0
          ? "Resolve the audited-financials gate and confirm buyer eligibility before committing bid effort."
          : "Confirm country eligibility and local-partner requirements before committing bid effort."],
      },
      confidence: index < 3 ? "high" : "medium",
      opportunity_bucket: buckets[index] ?? "watchlist",
      opportunity_bucket_label: index === 0 ? "Act now" : index < 3 ? "Strong fit" : index === 3 ? "Strategic" : "Adjacent",
      opportunity_bucket_reason: index === 0
        ? "Strong alignment with a near-term deadline; qualify now."
        : "Promising fit, subject to the stated eligibility checks.",
      decision_brief: {
        headline: index === 0
          ? "Strong delivery fit; verify financial evidence before bid commitment."
          : "Worth qualifying against eligibility and partner requirements.",
        reasons_to_act: ["Relevant delivery capability", "Primary-source notice", "Actionable deadline"],
        verify_before_bidding: ["Financial threshold", "Country eligibility", "Named reference availability"],
        recommended_action: index < 3 ? "Run bid / no-bid this week" : "Keep on the qualified watchlist",
        source_confidence: "high",
        source_confidence_reason: "Tender details come from the buyer or official procurement portal.",
      },
    };
  });
}

async function validateFixtureOwnership(): Promise<number | null> {
  const rows = await sql`
    SELECT id, mined_profile_facts
    FROM users
    WHERE lower(email) = ${email}
    LIMIT 1
  `;
  if (rows.length === 0) return null;

  const facts = rows[0].mined_profile_facts as Record<string, unknown> | null;
  if (facts?.fixture !== FIXTURE_MARKER) {
    throw new Error(`Refusing to reset existing unmarked account: ${email}`);
  }
  return Number(rows[0].id);
}

async function applyReset(tenders: TenderRow[]): Promise<void> {
  await validateFixtureOwnership();
  const passwordHash = await hashPassword(password);
  const profileFacts = JSON.stringify({ fixture: FIXTURE_MARKER, syntheticCompany: true });

  const userRows = await sql`
    INSERT INTO users (
      email, name, business_name, password_hash, is_super_admin,
      subscription_status, subscription_expires_at, tier, trial_start_date,
      website, sector, country_focus, org_type, profile_description,
      profile_source, mined_profile_facts, created_at, updated_at
    ) VALUES (
      ${email}, 'DIHA Walkthrough Operator', ${COMPANY_NAME}, ${passwordHash}, false,
      'active', NOW() + INTERVAL '1 year', 'strategic-partnership', NOW(),
      NULL, 'Monitoring, evaluation and digital delivery',
      ${JSON.stringify(["Egypt", "Kenya", "Uganda", "Jordan"])}::jsonb,
      'Consulting firm',
      'Public-sector delivery firm specialising in monitoring and evaluation, digital systems, programme management, field research, and capacity building across MENA and East Africa.',
      'manual', ${profileFacts}::jsonb, NOW(), NOW()
    )
    ON CONFLICT (email) DO UPDATE SET
      name = EXCLUDED.name,
      business_name = EXCLUDED.business_name,
      password_hash = EXCLUDED.password_hash,
      is_super_admin = false,
      subscription_status = 'active',
      subscription_expires_at = EXCLUDED.subscription_expires_at,
      tier = EXCLUDED.tier,
      website = EXCLUDED.website,
      sector = EXCLUDED.sector,
      country_focus = EXCLUDED.country_focus,
      org_type = EXCLUDED.org_type,
      profile_description = EXCLUDED.profile_description,
      profile_source = EXCLUDED.profile_source,
      mined_profile_facts = EXCLUDED.mined_profile_facts,
      updated_at = NOW()
    RETURNING id
  `;
  const userId = Number(userRows[0].id);

  // Delete children first for compatibility with databases that predate the
  // ON DELETE hardening. Every target is anchored to this fixture user/email.
  await sql`DELETE FROM calibration_log WHERE user_id = ${userId}`;
  await sql`DELETE FROM proposal_packages WHERE user_id = ${userId}`;
  await sql`DELETE FROM submission_orders WHERE user_id = ${userId}`;
  await sql`DELETE FROM submission_drafts WHERE user_id = ${userId}`;
  await sql`DELETE FROM customer_access_events WHERE owner_user_id = ${userId}`;
  await sql`DELETE FROM customer_access_grants WHERE owner_user_id = ${userId}`;
  await sql`DELETE FROM work_orders WHERE user_id = ${userId}`;
  await sql`DELETE FROM pipeline_items WHERE user_id = ${userId}`;
  await sql`
    DELETE FROM email_queue
    WHERE assessment_id IN (SELECT id FROM assessments WHERE lower(email) = ${email})
  `;
  await sql`DELETE FROM assessments WHERE lower(email) = ${email}`;

  const gaps = buildGaps();
  const matchedTenders = buildMatchedTenders(tenders);
  const analysis = {
    detected_industry: "Monitoring, evaluation and digital public-sector delivery",
    sectors: ["monitoring and evaluation", "digital systems", "consulting", "education"],
    services: ["programme evaluation", "data platforms", "capacity building", "field delivery"],
    capabilities: ["mixed-method evaluation", "public-sector programme management", "digital data collection", "regional partner mobilisation"],
    certifications_detected: ["UNGM registration"],
    company_size_signal: "Established multi-country response team",
    strengths: ["Multilateral delivery experience", "Regional field network", "Integrated technical and evaluation capability"],
    gaps,
    readiness_dimensions: {
      technical_capability: 88,
      compliance_readiness: 67,
      geographic_reach: 82,
      experience_relevance: 84,
    },
    overall_score: 78,
    summary: "Asteria is well positioned for multilateral evaluation and digital-delivery opportunities. The immediate constraint is evidence packaging: audited financials and buyer-verifiable references should be closed before committing to the strongest bids.",
  };

  const assessmentRows = await sql`
    INSERT INTO assessments (
      company_name, email, website, description, sector, countries,
      crawled_data, ai_analysis, readiness_score, matched_tenders, gaps,
      recommended_tier, org_type, dev_themes, matched_grants,
      grant_readiness_score, include_consultancies, assessment_status,
      assessment_duration_ms, assessment_timings,
      assessment_started_at, assessment_completed_at, created_at
    ) VALUES (
      ${COMPANY_NAME}, ${email}, NULL,
      'Public-sector delivery firm specialising in monitoring and evaluation, digital systems, programme management, field research, and capacity building across MENA and East Africa.',
      'Monitoring, evaluation and digital delivery',
      ${JSON.stringify(["Egypt", "Kenya", "Uganda", "Jordan"])}::jsonb,
      NULL, ${JSON.stringify(analysis)}::jsonb, 78,
      ${JSON.stringify(matchedTenders)}::jsonb,
      ${JSON.stringify(gaps)}::jsonb,
      'strategic-partnership', 'Consulting firm',
      ${JSON.stringify(["governance", "digital transformation", "monitoring and evaluation"])}::jsonb,
      '[]'::jsonb, 72, true, 'completed', 18420,
      ${JSON.stringify({ source: "diha_walkthrough_fixture", version: 1 })}::jsonb,
      NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days'
    )
    RETURNING id, public_id
  `;
  const assessmentId = Number(assessmentRows[0].id);

  const stages = ["evaluating", "preparing", "matched", "submitted", "matched", "matched", "matched", "matched", "matched", "matched"];
  const pipelineItemIds: number[] = [];
  for (let index = 0; index < matchedTenders.length; index += 1) {
    const tender = matchedTenders[index];
    const reasons = JSON.stringify(tender.structured_reasons);
    const inserted = await sql`
      INSERT INTO pipeline_items (
        user_id, assessment_id, tender_id, tender_title, tender_agency,
        tender_deadline, tender_value, source_url, fit_score, stage,
        position, notes, match_reasons, created_at, updated_at
      ) VALUES (
        ${userId}, ${assessmentId}, ${tender.id}, ${tender.title}, ${tender.agency},
        ${tender.deadline}, ${tender.estimated_value ?? null}, ${tender.source_url},
        ${tender.score}, ${stages[index] ?? "matched"}, ${index},
        ${`[${FIXTURE_MARKER}] Curated walkthrough opportunity from ${tender.source_name}.`},
        ${reasons}::jsonb, NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day'
      ) RETURNING id
    `;
    pipelineItemIds.push(Number(inserted[0].id));
  }

  const featured = matchedTenders[0];
  const workOrders = await sql`
    INSERT INTO work_orders (
      user_id, plan, status, payment_status, amount_cents, currency, email,
      service_slug, pipeline_item_id, tender_title, agency, tender_url, intake,
      fulfillment_notes, created_at, updated_at
    ) VALUES (
      ${userId}, 'proposal-draft', 'in_progress', 'paid', 34900, 'usd', ${email},
      'submission-rfp', ${pipelineItemIds[0]}, ${featured.title}, ${featured.agency},
      ${featured.source_url},
      ${JSON.stringify({ fixture: FIXTURE_MARKER, submission_type: "RFP", synthetic_walkthrough: true })}::jsonb,
      'Synthetic DIHA walkthrough: amendment-aware response pack in client review.',
      NOW() - INTERVAL '3 days', NOW() - INTERVAL '6 hours'
    ) RETURNING id
  `;
  const workOrderId = Number(workOrders[0].id);
  const decisionRead = {
    merit: {
      score: 82,
      band: "Strong — conditional bid",
      basis: [
        "Relevant monitoring, evaluation, and digital-delivery evidence is on file.",
        "The response plan maps named evidence to the published scope and deadline.",
      ],
    },
    contestability: {
      band: "Mixed" as const,
      basis: [
        "The notice is openly published on a primary procurement source.",
        "Incumbent and bidder-field evidence is not available, so no stronger market claim is made.",
      ],
      thinEvidence: true,
    },
    recommendation: "Bid only after the audited-financials blocker is resolved.",
    caveat: "Merit and contestability are independent signals; this walkthrough scenario does not predict win probability.",
  };
  const intakeFields = {
    fixture: FIXTURE_MARKER,
    syntheticWalkthrough: true,
    decisionRead,
    fields: {
      k1: "A mixed-method delivery approach with field validation and an auditable indicator chain",
      k2: "Team lead, evaluation specialist, data systems lead, and country research partners",
      k3: "Two comparable public-sector assignments with buyer-verifiable contacts",
      k4: "Mobilisation in two weeks; amendment-adjusted review gate before final submission",
      ceiling: "145,000",
      validity: "120 days",
    },
    lines: [],
    currency: "USD",
    conformity: [],
    declarations: [],
    refs: [{ id: "diha-ref-1", label: "Regional programme evaluation", src: "typed" }],
    docs: [],
  };
  const docsV1 = [
    { name: "Technical proposal (methodology, workplan, team)", fmt: "DOCX + PDF", envelope: "technical", blocks: [{ b: "h1", text: "Technical Proposal · Revision 1" }, { b: "p", text: "Initial evidence-mapped response released for client review." }] },
    { name: "Financial proposal — sealed separately", fmt: "PDF", envelope: "financial", blocks: [{ b: "h1", text: "Financial Proposal · Revision 1" }, { b: "note", text: "Kept outside the technical envelope." }] },
    { name: "Forms, CVs & declarations pack", fmt: "PDF", envelope: "forms", blocks: [{ b: "h1", text: "Forms, CVs & Declarations · Revision 1" }, { b: "p", text: "Signature and evidence checklist." }] },
  ];
  const docsV2 = docsV1.map((doc) => ({
    ...doc,
    blocks: doc.blocks.map((block) => block.b === "h1" ? { ...block, text: block.text.replace("Revision 1", "Revision 2") } : block),
  }));
  const deliverables = [
    { name: "Technical proposal (methodology, workplan, team)", fmt: "DOCX + PDF", envelope: "technical", status: "ready" },
    { name: "Financial proposal — sealed separately", fmt: "PDF", envelope: "financial", status: "ready" },
    { name: "Forms, CVs & declarations pack", fmt: "PDF", envelope: "forms", status: "ready" },
  ];
  const artifactVersions = [
    { revision: 1, generatedAt: new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString(), basedOnRevisionNotes: null, intakeFields, documents: docsV1 },
    { revision: 2, generatedAt: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(), basedOnRevisionNotes: "Apply Amendment 1 and the answered Q&A to the workplan and evidence checklist.", intakeFields, documents: docsV2 },
  ];
  const amendments = [{
    n: 1,
    at: new Date(Date.now() - 18 * 60 * 60 * 1000).toISOString(),
    summary: "Walkthrough scenario: Amendment 1 extends the response timetable and clarifies the reporting cadence.",
    action: "Revision 2 was sealed; the workplan, compliance map, and internal review dates were updated.",
  }];
  const qna = [{
    at: new Date(Date.now() - 14 * 60 * 60 * 1000).toISOString(),
    src: "ops",
    q: "Walkthrough scenario: may country research partners be named as associates?",
    a: "Yes, provided the prime remains accountable and each role is evidenced.",
    impact: "Revision 2 updates the team table and responsibility matrix.",
  }];
  const events = [
    { at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(), label: "Submission commissioned from a matched opportunity.", by: "client" },
    { at: new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString(), label: "Revision 1 passed QA and was sealed for review.", by: "ops" },
    { at: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(), label: "Amendment and Q&A incorporated; Revision 2 sealed without overwriting Revision 1.", by: "ops" },
  ];
  const submissionRows = await sql`
    INSERT INTO submission_orders (
      user_id, work_order_id, type, price_cents, currency, tender, agency,
      source, portal, tender_id, pipeline_item_id, due, value, fit, stage, pct,
      round, stage_note, sla_mins, completeness, blockers, intake, intake_fields,
      deliverables, events, artifact_versions, amendments, qna, outcome, shepherd,
      paid_at, created_at, updated_at
    ) VALUES (
      ${userId}, ${workOrderId}, 'RFP', 34900, 'usd', ${featured.title}, ${featured.agency},
      ${featured.source_url}, 'Primary procurement portal', ${featured.id}, ${pipelineItemIds[0]},
      ${featured.deadline}, ${featured.estimated_value ?? null}, ${featured.score}, 'review', 100,
      1, 'Synthetic walkthrough · Revision 2 is ready for your evidence check.', 1440, 92,
      ${JSON.stringify([{ id: "financials", label: "Attach the latest signed audit before approval", sev: "high", state: "acknowledged", note: "Owner: Finance lead · due before final approval" }])}::jsonb,
      ${JSON.stringify([["Scenario", "Synthetic DIHA walkthrough"], ["Decision", "Conditional bid"], ["Current owner", "Finance lead"]])}::jsonb,
      ${JSON.stringify(intakeFields)}::jsonb, ${JSON.stringify(deliverables)}::jsonb,
      ${JSON.stringify(events)}::jsonb, ${JSON.stringify(artifactVersions)}::jsonb,
      ${JSON.stringify(amendments)}::jsonb, ${JSON.stringify(qna)}::jsonb,
      '{"state":"pending"}'::jsonb, '{"checked":[]}'::jsonb,
      NOW() - INTERVAL '3 days', NOW() - INTERVAL '3 days', NOW() - INTERVAL '6 hours'
    ) RETURNING id
  `;
  const submissionOrderId = Number(submissionRows[0].id);
  await sql`UPDATE submission_orders SET ref = ${`TP-${2000 + submissionOrderId}`} WHERE id = ${submissionOrderId}`;
  await sql`
    INSERT INTO calibration_log (
      user_id, source, event_type, tender_id, work_order_id, submission_order_id,
      agency, tender_type, value_band, country, system_output, vendor_action,
      review_disqualifier_caught, founder_fit_reasoning, outcome_state, dedup_key,
      captured_at, updated_at
    ) VALUES (
      ${userId}, 'diha_fixture', 'match', ${featured.id}, ${workOrderId}, ${submissionOrderId},
      ${featured.agency}, 'RFP', 'unknown', ${featured.country},
      ${JSON.stringify({
        compliance: { flags: [{ id: "financials", severity: "high", state: "acknowledged" }] },
        merit: decisionRead.merit,
        contestability: decisionRead.contestability,
        verdict: { recommendation: "conditional_bid" },
        outcomeHook: { state: "pending" },
      })}::jsonb,
      'bid', true,
      'Strong capability fit, conditional on resolving the evidenced financial gate.',
      'pending', ${`${FIXTURE_MARKER}:${userId}:submission:${submissionOrderId}`},
      NOW() - INTERVAL '6 hours', NOW() - INTERVAL '6 hours'
    )
  `;

  const verification = await sql`
    SELECT
      (SELECT COUNT(*)::int FROM assessments WHERE lower(email) = ${email}) AS assessments,
      (SELECT COUNT(*)::int FROM pipeline_items WHERE user_id = ${userId}) AS pipeline_items,
      (SELECT COUNT(*)::int FROM submission_orders WHERE user_id = ${userId}) AS submission_orders,
      (SELECT COUNT(*)::int FROM calibration_log WHERE user_id = ${userId}) AS calibration_events,
      (SELECT jsonb_array_length(artifact_versions)::int FROM submission_orders WHERE user_id = ${userId} LIMIT 1) AS artifact_versions,
      (SELECT COUNT(*)::int FROM users WHERE id = ${userId} AND is_super_admin = false) AS non_admin_users
  `;
  const result = verification[0];
  if (
    Number(result.assessments) !== 1
    || Number(result.pipeline_items) < 8
    || Number(result.pipeline_items) > 12
    || Number(result.submission_orders) !== 1
    || Number(result.calibration_events) !== 1
    || Number(result.artifact_versions) !== 2
    || Number(result.non_admin_users) !== 1
  ) {
    throw new Error(`Fixture verification failed: ${JSON.stringify(result)}`);
  }

  console.log("[diha:demo:reset_complete]", {
    email,
    userId,
    assessmentId,
    reportId: assessmentRows[0].public_id,
    matchedTenders: matchedTenders.length,
    workOrderId,
    submissionOrderId,
    artifactVersions: 2,
    password: "supplied-via-environment",
  });
}

async function main(): Promise<void> {
  assertSafeInputs();
  const existingUserId = await validateFixtureOwnership();
  const tenders = await selectLiveTenderFixtures();
  if (tenders.length < 8 || tenders.length > 12) {
    throw new Error(`Selected ${tenders.length} suitable live tenders; the DIHA fixture requires 8–12`);
  }

  console.log("[diha:demo:plan]", {
    mode: apply ? "apply" : "dry-run",
    email,
    fixtureMarker: FIXTURE_MARKER,
    existingFixtureUserId: existingUserId,
    selectedTenders: tenders.map((t) => ({
      id: t.id,
      reference: t.reference_id,
      source: t.source_name,
      deadline: t.deadline,
      title: t.title.slice(0, 100),
    })),
  });

  if (!apply) {
    console.log("[diha:demo:dry_run_complete] No rows changed. Add --apply and the exact --confirm-email value to reset the fixture.");
    return;
  }

  await applyReset(tenders);
}

main().catch((err) => {
  console.error("[diha:demo:reset_failed]", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
