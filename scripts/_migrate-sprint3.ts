/**
 * Sprint 3 DB migration — run once against production.
 *
 * Adds:
 *   assessments.include_consultancies  BOOLEAN DEFAULT FALSE
 *
 * Safe to re-run (uses IF NOT EXISTS / idempotent DDL).
 */

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

(async () => {
  console.log("Running Sprint 3 migration…");

  await sql`
    ALTER TABLE assessments
      ADD COLUMN IF NOT EXISTS include_consultancies BOOLEAN NOT NULL DEFAULT FALSE
  `;
  console.log("  ✓ assessments.include_consultancies added (or already exists)");

  console.log("Migration complete.");
  process.exit(0);
})().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
