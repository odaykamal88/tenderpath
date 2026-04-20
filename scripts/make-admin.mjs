/**
 * Elevate a user to super-admin by email.
 *
 * Usage:
 *   node scripts/make-admin.mjs oday.kamal@gmail.com
 *
 * Requires DATABASE_URL in environment (copy from .env.local):
 *   DATABASE_URL=postgres://... node scripts/make-admin.mjs your@email.com
 */

import { neon } from "@neondatabase/serverless";

const email = process.argv[2];
if (!email) {
  console.error("Usage: node scripts/make-admin.mjs <email>");
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Run with:\n  DATABASE_URL=postgres://... node scripts/make-admin.mjs " + email);
  process.exit(1);
}

const sql = neon(url);

const rows = await sql`
  UPDATE users
  SET is_super_admin = TRUE
  WHERE email = ${email.toLowerCase().trim()}
  RETURNING id, email, is_super_admin
`;

if (rows.length === 0) {
  console.error(`No user found with email: ${email}`);
  console.error("Sign up first at /login, then run this script.");
  process.exit(1);
}

console.log(`✅ ${rows[0].email} (id: ${rows[0].id}) is now a super admin.`);
