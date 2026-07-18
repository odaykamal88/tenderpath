import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { storedBlobAccess } from "../src/lib/vault/storage";

const root = process.cwd();

function source(pathname: string): string {
  return readFileSync(resolve(root, pathname), "utf8");
}

assert.equal(
  storedBlobAccess("https://store.private.blob.vercel-storage.com/customer/file.pdf"),
  "private",
);
assert.equal(
  storedBlobAccess("https://store.public.blob.vercel-storage.com/customer/file.pdf"),
  "legacy_public",
);
assert.equal(storedBlobAccess("data:application/pdf;base64,AA=="), "inline");
assert.equal(storedBlobAccess("tenderpath://won/pipeline-item/42"), "synthetic");
assert.equal(storedBlobAccess("https://example.com/file.pdf"), "invalid");

const privateUploadFiles = [
  "src/app/api/dashboard/vault/upload/route.ts",
  "src/app/api/dashboard/vault/upload-token/route.ts",
  "src/app/dashboard/services/ServiceIntakeForm.tsx",
  "src/lib/bid-no-bid/generate.ts",
  "src/lib/proposal-package/bundle.ts",
];
for (const pathname of privateUploadFiles) {
  const body = source(pathname);
  assert.ok(!/access:\s*["']public["']/.test(body), `${pathname} still writes public Blob objects`);
}

const legacyOwnerFallbackRoutes = [
  "src/app/api/proposals/generate/route.ts",
  "src/app/api/dashboard/work-orders/[id]/artifact/route.ts",
  "src/app/api/dashboard/work-orders/[id]/bid-no-bid/route.ts",
  "src/app/api/dashboard/work-orders/[id]/outcome/route.ts",
  "src/app/api/dashboard/work-orders/[id]/proposal-package/route.ts",
  "src/app/api/dashboard/work-orders/[id]/export-to-proposal/route.ts",
  "src/app/api/dashboard/work-orders/[id]/roster-package/route.ts",
];
for (const pathname of legacyOwnerFallbackRoutes) {
  const body = source(pathname);
  assert.match(body, /user_id IS NULL/, `${pathname} email fallback is not limited to unassigned rows`);
}

const adminWorkOrders = source("src/app/api/admin/work-orders/route.ts");
assert.ok(!adminWorkOrders.includes("wo.intake"), "admin work-order list exposes intake");
assert.ok(!adminWorkOrders.includes("wo.fulfillment_notes"), "admin work-order list exposes fulfillment notes");
assert.ok(!adminWorkOrders.includes("pp.pdf_url,"), "admin work-order list exposes artifact URLs");

const submissionStore = source("src/lib/submissions/store.ts");
const metadataList = submissionStore.slice(
  submissionStore.indexOf("export async function listOrdersForAdmin"),
  submissionStore.indexOf("export async function getAdminOrderAccessContext"),
);
assert.ok(!metadataList.includes("SELECT *"), "admin submission list uses a wildcard select");
assert.ok(!metadataList.includes("so.intake"), "admin submission list exposes intake");
assert.ok(!metadataList.includes("so.deliverables"), "admin submission list exposes deliverables");

const schema = source("src/lib/privacy/schema.ts");
const migration = source("scripts/migrate.mjs");
for (const contract of [
  "vault_upload_receipts",
  "customer_access_grants",
  "customer_access_events",
  "private_blob_migrations",
]) {
  assert.ok(schema.includes(contract), `runtime schema is missing ${contract}`);
  assert.ok(migration.includes(contract), `migration schema is missing ${contract}`);
}

const artifactRoute = source("src/app/api/dashboard/work-orders/[id]/artifact/route.ts");
assert.ok(artifactRoute.includes("requireAuth(request)"), "artifact route is not authenticated");
assert.ok(artifactRoute.includes("getPrivateBlob"), "artifact route does not stream from private storage");

const adminAssessmentDetail = source("src/app/api/admin/assessment-sessions/[id]/route.ts");
assert.ok(!adminAssessmentDetail.includes("a.description,"), "admin assessment detail selects customer narrative");
assert.ok(!adminAssessmentDetail.includes("a.ai_analysis"), "admin assessment detail selects AI profile content");
assert.ok(adminAssessmentDetail.includes("content_locked: true"), "admin assessment detail does not disclose its lock state");

console.log("Sprint 0 security smoke checks passed.");
