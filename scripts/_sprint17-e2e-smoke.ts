/**
 * Sprint 17 end-to-end smoke test against the real production
 * database. Creates a synthetic test work order (idempotent — keyed
 * on a known stripe_session_id), invokes the full generation
 * orchestrator (LLM → render → blob upload → persist), and reports
 * which steps succeeded so we can prove the path before a real
 * paying customer triggers it.
 *
 * NEVER charges money. NEVER sends customer-facing email. The work
 * order is owned by smoke@tenderpath.me with a recognisable
 * `cs_smoke_*` stripe_session_id so it's easy to clean up.
 *
 * Usage:
 *   npx tsx scripts/_sprint17-e2e-smoke.ts roster     # roster pipeline
 *   npx tsx scripts/_sprint17-e2e-smoke.ts proposal   # proposal pipeline
 *   npx tsx scripts/_sprint17-e2e-smoke.ts bid        # bid/no-bid pipeline
 *   npx tsx scripts/_sprint17-e2e-smoke.ts --cleanup  # delete smoke orders
 */
import * as fs from "node:fs";
import { sql } from "../src/lib/db";

function loadEnv(p: string) {
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf-8").split("\n")) {
    const i = line.indexOf("=");
    if (i <= 0 || line.trim().startsWith("#")) continue;
    const k = line.slice(0, i).trim();
    if (process.env[k]) continue;
    process.env[k] = line.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
  }
}
loadEnv("/Users/odaykamal/Desktop/TENDERPATH/.env.local");

async function retry<T>(fn: () => Promise<T>, n = 3): Promise<T> {
  for (let i = 0; i < n; i++) {
    try { return await fn(); } catch (e) { if (i === n - 1) throw e; await new Promise(r => setTimeout(r, 1500 * (i + 1))); }
  }
  throw new Error("unreachable");
}

const SMOKE_EMAIL = "smoke@tenderpath.me";
const SMOKE_INTAKE = {
  package_notes: "Sprint 17 e2e smoke — DO NOT BILL. Synthetic test order.",
  submission_channel: "test",
  submission_deadline: "2026-12-31",
  target_agency: "WFP",
  agency_slug: "wfp",
};

async function ensureSmokeOrder(plan: string, sessionTag: string): Promise<number> {
  const sessionId = `cs_smoke_${sessionTag}_${Date.now()}`;
  // Use a fixed pipeline_item_id=null + synthetic tender_title so the
  // generator's context-loading helpers have something to chew on.
  const tenderTitle = plan === "roster-fast-track"
    ? "Smoke test — WFP roster registration"
    : "Smoke test — generic tender for proposal drafting";
  const rows = await retry(() => sql`
    INSERT INTO work_orders (
      user_id, plan, service_slug, status, payment_status,
      stripe_session_id, amount_cents, currency, email,
      pipeline_item_id, tender_title, agency, intake
    ) VALUES (
      NULL, ${plan}, ${plan}, 'new', 'paid',
      ${sessionId}, 0, 'usd', ${SMOKE_EMAIL},
      NULL, ${tenderTitle}, ${plan === "roster-fast-track" ? "WFP" : "WHO"},
      ${JSON.stringify(SMOKE_INTAKE)}::jsonb
    )
    RETURNING id
  `) as unknown as Array<{ id: number }>;
  return rows[0].id;
}

async function cleanupSmokeOrders(): Promise<void> {
  const deletedPkgs = await retry(() => sql`
    DELETE FROM proposal_packages
    WHERE work_order_id IN (SELECT id FROM work_orders WHERE email = ${SMOKE_EMAIL})
    RETURNING id
  `) as unknown as Array<{ id: number }>;
  const deletedOrders = await retry(() => sql`
    DELETE FROM work_orders WHERE email = ${SMOKE_EMAIL} RETURNING id
  `) as unknown as Array<{ id: number }>;
  console.log(`  Deleted ${deletedPkgs.length} packages + ${deletedOrders.length} work orders.`);
}

