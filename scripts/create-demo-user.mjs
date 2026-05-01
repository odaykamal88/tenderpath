/**
 * Seed (or refresh) the shared demo account.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/create-demo-user.mjs
 *
 * Creates demo@tenderpath.me with password TenderDemo2025! and
 * activates a pro subscription so the full dashboard is accessible.
 */

import { neon } from "@neondatabase/serverless";
import { randomBytes, scrypt as scryptCallback } from "crypto";
import { promisify } from "util";

const scrypt = promisify(scryptCallback);

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const DEMO_EMAIL = "demo@tenderpath.me";
const DEMO_PASSWORD = "TenderDemo2025!";

async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

const sql = neon(url);
const hash = await hashPassword(DEMO_PASSWORD);
const now = new Date().toISOString();

const rows = await sql`
  INSERT INTO users (email, password_hash, subscription_status, tier, trial_start_date, created_at)
  VALUES (
    ${DEMO_EMAIL},
    ${hash},
    'active',
    'pro',
    ${now},
    ${now}
  )
  ON CONFLICT (email) DO UPDATE SET
    password_hash       = EXCLUDED.password_hash,
    subscription_status = 'active',
    tier                = 'pro'
  RETURNING id, email, subscription_status, tier
`;

const u = rows[0];
console.log(`✅ Demo account ready: ${u.email} (id: ${u.id}, tier: ${u.tier}, status: ${u.subscription_status})`);
console.log(`   Email:    ${DEMO_EMAIL}`);
console.log(`   Password: ${DEMO_PASSWORD}`);
