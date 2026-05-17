/**
 * Sprint 16 production-readiness smoke test (read-only by default).
 *
 * Goal: verify the Sprint 14/15 pipeline (agency_readiness_breakdown,
 * the new email path, the DOCX/PDF leaderboard, the JSONB persistence)
 * works against the real production database WITHOUT charging anyone.
 *
 * What it does (read-only):
 *   1. Counts existing roster_fast_track work_orders + their statuses
 *   2. Inspects the most recent paid roster row for breakdown presence
 *   3. Spot-checks whether legacy (pre-Sprint-14) outputs would render
 *      cleanly on the new dashboard panel — i.e. backwards-compat
 *
 * With --regenerate <id>: forces a regeneration of the named paid
 * work order so we can confirm end-to-end. Requires a payment_status
 * of "paid" on the row. NEVER creates a new order; never charges.
 *
 * Usage:
 *   npx tsx scripts/_sprint16-prod-readiness.ts                  # read-only audit
 *   npx tsx scripts/_sprint16-prod-readiness.ts --regenerate ID  # live e2e
 */
import * as fs from "node:fs";
import { sql } from "../src/lib/db";

function loadEnv(envPath: string) {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const i = line.indexOf("=");
    if (i <= 0 || line.trim().startsWith("#")) continue;
    const k = line.slice(0, i).trim();
    if (process.env[k]) continue;
    process.env[k] = line.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
  }
}
loadEnv("/Users/odaykamal/Desktop/TENDERPATH/.env.local");

interface WorkOrderSummary {
  id: number;
  plan: string;
  service_slug: string | null;
  payment_status: string | null;
  agency: string | null;
  created_at: string;
}

interface PackageSummary {
  id: number;
  work_order_id: number;
  plan: string;
  generation_status: string | null;
  generation_attempts: number | null;
  has_breakdown: boolean;
  breakdown_count: number | null;
  start_here_agency: string | null;
  pdf_url: string | null;
  created_at: string;
}

