/**
 * Destructive-by-tag production-preview rehearsal for the first-client path.
 *
 * Seeds three short-lived accounts in the configured database, proves auth,
 * one-use founder credit, receipt, customer/admin access boundaries, two
 * immutable review versions, exports, and email observability through the
 * deployed HTTP surface, then removes every tagged customer row it created.
 *
 * Run:
 *   npm run rehearsal:first-client -- --base-url=https://preview.example.app
 */

import { loadEnvConfig } from "@next/env";
import { sql } from "../src/lib/db";
import { hashPassword } from "../src/lib/password";

loadEnvConfig(process.cwd());

const baseUrl = (
  process.argv.find((arg) => arg.startsWith("--base-url="))?.slice("--base-url=".length)
  ?? process.env.REHEARSAL_BASE_URL
  ?? ""
).replace(/\/$/, "");

if (!/^https:\/\//.test(baseUrl)) {
  throw new Error("Pass an HTTPS deployment with --base-url=https://…");
}

const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const password = `TP-Rehearsal-${tag}!`;
const identities = {
  vendor: { email: `icp-vendor-${tag}@tenderpath.me`, business: `ICP Vendor Rehearsal ${tag}` },
  competitor: { email: `icp-consultancy-${tag}@tenderpath.me`, business: `ICP Consultancy Rehearsal ${tag}` },
  admin: { email: `icp-admin-${tag}@tenderpath.me`, business: `ICP Admin Rehearsal ${tag}` },
};

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type SeededUser = { id: number; email: string };

const seededUsers: SeededUser[] = [];
const workOrderIds = new Set<number>();
const orderIds = new Set<number>();

function ok(label: string): void {
  console.log(`  ✓ ${label}`);
}

function assert(condition: unknown, label: string, detail?: unknown): asserts condition {
  if (!condition) {
    throw new Error(`${label}${detail === undefined ? "" : ` — ${JSON.stringify(detail).slice(0, 600)}`}`);
  }
  ok(label);
}

async function api(
  path: string,
  options: { token?: string; method?: string; body?: unknown } = {},
): Promise<{ status: number; contentType: string; json: Json | null; bytes: Uint8Array }> {
  const headers = new Headers();
  if (options.token) headers.set("authorization", `Bearer ${options.token}`);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    redirect: "manual",
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") ?? "";
  let json: Json | null = null;
  if (contentType.includes("application/json")) {
    try {
      json = JSON.parse(new TextDecoder().decode(bytes)) as Json;
    } catch {
      json = null;
    }
  }
  return { status: response.status, contentType, json, bytes };
}

async function seedUser(
  identity: { email: string; business: string },
  isAdmin = false,
): Promise<SeededUser> {
  const passwordHash = await hashPassword(password);
  const rows = await sql`
    INSERT INTO users (
      email, name, business_name, password_hash, is_super_admin,
      subscription_status, tier, trial_start_date, created_at, updated_at
    ) VALUES (
      ${identity.email}, ${identity.business}, ${identity.business}, ${passwordHash},
      ${isAdmin}, 'active', 'pro', NOW(), NOW(), NOW()
    )
    RETURNING id, email
  `;
  const user = { id: Number(rows[0].id), email: String(rows[0].email) };
  seededUsers.push(user);
  return user;
}

async function login(email: string): Promise<string> {
  const response = await api("/api/auth/password", {
    method: "POST",
    body: { email, password },
  });
  assert(response.status === 200 && typeof response.json?.token === "string", `password auth works for ${email}`, response.json);
  return response.json!.token as string;
}

function commissionDraft(title: string) {
  return {
    type: "RFQ",
    draft: {
      tender: {
        title,
        agency: "UNDP Country Office",
        portal: "Quantum supplier portal",
        source: "UNGM",
        due: "2030-08-30",
      },
      fields: {
        validity: "90 days, as required by RFQ TP-REHEARSAL",
        delivery: "Within 21 calendar days of purchase order",
        incoterms: "DAP, named destination in the RFQ",
        warranty: "24 months, as required by the RFQ",
        tax: "VAT included as required by the RFQ",
        specs: "Fully compliant with the attached RFQ specification",
      },
      currency: "USD",
      lines: [
        { id: "line-1", desc: "Facilitation and workshop delivery", specRef: "RFQ §3.1", qty: 4, unit: "day", unitPrice: 1250 },
        { id: "line-2", desc: "Final workshop report", specRef: "RFQ §3.2", qty: 1, unit: "lot", unitPrice: 1800 },
      ],
      conformity: [],
      declarations: ["compliance:0", "compliance:1", "compliance:2", "compliance:3"],
      refs: [
        { id: "ref-1", label: "Comparable public-sector facilitation engagement", src: "typed" },
      ],
      docs: [
        { docId: "inc", state: "resolved" },
        { docId: "tax", state: "resolved" },
        { docId: "cat", state: "resolved" },
        { docId: "warr", state: "drafted" },
        { docId: "ungm", state: "resolved" },
      ],
      step: 3,
    },
  };
}