(async () => {
  const target = process.argv[2];
  if (target === "--cleanup") {
    console.log("=== Sprint 17 smoke cleanup ===");
    await cleanupSmokeOrders();
    console.log("Done.");
    return;
  }
  if (!["roster", "proposal", "bid"].includes(target)) {
    console.error("Usage: npx tsx scripts/_sprint17-e2e-smoke.ts <roster|proposal|bid|--cleanup>");
    process.exit(1);
  }
  console.log(`=== Sprint 17 e2e smoke — ${target} ===\n`);

  const plan = target === "roster" ? "roster-fast-track" : target === "proposal" ? "proposal-draft" : "bid-no-bid";
  console.log(`Step 1: creating synthetic paid work_order for ${plan}...`);
  const orderId = await ensureSmokeOrder(plan, target);
  console.log(`  → work_order #${orderId}`);

  console.log(`\nStep 2: invoking generator with silent=true (no email send)...`);
  const t0 = Date.now();
  let result: { ok?: boolean; attempts?: number; zipUrl?: string | null; skippedReason?: string; error?: string; output?: unknown };
  try {
    if (plan === "roster-fast-track") {
      const { generateRosterFastTrack } = await import("../src/lib/proposal-package/generate-roster");
      result = await generateRosterFastTrack({ workOrderId: orderId, silent: true });
    } else if (plan === "proposal-draft") {
      const { generateProposalPackage } = await import("../src/lib/proposal-package/generate-proposal");
      result = await generateProposalPackage({ workOrderId: orderId, silent: true });
    } else {
      const { generateBidNoBid } = await import("../src/lib/bid-no-bid/generate");
      result = await generateBidNoBid({ workOrderId: orderId });
    }
  } catch (err) {
    console.error(`  → THREW: ${err instanceof Error ? err.message : String(err)}`);
    if (err instanceof Error && err.stack) console.error(err.stack.split("\n").slice(0, 6).join("\n"));
    process.exit(1);
  }
  console.log(`  → ok=${result.ok} attempts=${result.attempts} elapsed=${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (result.error) console.log(`  → error=${result.error}`);
  if (result.skippedReason) console.log(`  → skippedReason=${result.skippedReason}`);
  console.log(`  → zipUrl=${result.zipUrl ?? "(none)"}`);

  console.log(`\nStep 3: verifying persistence...`);
  const pkg = await retry(() => sql`
    SELECT id, generation_status, generation_attempts,
           (output IS NOT NULL) AS has_output,
           (output ? 'agency_readiness_breakdown') AS has_breakdown,
           pg_column_size(output) AS output_bytes,
           pdf_url, pdf_pathname, error_message
    FROM proposal_packages WHERE work_order_id = ${orderId}
  `) as unknown as Array<{ id: number; generation_status: string | null; generation_attempts: number | null; has_output: boolean; has_breakdown: boolean | null; output_bytes: number | null; pdf_url: string | null; pdf_pathname: string | null; error_message: string | null }>;
  if (pkg[0]) {
    const p = pkg[0];
    console.log(`  pkg #${p.id} status=${p.generation_status} attempts=${p.generation_attempts}`);
    console.log(`  output_persisted=${p.has_output} breakdown_field=${p.has_breakdown ?? "n/a"} bytes=${p.output_bytes ?? "?"}`);
    console.log(`  pdf_url=${p.pdf_url ?? "(none)"} pathname=${p.pdf_pathname ?? "(none)"}`);
    if (p.error_message) console.log(`  error_message=${p.error_message}`);
  } else {
    console.log(`  NO PACKAGE PERSISTED`);
  }

  console.log(`\nStep 4: cleaning up smoke work order #${orderId}...`);
  await cleanupSmokeOrders();
  console.log("Done.");
})().catch((err) => { console.error("FAILED:", err); process.exitCode = 1; });
