/**
 * Read-only DIHA release gate against a deployed TenderPath URL and the
 * configured production database. The credential is loaded from an ignored
 * .env.*.local file and is never printed.
 *
 * Run:
 *   npm run smoke:diha-production -- \
 *     --base-url=https://www.tenderpath.me \
 *     --credentials=.env.diha.local
 */

import assert from "node:assert/strict";
import { chmodSync, existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { loadEnvConfig } from "@next/env";
import { parse } from "dotenv";
import { sql } from "../src/lib/db";
import { dedupKey, verifyLink } from "../src/lib/crawlers/types";
import type { SubmissionOrder } from "../src/lib/submissions/types";
import type { WbBrowseResult, WorkbenchData } from "../src/lib/workbench/types";

loadEnvConfig(process.cwd());

const args = process.argv.slice(2);
const baseUrl = (
  args.find((arg) => arg.startsWith("--base-url="))?.slice("--base-url=".length)
  ?? process.env.DIHA_BASE_URL
  ?? "https://www.tenderpath.me"
).replace(/\/$/, "");
const credentialArg = args.find((arg) => arg.startsWith("--credentials="))?.slice("--credentials=".length)
  ?? ".env.diha.local";
const strict = args.includes("--strict");
const credentialPath = resolve(process.cwd(), credentialArg);
const FIXTURE_MARKER = "tenderpath-diha-walkthrough-v1";
const EXPECTED_EMAIL = "diha-walkthrough@tenderpath.me";

if (!/^https:\/\//.test(baseUrl)) throw new Error("DIHA base URL must use HTTPS");
if (!existsSync(credentialPath)) throw new Error(`Credential file not found: ${credentialPath}`);
const credentialFilename = basename(credentialPath);
if (!credentialFilename.startsWith(".env.") || !credentialFilename.endsWith(".local")) {
  throw new Error("Credential file must be an ignored .env.*.local file");
}
chmodSync(credentialPath, 0o600);
Object.assign(process.env, parse(readFileSync(credentialPath)));

const email = (process.env.DIHA_DEMO_EMAIL ?? "").trim().toLowerCase();
const password = process.env.DIHA_DEMO_PASSWORD ?? "";
assert.equal(email, EXPECTED_EMAIL, "release gate only accepts the private DIHA tenant");
assert.ok(password.length >= 16, "private DIHA password is missing or too short");

type Json = Record<string, unknown>;

function pass(label: string, detail?: unknown): void {
  console.log(`  ✓ ${label}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
}

async function requestJson<T>(
  pathname: string,
  options: { token?: string; method?: string; body?: unknown; expected?: number } = {},
): Promise<{ status: number; body: T; ttfbMs: number }> {
  const headers = new Headers({ accept: "application/json" });
  if (options.token) headers.set("authorization", `Bearer ${options.token}`);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  const started = performance.now();
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    redirect: "manual",
  });
  const ttfbMs = Math.round(performance.now() - started);
  const raw = await response.text();
  let body: T;
  try {
    body = JSON.parse(raw) as T;
  } catch {
    throw new Error(`${pathname} returned non-JSON HTTP ${response.status}`);
  }
  assert.equal(response.status, options.expected ?? 200, `${pathname} returned HTTP ${response.status}`);
  return { status: response.status, body, ttfbMs };
}

function daysUntil(value: string): number {
  return Math.floor((new Date(`${value.slice(0, 10)}T23:59:59Z`).getTime() - Date.now()) / 86_400_000);
}

async function main(): Promise<void> {
  console.log(`DIHA production gate · ${baseUrl}${strict ? " · strict" : ""}`);

  // Warm the public surface once before measuring it; the gate measures the
  // route the presenter will actually hit, not a synthetic local handler.
  await fetch(`${baseUrl}/`, { redirect: "manual" });
  const publicStarted = performance.now();
  const publicResponse = await fetch(`${baseUrl}/`, { redirect: "manual" });
  const publicTtfbMs = Math.round(performance.now() - publicStarted);
  assert.ok(publicResponse.status >= 200 && publicResponse.status < 400, "public homepage must resolve");
  if (strict) assert.ok(publicTtfbMs < 1_500, `warm homepage response exceeded 1.5s (${publicTtfbMs}ms)`);
  pass("public homepage resolves", { status: publicResponse.status, warmResponseMs: publicTtfbMs });

  const shallow = await requestJson<{ status: string; db: string }>("/api/health");
  assert.deepEqual({ status: shallow.body.status, db: shallow.body.db }, { status: "ok", db: "connected" });
  pass("shallow health is green", { responseMs: shallow.ttfbMs });

  const deep = await requestJson<{
    status: string;
    db: string;
    open_tenders: number;
    stale_sources: string[];
    fresh_sources: string[];
    worker?: { status?: string; latency_ms?: number };
  }>("/api/health?deep=1");
  assert.equal(deep.body.status, "ok", "deep health is not green");
  assert.equal(deep.body.db, "connected", "production database is disconnected");
  assert.ok(Number(deep.body.open_tenders) > 0, "production has no open tenders");
  assert.equal(deep.body.worker?.status, "ok", "crawler rendering worker is not healthy");
  for (const source of ["UNGM", "World Bank", "TED EU"]) {
    assert.ok(deep.body.fresh_sources.includes(source), `${source} is not fresh`);
  }
  pass("deep health, load-bearing sources and worker are green", {
    openTenders: deep.body.open_tenders,
    staleSources: deep.body.stale_sources,
    workerMs: deep.body.worker?.latency_ms,
  });

  const auth = await requestJson<{ token?: string }>("/api/auth/password", {
    method: "POST",
    body: { email, password },
  });
  assert.ok(typeof auth.body.token === "string" && auth.body.token.length > 20, "private tenant login did not return a token");
  const token = auth.body.token;
  pass("private non-public tenant authenticates");

  const workbench = await requestJson<WorkbenchData>("/api/dashboard/workbench", { token });
  const wb = workbench.body;
  assert.equal(wb.company.name, "Asteria Development Systems", "unexpected walkthrough company");
  assert.equal(wb.assessmentStatus, "ready", "walkthrough assessment is not ready");
  assert.equal(wb.readiness.score, 78, "walkthrough readiness score drifted");
  assert.equal(wb.readiness.dims.length, 4, "walkthrough must show four canonical dimensions");
  assert.ok(wb.readiness.dims.every(([, value]) => value > 0), "readiness dimensions must not fabricate zeroes");
  assert.equal(wb.gaps.filter((gap) => gap.status === "open").length, 3, "walkthrough must have three open gaps");
  assert.equal(wb.matches.length, 10, "walkthrough must have ten curated matches");
  for (const match of wb.matches) {
    assert.ok(match.title && match.agency && match.type && match.source, `match ${match.id} is missing core metadata`);
    assert.ok(match.deadline && match.sourceUrl, `match ${match.id} is missing its deadline or primary link`);
    assert.ok(match.why && match.caveat, `match ${match.id} is missing a reason or caveat`);
  }
  const firstMatch = wb.matches[0];
  assert.ok(daysUntil(firstMatch.deadline!) >= 21, "the first walkthrough tender has less than 21 days remaining");
  pass("walkthrough assessment, ten matches and three gaps are intact", {
    responseMs: workbench.ttfbMs,
    firstDeadline: firstMatch.deadline,
  });

  const sourceResolves = await verifyLink(firstMatch.sourceUrl!, 12_000);
  assert.ok(sourceResolves, "the first walkthrough opportunity source does not resolve");
  pass("first walkthrough opportunity resolves at its source");

  const orders = await requestJson<{ orders: SubmissionOrder[] }>("/api/dashboard/submission-orders", { token });
  assert.equal(orders.body.orders.length, 1, "walkthrough must have one submission order");
  const orderId = orders.body.orders[0].id;
  const detail = await requestJson<{ order: SubmissionOrder }>(`/api/dashboard/submission-orders/${orderId}`, { token });
  const order = detail.body.order;
  const decision = order.intakeFields.decisionRead;
  assert.equal(order.stage, "review", "walkthrough submission must be in client review");
  assert.equal(order.artifactVersions.length, 2, "walkthrough must preserve two immutable revisions");
  assert.equal(order.amendments.length, 1, "walkthrough must include one amendment");
  assert.equal(order.qna.filter((item) => Boolean(item.a)).length, 1, "walkthrough must include one answered Q&A item");
  assert.equal(decision?.merit.score, 82, "response merit score drifted");
  assert.equal(decision?.contestability.band, "Mixed", "contestability band drifted");
  assert.equal(decision?.contestability.thinEvidence, true, "thin-evidence caveat must remain explicit");
  assert.match(decision?.caveat ?? "", /does not predict win probability/i, "decision read must reject win-probability framing");
  pass("submission decision, amendment, Q&A and immutable versions are intact", { orderId });

  const browse = await requestJson<WbBrowseResult>("/api/dashboard/browse", { token });
  const visibleKeys = browse.body.tenders.map((tender) => dedupKey({
    title: tender.title,
    agency: tender.agency,
    deadline: tender.deadline,
    reference_id: tender.code,
  }));
  assert.equal(new Set(visibleKeys).size, visibleKeys.length, "browse page contains visible duplicate opportunities");
  assert.ok(browse.body.tenders.some((tender) => tender.fit === null), "browse must preserve truthful unscored rows");
  pass("browse page is deduplicated and preserves unscored rows", { rows: browse.body.tenders.length });

  const userRows = await sql`
    SELECT id, is_super_admin
    FROM users
    WHERE lower(email) = ${email}
    LIMIT 1
  `;
  assert.equal(userRows.length, 1, "private walkthrough owner is missing from the configured database");
  assert.equal(userRows[0].is_super_admin, false, "walkthrough owner must not be an administrator");
  const userId = Number(userRows[0].id);
  const fixtureRows = await sql`
    SELECT
      (SELECT COUNT(*)::int FROM assessments
       WHERE lower(email) = ${email}
         AND assessment_timings->>'source' = 'diha_walkthrough_fixture') AS assessments,
      (SELECT COUNT(*)::int FROM pipeline_items
       WHERE user_id = ${userId} AND notes LIKE ${`%${FIXTURE_MARKER}%`}) AS pipeline_items,
      (SELECT COUNT(*)::int FROM submission_orders WHERE user_id = ${userId}) AS submission_orders,
      (SELECT COUNT(*)::int FROM calibration_log
       WHERE user_id = ${userId}
         AND dedup_key LIKE ${`${FIXTURE_MARKER}:%`}
         AND system_output->'outcomeHook'->>'state' = 'pending') AS calibration_rows
  `;
  assert.deepEqual(
    {
      assessments: Number(fixtureRows[0].assessments),
      pipelineItems: Number(fixtureRows[0].pipeline_items),
      submissionOrders: Number(fixtureRows[0].submission_orders),
      calibrationRows: Number(fixtureRows[0].calibration_rows),
    },
    { assessments: 1, pipelineItems: 10, submissionOrders: 1, calibrationRows: 1 },
    "walkthrough ownership or calibration fixture drifted",
  );
  pass("fixture ownership and calibration row are exact");

  const foreignRows = await sql`
    SELECT id
    FROM submission_orders
    WHERE user_id <> ${userId}
    ORDER BY id DESC
    LIMIT 1
  `;
  if (foreignRows.length) {
    const foreignId = Number(foreignRows[0].id);
    await requestJson<Json>(`/api/dashboard/submission-orders/${foreignId}`, { token, expected: 404 });
    pass("cross-tenant submission read is denied with 404");
  } else {
    const foreignWorkOrders = await sql`
      SELECT id
      FROM work_orders
      WHERE user_id IS NOT NULL AND user_id <> ${userId}
      ORDER BY id DESC
      LIMIT 1
    `;
    if (!foreignWorkOrders.length) {
      pass("cross-tenant live read skipped because no foreign customer object exists; tagged rehearsal supplies this fixture");
    } else {
      const foreignWorkOrderId = Number(foreignWorkOrders[0].id);
      await requestJson<Json>(`/api/dashboard/work-orders/${foreignWorkOrderId}`, { token, expected: 404 });
      pass("cross-tenant work-order read is denied with 404");
    }
  }

  console.log("DIHA production gate passed.");
}

main().catch((error) => {
  console.error("[diha:production-gate-failed]", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
