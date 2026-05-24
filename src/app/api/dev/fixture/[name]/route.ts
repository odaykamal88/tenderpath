/**
 * /api/dev/fixture/[name] — dev-only fixture loader for Sprint 6 visual verification.
 *
 * Returns a typed ProposalPackage JSON from tests/fixtures/sprint6-page/.
 * Hard-gated on NODE_ENV: in production this route returns 404, period.
 * Used by /dashboard/proposals/[workOrderId]?fixture=unicef-scored to render
 * the new B1-B5 page against engine-produced output without needing the
 * production generator switch (which lands in Sprint 6b).
 *
 * The fixture file itself is produced by scripts/sprint6-acceptance.ts
 * which runs the Sprint 4.6 revision-loop on the UNICEF tender, packages
 * the result into the proposal_packages.output shape, and writes it here.
 */

import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";

const FIXTURE_DIR = "tests/fixtures/sprint6-page";

export async function GET(
  _request: Request,
  context: { params: Promise<{ name: string }> },
): Promise<NextResponse> {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production" }, { status: 404 });
  }

  const { name } = await context.params;
  if (!/^[a-z0-9-]+$/i.test(name)) {
    return NextResponse.json({ error: "Invalid fixture name" }, { status: 400 });
  }

  const fixturePath = join(process.cwd(), FIXTURE_DIR, `${name}.json`);
  try {
    const raw = await readFile(fixturePath, "utf8");
    return new NextResponse(raw, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: `Fixture "${name}" not found at ${fixturePath}`,
        hint: "Run `npx tsx scripts/sprint6-acceptance.ts` to generate it.",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 404 },
    );
  }
}
