/**
 * One-shot cleanup: existing grants rows came from fake seed data
 * with fabricated source URLs that 404. Purge anything without a
 * reference_id.
 */
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env.local") });

const sql = neon(process.env.DATABASE_URL);

async function run() {
  const before = await sql`SELECT count(*)::int AS n FROM grants`;
  const deleted = await sql`
    DELETE FROM grants
    WHERE reference_id IS NULL
    RETURNING id
  `;
  const after = await sql`SELECT count(*)::int AS n FROM grants`;
  console.log(`Grants before: ${before[0].n}`);
  console.log(`Deleted:       ${deleted.length}`);
  console.log(`Grants after:  ${after[0].n}`);
}

run().catch((err) => {
  console.error("Purge failed:", err);
  process.exit(1);
});
