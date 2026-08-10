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
    WITH ranked AS (
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
      FROM tenders
      WHERE status = 'open'
        AND deadline BETWEEN CURRENT_DATE + 21 AND CURRENT_DATE + 180
        AND source_url LIKE 'http%'
        AND COALESCE(has_broken_link, false) = false
        AND source_name IN ('UNGM', 'World Bank', 'UNDP', 'TED EU', 'UK Find a Tender', 'SAM.gov')
        AND title ~* '(^|[^[:alnum:]_])(digital|data|monitoring|evaluation|evaluate|consulting|consultant|training|software|information|capacity|research|survey|surveys|studies)([^[:alnum:]_]|$)|technical assistance|expert services'
        AND title !~* 'information session|prior information notice|contract award'
    )
    SELECT
      id, reference_id, title, agency, country, sector, deadline,
      estimated_value, source_url, source_name, opportunity_type
    FROM ranked
    WHERE source_rank <= 2
    ORDER BY
      CASE source_name
        WHEN 'UNGM' THEN 1
        WHEN 'World Bank' THEN 2
        WHEN 'UNDP' THEN 3
        WHEN 'TED EU' THEN 4
        WHEN 'UK Find a Tender' THEN 5
        WHEN 'SAM.gov' THEN 6
        ELSE 7
      END,
      source_rank
    LIMIT 6
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
  const fits = [89, 84, 79, 73, 68, 63];
  const buckets = ["act_now", "strong_fit", "strong_fit", "strategic", "adjacent", "watchlist"];

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
        caveats: index < 2 ? [] : ["Confirm country eligibility and local-partner requirements before committing bid effort."],
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

  const stages = ["evaluating", "preparing", "matched", "submitted", "matched", "matched"];
  for (let index = 0; index < matchedTenders.length; index += 1) {
    const tender = matchedTenders[index];
    const reasons = JSON.stringify(tender.structured_reasons);
    await sql`
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
      )
    `;
  }

  const verification = await sql`
    SELECT
      (SELECT COUNT(*)::int FROM assessments WHERE lower(email) = ${email}) AS assessments,
      (SELECT COUNT(*)::int FROM pipeline_items WHERE user_id = ${userId}) AS pipeline_items,
      (SELECT COUNT(*)::int FROM users WHERE id = ${userId} AND is_super_admin = false) AS non_admin_users
  `;
  const result = verification[0];
  if (Number(result.assessments) !== 1 || Number(result.pipeline_items) !== matchedTenders.length || Number(result.non_admin_users) !== 1) {
    throw new Error(`Fixture verification failed: ${JSON.stringify(result)}`);
  }

  console.log("[diha:demo:reset_complete]", {
    email,
    userId,
    assessmentId,
    reportId: assessmentRows[0].public_id,
    matchedTenders: matchedTenders.length,
    password: "supplied-via-environment",
  });
}

async function main(): Promise<void> {
  assertSafeInputs();
  const existingUserId = await validateFixtureOwnership();
  const tenders = await selectLiveTenderFixtures();
  if (tenders.length < 4) {
    throw new Error(`Only ${tenders.length} suitable live tenders found; refusing to create a thin demo`);
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
