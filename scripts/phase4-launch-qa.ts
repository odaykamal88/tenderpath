/**
 * Phase 4 launch QA loop.
 *
 * This is a non-mutating launch-readiness audit. It uses realistic profile
 * fixtures to check classification expectations, match relevance/actionability,
 * service CTA route availability, payment readiness, and ops fulfillment state.
 *
 * Usage:
 *   npx tsx scripts/phase4-launch-qa.ts
 *   npx tsx scripts/phase4-launch-qa.ts --strict
 */
import fs from "node:fs";
import path from "node:path";
import { sql } from "../src/lib/db";
import { matchTenders } from "../src/lib/assessment/match";
import type { AIAnalysis, MatchedTender } from "../src/lib/types";

try {
  const env = fs.readFileSync(".env.local", "utf-8");
  for (const line of env.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0 && !line.trim().startsWith("#")) {
      process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
} catch {}

type LaunchProfile = {
  key: string;
  company: string;
  email: string;
  websiteContains: string;
  countries: string[];
  expectedIndustry: string;
  expectedSectors: string[];
  minTenderMatches: number;
  expectedServices: string[];
  includeConsultancies?: boolean;
  analysis: AIAnalysis;
};

type LaunchFixture = {
  name: string;
  description: string;
  profiles: LaunchProfile[];
};

type LatestAssessment = {
  id: number;
  company_name: string;
  email: string;
  website: string | null;
  sector: string | null;
  ai_analysis: AIAnalysis | null;
  countries: string[] | string | null;
  created_at: string;
};

const SERVICE_ROUTES: Record<string, string> = {
  "bid-no-bid": "src/app/dashboard/services/[service]/page.tsx",
  digest: "src/app/dashboard/services/[service]/page.tsx",
  proposal: "src/app/dashboard/services/[service]/page.tsx",
  "lta-roster": "src/app/dashboard/services/[service]/page.tsx",
};

const REQUIRED_PAYMENT_ENV = [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_BIDNOBID_PRICE_ID",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
];

function isSet(key: string): boolean {
  return Boolean(process.env[key]?.trim());
}

function asArray(value: string[] | string | null): string[] {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function hasSectorOverlap(actual: string[], expected: string[]): boolean {
  const actualText = actual.join(" ").toLowerCase();
  return expected.some((sector) => actualText.includes(sector.toLowerCase().split("&")[0].trim()));
}

function actionable(match: MatchedTender): boolean {
  const reasons = match.structured_reasons?.summary ?? match.match_reasons ?? [];
  return Boolean(
    match.title
    && match.agency
    && match.deadline
    && match.source_url
    && match.score >= 40
    && reasons.length > 0
    && match.opportunity_bucket,
  );
}

function routeExists(service: string): boolean {
  const route = SERVICE_ROUTES[service];
  return Boolean(route && fs.existsSync(path.resolve(process.cwd(), route)));
}

async function latestAssessment(profile: LaunchProfile): Promise<LatestAssessment | null> {
  const rows = await sql`
    SELECT id, company_name, email, website, sector, ai_analysis, countries, created_at
    FROM assessments
    WHERE email = ${profile.email}
       OR LOWER(COALESCE(website, '')) LIKE ${`%${profile.websiteContains.toLowerCase()}%`}
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return (rows[0] as LatestAssessment | undefined) ?? null;
}

async function paymentReadiness() {
  const purchaseRows = await sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE stripe_session_id IS NOT NULL)::int AS with_stripe_session,
      COUNT(DISTINCT stripe_session_id) FILTER (WHERE stripe_session_id IS NOT NULL)::int AS distinct_stripe_sessions
    FROM purchase_logs
  `;
  const workOrderRows = await sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE payment_status = 'paid')::int AS paid,
      COUNT(*) FILTER (WHERE payment_status = 'pending')::int AS pending,
      COUNT(*) FILTER (WHERE stripe_session_id IS NOT NULL)::int AS with_stripe_session
    FROM work_orders
  `;
  const purchase = purchaseRows[0] ?? {};
  const duplicateStripeSessions = Number(purchase.with_stripe_session ?? 0)
    - Number(purchase.distinct_stripe_sessions ?? 0);

  return {
    missing: REQUIRED_PAYMENT_ENV.filter((key) => !isSet(key)),
    purchaseLogs: {
      ...purchase,
      duplicate_stripe_sessions: duplicateStripeSessions,
    },
    workOrders: workOrderRows[0] ?? {},
  };
}

async function main() {
  const strict = process.argv.includes("--strict");
  const verbose = process.argv.includes("--verbose");
  const fixturePath = path.resolve(process.cwd(), "data/benchmarks/phase4-launch-qa.json");
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf-8")) as LaunchFixture;
  const finalLog = console.log;
  console.log = (...args: unknown[]) => {
    if (verbose) console.error(...args);
  };
  console.warn = (...args: unknown[]) => {
    if (verbose) console.error(...args);
  };

  const profiles = [];
  for (const profile of fixture.profiles) {
    const stored = await latestAssessment(profile);
    const analysis = stored?.ai_analysis ?? profile.analysis;
    const countries = stored ? asArray(stored.countries) : profile.countries;
    const classificationSource = stored ? "latest-assessment" : "fixture-baseline";
    const industryOk = analysis.detected_industry === profile.expectedIndustry;
    const sectorOk = hasSectorOverlap(analysis.sectors ?? [], profile.expectedSectors);
    const matches = await matchTenders(analysis, countries.length ? countries : profile.countries, {
      includeConsultancies: profile.includeConsultancies,
      userEmail: profile.email,
    });
    const topMatches = matches.slice(0, 5);
    const actionableCount = topMatches.filter(actionable).length;
    const ctaRoutes = Object.fromEntries(profile.expectedServices.map((service) => [service, routeExists(service)]));

    profiles.push({
      key: profile.key,
      company: profile.company,
      classificationSource,
      assessmentId: stored?.id ?? null,
      industry: {
        expected: profile.expectedIndustry,
        actual: analysis.detected_industry,
        ok: industryOk,
      },
      sectors: {
        expected: profile.expectedSectors,
        actual: analysis.sectors,
        ok: sectorOk,
      },
      matches: {
        count: matches.length,
        minExpected: profile.minTenderMatches,
        ok: matches.length >= profile.minTenderMatches,
        actionableTop5: actionableCount,
        actionableOk: actionableCount >= Math.min(3, topMatches.length),
        top: topMatches.map((match) => ({
          title: match.title,
          agency: match.agency,
          country: match.country,
          deadline: match.deadline,
          score: match.score,
          bucket: match.opportunity_bucket,
          source_url: match.source_url,
        })),
      },
      ctas: {
        routes: ctaRoutes,
        ok: Object.values(ctaRoutes).every(Boolean),
      },
    });
  }

  const payment = await paymentReadiness();
  const summary = {
    profiles: profiles.length,
    classificationsOk: profiles.filter((profile) => profile.industry.ok || profile.sectors.ok).length,
    matchCountsOk: profiles.filter((profile) => profile.matches.ok).length,
    actionableOk: profiles.filter((profile) => profile.matches.actionableOk).length,
    ctasOk: profiles.filter((profile) => profile.ctas.ok).length,
    paymentReady: payment.missing.length === 0 && Number(payment.purchaseLogs.duplicate_stripe_sessions) === 0,
    opsReady: Number(payment.workOrders.total ?? 0) > 0,
  };

  const blockers = [
    ...profiles
      .filter((profile) => !profile.matches.ok || !profile.matches.actionableOk)
      .map((profile) => `${profile.key}: weak match/actionability signal`),
    ...payment.missing.map((key) => `payment env missing: ${key}`),
    Number(payment.purchaseLogs.duplicate_stripe_sessions) > 0 ? "purchase_logs has duplicate stripe_session_id rows" : null,
  ].filter(Boolean);

  const result = {
    fixture: fixture.name,
    checkedAt: new Date().toISOString(),
    summary,
    blockers,
    profiles,
    payment,
  };

  finalLog(JSON.stringify(result, null, 2));

  if (strict && blockers.length) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("[phase4-launch-qa] failed", err);
  process.exit(1);
});