async function cleanup(): Promise<void> {
  if (!seededUsers.length) return;

  for (const user of seededUsers) {
    const rows = await sql`SELECT id FROM work_orders WHERE user_id = ${user.id}`.catch(() => []);
    for (const row of rows) workOrderIds.add(Number(row.id));
    const submissions = await sql`SELECT id FROM submission_orders WHERE user_id = ${user.id}`.catch(() => []);
    for (const row of submissions) orderIds.add(Number(row.id));
  }

  for (const orderId of orderIds) {
    await sql`DELETE FROM email_queue WHERE message_key LIKE ${`tp-sub-review-${orderId}-%`}`.catch(() => null);
  }
  for (const workOrderId of workOrderIds) {
    await sql`DELETE FROM email_queue WHERE message_key LIKE ${`tp-work-order-${workOrderId}-%`}`.catch(() => null);
    await sql`DELETE FROM purchase_logs WHERE stripe_session_id = ${`free-submission:wo:${workOrderId}`}`.catch(() => null);
    await sql`DELETE FROM customer_access_events WHERE work_order_id = ${workOrderId}`.catch(() => null);
    await sql`DELETE FROM customer_access_grants WHERE work_order_id = ${workOrderId}`.catch(() => null);
    await sql`DELETE FROM submission_orders WHERE work_order_id = ${workOrderId}`.catch(() => null);
    await sql`DELETE FROM work_orders WHERE id = ${workOrderId}`.catch(() => null);
  }
  for (const user of seededUsers.reverse()) {
    await sql`DELETE FROM submission_drafts WHERE user_id = ${user.id}`.catch(() => null);
    await sql`DELETE FROM submission_orders WHERE user_id = ${user.id}`.catch(() => null);
    await sql`DELETE FROM purchase_logs WHERE user_id = ${user.id}`.catch(() => null);
    await sql`DELETE FROM work_orders WHERE user_id = ${user.id}`.catch(() => null);
    await sql`DELETE FROM email_queue WHERE email = ${user.email}`.catch(() => null);
    await sql`DELETE FROM users WHERE id = ${user.id} AND email = ${user.email}`.catch(() => null);
  }
}