(async () => {
  const args = process.argv.slice(2);
  const regenIndex = args.indexOf("--regenerate");
  const regenId = regenIndex >= 0 ? Number(args[regenIndex + 1]) : null;

  console.log("=== Sprint 16 production-readiness smoke test ===");
  console.log(`Mode: ${regenId ? `regenerate work_order ${regenId}` : "read-only audit"}`);
  console.log("");

  // 1. Inventory: how many roster orders exist and what's their state?
  console.log("--- Inventory: roster-fast-track work orders ---");
  const orderRows = await sql`
    SELECT id, plan, service_slug, payment_status, agency, created_at::text AS created_at
    FROM work_orders
    WHERE plan = 'roster-fast-track' OR service_slug = 'roster-fast-track'
    ORDER BY created_at DESC
    LIMIT 20
  ` as unknown as WorkOrderSummary[];
  console.log(`Found ${orderRows.length} roster work orders (showing up to 20 most recent)`);
  if (orderRows.length === 0) {
    console.log("  (no roster work orders in prod yet)");
  } else {
    for (const r of orderRows.slice(0, 10)) {
      console.log(`  #${r.id} status=${r.payment_status ?? "?"} agency=${r.agency ?? "?"} created=${r.created_at.slice(0, 10)}`);
    }
  }

  // 2. Package state: which roster packages exist and do any carry breakdown?
  console.log("\n--- Persistence audit: roster packages + breakdown presence ---");
  const packageRows = await sql`
    SELECT
      pp.id,
      pp.work_order_id,
      pp.plan,
      pp.generation_status,
      pp.generation_attempts,
      (pp.output ? 'agency_readiness_breakdown') AS has_breakdown_key,
      jsonb_array_length(COALESCE(pp.output->'agency_readiness_breakdown', '[]'::jsonb)) AS breakdown_count,
      (
        SELECT b->>'agency_label'
        FROM jsonb_array_elements(COALESCE(pp.output->'agency_readiness_breakdown', '[]'::jsonb)) b
        WHERE b->>'recommendation' = 'start_here'
        LIMIT 1
      ) AS start_here_agency,
      pp.pdf_url,
      pp.created_at::text AS created_at
    FROM proposal_packages pp
    WHERE pp.plan = 'roster-fast-track'
    ORDER BY pp.created_at DESC
    LIMIT 10
  ` as unknown as Array<PackageSummary & { has_breakdown_key: boolean }>;
  console.log(`Found ${packageRows.length} roster packages`);
  if (packageRows.length === 0) {
    console.log("  (no roster packages persisted yet — Sprint 14 hasn't run against a real paid order)");
  } else {
    for (const p of packageRows) {
      const breakdownTag = p.has_breakdown_key
        ? `breakdown=${p.breakdown_count ?? "?"} start_here=${p.start_here_agency ?? "?"}`
        : `breakdown=NONE (pre-Sprint-14)`;
      console.log(`  pkg #${p.id} wo=${p.work_order_id} status=${p.generation_status} attempts=${p.generation_attempts} ${breakdownTag}`);
    }
  }

  // 3. Backwards-compat sanity across all three paid services.
  console.log(`\n--- Backwards-compat audit across all paid services ---`);
  const compatRows = await sql`
    SELECT
      plan,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE plan = 'roster-fast-track' AND output IS NOT NULL AND output ? 'agency_readiness_breakdown') AS with_breakdown,
      COUNT(*) FILTER (WHERE plan = 'proposal-draft' AND output IS NOT NULL AND output ? 'gate_state') AS with_gate_state,
      COUNT(*) FILTER (WHERE plan = 'bid-no-bid' AND output IS NOT NULL AND output ? 'tender_type') AS with_tender_type
    FROM proposal_packages
    GROUP BY plan
    ORDER BY plan
  ` as unknown as Array<{ plan: string; total: number | string; with_breakdown: number | string; with_gate_state: number | string; with_tender_type: number | string }>;
  for (const r of compatRows) {
    const total = Number(r.total);
    let detail = `total=${total}`;
    if (r.plan === 'roster-fast-track') {
      const wb = Number(r.with_breakdown);
      detail += ` with_breakdown=${wb} legacy=${total - wb}`;
    } else if (r.plan === 'proposal-draft') {
      const wg = Number(r.with_gate_state);
      detail += ` with_gate_state=${wg} legacy=${total - wg}`;
    } else if (r.plan === 'bid-no-bid') {
      const wt = Number(r.with_tender_type);
      detail += ` with_tender_type=${wt} legacy=${total - wt}`;
    }
    console.log(`  ${r.plan.padEnd(20)} ${detail}`);
  }
  console.log(`\n  Renderer + dashboard guarantees:`);
  console.log(`  → AgencyReadinessSection returns null when field absent (RosterWorkspacePanel.tsx).`);
  console.log(`  → AgencyReadinessLeaderboard skips section when length === 0 (proposals/page.tsx).`);
  console.log(`  → renderCapabilityStatementDocx skips section when breakdown empty (docx.ts).`);
  console.log(`  → renderSubmissionInstructionsPdf skips page 1 entirely when breakdown empty (pdfDocs.tsx).`);
  console.log(`  → GateBanner + ComplianceList default to legacy behaviour when gate_state absent.`);
  console.log(`  → BidNoBid renderers default tender_type to 'unknown' when absent.`);

  // 4. Optional: live regenerate
  if (regenId) {
    console.log(`\n--- LIVE: regenerating roster package for work_order ${regenId} ---`);
    const target = await sql`
      SELECT id, plan, service_slug, payment_status
      FROM work_orders WHERE id = ${regenId} LIMIT 1
    ` as unknown as WorkOrderSummary[];
    if (!target[0]) {
      console.log(`  ABORT: work_order ${regenId} not found`);
      process.exit(1);
    }
    if (target[0].payment_status !== "paid") {
      console.log(`  ABORT: work_order ${regenId} is payment_status=${target[0].payment_status}, not "paid"`);
      process.exit(1);
    }
    const { generateRosterFastTrack } = await import("../src/lib/proposal-package/generate-roster");
    const result = await generateRosterFastTrack({
      workOrderId: regenId,
      force: true,    // bypass already-generated check
      silent: true,   // don't send email — we're testing
    });
    console.log(`  ok=${result.ok} attempts=${result.attempts} zipUrl=${result.zipUrl ?? "—"}`);
    console.log(`  skippedReason=${result.skippedReason ?? "—"}`);
    if (result.output) {
      const b = result.output.agency_readiness_breakdown ?? [];
      console.log(`  agency_readiness_breakdown: ${b.length} entries`);
      const startHere = b.find((x: { recommendation: string }) => x.recommendation === "start_here");
      if (startHere) console.log(`  start_here: ${startHere.agency_label} ${startHere.readiness_0_10}/10`);
    }
  }

  console.log("\nDone.");
})().catch((err) => {
  console.error("FAILED:", err);
  process.exitCode = 1;
});
