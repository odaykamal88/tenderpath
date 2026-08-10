import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();

function source(pathname: string): string {
  return readFileSync(resolve(root, pathname), "utf8");
}

const health = source("src/app/api/health/route.ts");
assert.match(health, /if \(!deep\)/, "shallow health must remain independent of crawler-worker health");
assert.match(health, /status: "unreachable"/, "deep health must expose crawler-worker failure");
assert.match(health, /httpStatus: degraded \? 503 : 200/, "deep health must fail explicitly when a load-bearing dependency is degraded");

const workbench = source("src/app/api/dashboard/workbench/route.ts");
assert.match(workbench, /\[workbench:submissions:load_failed\]/, "submission read failures must be logged");
assert.match(workbench, /assessmentStatus: report\.status/, "failed or computing assessments must reach the client as explicit state");
assert.match(workbench, /return \[\];/, "a submission read failure must preserve the stored assessment view");

const provider = source("src/components/workbench/WorkbenchProvider.tsx");
assert.match(provider, /setFatal\(/, "workbench fetch failures must become visible client state");
assert.match(provider, /Retry/, "the workbench must expose a retry seam");

const submissions = source("src/app/api/dashboard/submission-orders/route.ts");
assert.match(submissions, /\[tp:submissions:list_failed\]/, "submission list failures must be diagnosable");
assert.match(submissions, /status: 500/, "submission list failures must not return a silent empty success");

const matchesPage = source("src/components/workbench/pages/MatchesPage.tsx");
assert.match(matchesPage, /href=\{m\.sourceUrl\}/, "a matched tender must expose its primary-source link");
assert.match(matchesPage, /target="_blank"/, "the primary source must not replace the rehearsed dashboard tab");

const reset = source("scripts/diha-demo-reset.ts");
assert.match(reset, /const apply = args\.has\("--apply"\)/, "fixture restore must default to a dry run");
assert.match(reset, /email === PUBLIC_DEMO_EMAIL/, "fixture restore must refuse the public demo account");
assert.match(reset, /confirmEmail !== email/, "fixture restore must require the exact private tenant confirmation");

const runbook = source("docs/demo/diha-walkthrough-runbook.md");
for (const forbiddenAction of ["payment", "model generation", "email delivery", "approve", "final-submit"]) {
  assert.ok(runbook.includes(forbiddenAction), `runbook is missing the ${forbiddenAction} failure boundary`);
}
assert.match(runbook, /within 20 seconds/, "runbook must define a bounded fallback decision");

console.log("DIHA failure-seam contract checks passed.");