async function main(): Promise<void> {
  console.log(`First-client rehearsal · ${baseUrl}`);
  await seedUser(identities.vendor);
  await seedUser(identities.competitor);
  await seedUser(identities.admin, true);

  const vendorToken = await login(identities.vendor.email);
  const competitorToken = await login(identities.competitor.email);
  const adminToken = await login(identities.admin.email);

  const commissioned = await api("/api/dashboard/submission-orders", {
    token: vendorToken,
    method: "POST",
    body: commissionDraft(`RFQ rehearsal A ${tag}`),
  });
  assert(commissioned.status === 200 && commissioned.json?.free === true, "founder credit commissions a live $0 order", commissioned.json);
  const orderId = Number(commissioned.json!.order.id);
  const workOrderId = Number(commissioned.json!.work_order_id);
  orderIds.add(orderId);
  workOrderIds.add(workOrderId);
  assert(Boolean(commissioned.json?.order.paidAt), "credit starts the delivery clock");
  const calibrationRows = await sql`
    SELECT vendor_action, source, submission_order_id, work_order_id,
           system_output->'outcomeHook'->>'state' AS outcome_hook
    FROM calibration_log
    WHERE dedup_key = ${`submission:${seededUsers[0].id}:${orderId}`}
    LIMIT 1
  `;
  assert(
    calibrationRows.length === 1
      && calibrationRows[0].source === "submission"
      && calibrationRows[0].vendor_action === "bid"
      && Number(calibrationRows[0].submission_order_id) === orderId
      && Number(calibrationRows[0].work_order_id) === workOrderId
      && calibrationRows[0].outcome_hook === "pending",
    "commissioning captures the owned calibration row and outcome hook",
    calibrationRows[0],
  );

  const receipt = await api(`/api/dashboard/submission-orders/${orderId}/receipt`, { token: vendorToken });
  assert(receipt.status === 200 && receipt.bytes.length > 500, "customer receives a non-empty $0 receipt", { status: receipt.status, bytes: receipt.bytes.length });

  const second = await api("/api/dashboard/submission-orders", {
    token: vendorToken,
    method: "POST",
    body: commissionDraft(`RFQ rehearsal B ${tag}`),
  });
  if (second.json?.order?.id) orderIds.add(Number(second.json.order.id));
  if (second.json?.work_order_id) workOrderIds.add(Number(second.json.work_order_id));
  assert(second.status === 409 && second.json?.code === "PILOT_CREDIT_USED", "founder credit cannot be redeemed twice", second.json);

  const competitorRead = await api(`/api/dashboard/submission-orders/${orderId}`, { token: competitorToken });
  assert(competitorRead.status === 404, "competing tenant cannot read the order", competitorRead.json);
  const competitorExport = await api(`/api/dashboard/submission-orders/${orderId}/export?deliverable=0`, { token: competitorToken });
  assert(competitorExport.status === 404, "competing tenant cannot export the order", competitorExport.json);
  const competitorReceipt = await api(`/api/dashboard/submission-orders/${orderId}/receipt`, { token: competitorToken });
  assert(competitorReceipt.status === 404, "competing tenant cannot download the receipt", competitorReceipt.json);
  const competitorGrant = await api("/api/dashboard/privacy/support-access", {
    token: competitorToken,
    method: "POST",
    body: { action: "grant", workOrderId, durationHours: 2, purpose: "unauthorized rehearsal attempt" },
  });
  assert(competitorGrant.status === 404, "competing tenant cannot grant admin access to another tenant's order", competitorGrant.json);

  const adminBeforeGrant = await api(`/api/admin/submission-orders/${orderId}`, { token: adminToken });
  assert(adminBeforeGrant.status === 403 && adminBeforeGrant.json?.code === "CUSTOMER_CONTENT_LOCKED", "super admin cannot read customer content without a grant", adminBeforeGrant.json);

  const grant = await api("/api/dashboard/privacy/support-access", {
    token: vendorToken,
    method: "POST",
    body: { action: "grant", workOrderId, durationHours: 2, purpose: "Fulfil rehearsal order and run QA" },
  });
  assert(grant.status === 201, "customer grants time-boxed access for one work order", grant.json);
  const adminAfterGrant = await api(`/api/admin/submission-orders/${orderId}`, { token: adminToken });
  assert(adminAfterGrant.status === 200 && adminAfterGrant.json?.order?.contentLoaded === true, "admin reads the exact order after consent", adminAfterGrant.json);

  for (const to of ["drafting", "qa", "review"] as const) {
    const advanced = await api(`/api/admin/submission-orders/${orderId}`, {
      token: adminToken,
      method: "PATCH",
      body: { action: "advance", to },
    });
    assert(advanced.status === 200 && advanced.json?.order?.stage === to, `ops advances order to ${to}`, advanced.json);
    if (to === "review") {
      assert(advanced.json?.notification?.status === "sent", "review-ready email is accepted and observable", advanced.json?.notification);
      assert(advanced.json?.order?.artifactVersions?.length === 1, "first QA release seals Revision 1", advanced.json?.order?.artifactVersions);
    }
  }

  const revisionOne = await api(`/api/dashboard/submission-orders/${orderId}/export?deliverable=0&version=1`, { token: vendorToken });
  assert(revisionOne.status === 200 && revisionOne.bytes.length > 500, "customer downloads immutable Revision 1", { status: revisionOne.status, bytes: revisionOne.bytes.length });

  const changes = await api(`/api/dashboard/submission-orders/${orderId}`, {
    token: vendorToken,
    method: "POST",
    body: { action: "request_changes", notes: "Correct the named lead facilitator and retain the original commercial assumptions." },
  });
  assert(changes.status === 200 && changes.json?.order?.stage === "revisions", "customer requests a precise revision", changes.json);

  for (const to of ["qa", "review"] as const) {
    const advanced = await api(`/api/admin/submission-orders/${orderId}`, {
      token: adminToken,
      method: "PATCH",
      body: { action: "advance", to },
    });
    assert(advanced.status === 200 && advanced.json?.order?.stage === to, `revision advances to ${to}`, advanced.json);
    if (to === "review") {
      const versions = advanced.json?.order?.artifactVersions;
      assert(advanced.json?.notification?.status === "sent", "Revision 2 email uses a distinct idempotency key", advanced.json?.notification);
      assert(Array.isArray(versions) && versions.length === 2 && versions[0].revision === 1 && versions[1].revision === 2, "Revision 2 is appended without overwriting Revision 1", versions);
      assert(versions[0].basedOnRevisionNotes === null && typeof versions[1].basedOnRevisionNotes === "string", "revision lineage records the customer's change request", versions);
    }
  }

  const revisionTwo = await api(`/api/dashboard/submission-orders/${orderId}/export?deliverable=0&version=2`, { token: vendorToken });
  assert(revisionTwo.status === 200 && revisionTwo.bytes.length > 500, "customer downloads Revision 2 independently", { status: revisionTwo.status, bytes: revisionTwo.bytes.length });

  const emailHealth = await api("/api/admin/email-health", { token: adminToken });
  assert(emailHealth.status === 200 && emailHealth.json?.status !== "not_configured", "admin email health confirms production configuration", emailHealth.json);
  assert(Number(emailHealth.json?.summary?.sent_24h ?? 0) >= 2, "email ledger contains accepted transactional sends", emailHealth.json?.summary);

  const revoke = await api("/api/dashboard/privacy/support-access", {
    token: vendorToken,
    method: "POST",
    body: { action: "revoke", workOrderId },
  });
  assert(revoke.status === 200, "customer revokes support access", revoke.json);
  const adminAfterRevoke = await api(`/api/admin/submission-orders/${orderId}`, { token: adminToken });
  assert(adminAfterRevoke.status === 403, "admin content access closes immediately after revocation", adminAfterRevoke.json);

  console.log("\nFIRST-CLIENT REHEARSAL PASSED");
}

void (async () => {
  try {
    await main();
  } finally {
    await cleanup();
  }
})().catch((error) => {
  console.error("\nFIRST-CLIENT REHEARSAL FAILED", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
