/* GET /api/admin/waitlist — invite requests captured from the invite-only
 * landing page (waitlist_signups). Super-admin only, same guard as the other
 * admin endpoints. Self-heals the table so the view doesn't 500 before the
 * first signup. */

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.authorized) return guard.response!;

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS waitlist_signups (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        source TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    const [signups, countRows] = await Promise.all([
      sql`
        SELECT id, email, source, created_at
        FROM waitlist_signups
        ORDER BY created_at DESC
        LIMIT 500
      `,
      sql`SELECT COUNT(*)::int AS n FROM waitlist_signups`,
    ]);
    const total = (countRows[0]?.n as number) ?? signups.length;
    return NextResponse.json({ signups, total });
  } catch (err) {
    console.error("[tp:admin:waitlist:load_failed]", {
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Failed to load invite requests" }, { status: 500 });
  }
}
