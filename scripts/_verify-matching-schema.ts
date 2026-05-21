// Verifies that the Internal Matching Workbench (Phase 1) schema is applied
// correctly. Runs against $DATABASE_URL. Exit 0 on PASS, 1 on FAIL.
//
//   npx tsx scripts/_verify-matching-schema.ts
//
import fs from "node:fs";
try {
  const env = fs.readFileSync(".env.local", "utf-8");
  for (const line of env.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0 && !line.trim().startsWith("#"))
      process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
} catch {}
import { sql } from "../src/lib/db";

const GREEN = "[32m";
const RED = "[31m";
const DIM = "[2m";
const RESET = "[0m";

const checks: Array<{ name: string; pass: boolean; detail: string }> = [];

function check(name: string, pass: boolean, detail = "") {
  checks.push({ name, pass, detail });
}

const EXPECTED = {
  vendor_profiles: {
    columns: [
      "id", "assessment_id", "tier", "ungm_status",
      "contact_name", "contact_email", "contact_phone", "relationship_notes",
      "created_at", "updated_at",
    ],
    indexes: [
      "vendor_profiles_pkey",
      "vendor_profiles_assessment_id_key",
      "vendor_profiles_tier_idx",
    ],
    checks: ["vendor_profiles_tier_chk", "vendor_profiles_ungm_chk"],
  },
  tender_vendor_matches: {
    columns: [
      "id", "tender_id", "assessment_id", "routed_service", "status",
      "fit_reasoning", "outcome", "created_by", "created_at", "updated_at",
    ],
    indexes: [
      "tender_vendor_matches_pkey",
      "tender_vendor_matches_unique",
      "tender_vendor_matches_tender_idx",
      "tender_vendor_matches_assessment_idx",
      "tender_vendor_matches_status_idx",
    ],
    checks: ["tender_vendor_matches_service_chk", "tender_vendor_matches_status_chk"],
  },
};

const EXPECTED_FKS: Array<[string, string, string, string]> = [
  ["vendor_profiles", "assessment_id", "assessments", "id"],
  ["tender_vendor_matches", "tender_id", "tenders", "id"],
  ["tender_vendor_matches", "assessment_id", "assessments", "id"],
  ["tender_vendor_matches", "created_by", "users", "id"],
];

(async () => {
  // 1. Both tables exist.
  const tables = (await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('vendor_profiles','tender_vendor_matches')
  `).map((r) => r.table_name as string);
  check("vendor_profiles table exists", tables.includes("vendor_profiles"));
  check("tender_vendor_matches table exists", tables.includes("tender_vendor_matches"));

  // 2. Per-table column / index / check-constraint verification.
  for (const [table, spec] of Object.entries(EXPECTED)) {
    const cols = (await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${table}
      ORDER BY ordinal_position
    `).map((r) => r.column_name as string);
    const missing = spec.columns.filter((c) => !cols.includes(c));
    const extra = cols.filter((c) => !spec.columns.includes(c));
    check(
      `${table} columns`,
      missing.length === 0 && extra.length === 0,
      missing.length ? `missing: ${missing.join(", ")}` : extra.length ? `unexpected: ${extra.join(", ")}` : `${cols.length} cols`
    );

    const idxs = (await sql`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = ${table}
    `).map((r) => r.indexname as string);
    const missingIdx = spec.indexes.filter((i) => !idxs.includes(i));
    check(
      `${table} indexes`,
      missingIdx.length === 0,
      missingIdx.length ? `missing: ${missingIdx.join(", ")}` : `${idxs.length} idx`
    );

    const conNames = (await sql`
      SELECT conname FROM pg_constraint
      WHERE conrelid = ${table}::regclass AND contype = 'c'
    `).map((r) => r.conname as string);
    const missingChk = spec.checks.filter((c) => !conNames.includes(c));
    check(
      `${table} check constraints`,
      missingChk.length === 0,
      missingChk.length ? `missing: ${missingChk.join(", ")}` : `${conNames.length} checks`
    );
  }

  // 3. Foreign keys point at the right parents.
  const fks = await sql`
    SELECT
      tc.table_name AS child_table,
      kcu.column_name AS child_col,
      ccu.table_name AS parent_table,
      ccu.column_name AS parent_col
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_name IN ('vendor_profiles','tender_vendor_matches')
  `;
  for (const [childTable, childCol, parentTable, parentCol] of EXPECTED_FKS) {
    const ok = fks.some(
      (r) =>
        r.child_table === childTable &&
        r.child_col === childCol &&
        r.parent_table === parentTable &&
        r.parent_col === parentCol
    );
    check(`FK ${childTable}.${childCol} → ${parentTable}.${parentCol}`, ok);
  }

  // 4. New tables empty, but readable (no syntax / permission surprises).
  const vpCount = (await sql`SELECT COUNT(*)::int AS n FROM vendor_profiles`)[0].n as number;
  const tvmCount = (await sql`SELECT COUNT(*)::int AS n FROM tender_vendor_matches`)[0].n as number;
  check("vendor_profiles readable", typeof vpCount === "number", `rows: ${vpCount}`);
  check("tender_vendor_matches readable", typeof tvmCount === "number", `rows: ${tvmCount}`);

  // 5. Existing tables still alive — sanity smoke (Golden Rule: don't break anything).
  const aCount = (await sql`SELECT COUNT(*)::int AS n FROM assessments`)[0].n as number;
  const tCount = (await sql`SELECT COUNT(*)::int AS n FROM tenders`)[0].n as number;
  check("assessments still readable", aCount >= 0, `rows: ${aCount}`);
  check("tenders still readable", tCount >= 0, `rows: ${tCount}`);

  // Report.
  console.log();
  let failed = 0;
  for (const c of checks) {
    const tag = c.pass ? `${GREEN}PASS${RESET}` : `${RED}FAIL${RESET}`;
    const detail = c.detail ? ` ${DIM}${c.detail}${RESET}` : "";
    console.log(`  ${tag}  ${c.name}${detail}`);
    if (!c.pass) failed += 1;
  }
  console.log();
  if (failed === 0) {
    console.log(`${GREEN}All ${checks.length} checks passed.${RESET}`);
    process.exit(0);
  }
  console.log(`${RED}${failed} of ${checks.length} checks failed.${RESET}`);
  process.exit(1);
})().catch((err) => {
  console.error(`${RED}Verification crashed:${RESET}`, err);
  process.exit(1);
});
