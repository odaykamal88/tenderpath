/**
 * /dev/proposal-preview/[name] — Sprint 6 dev-only visual verification.
 *
 * The dashboard route at /dashboard/proposals/[workOrderId] sits behind two
 * gates that make local-without-DATABASE_URL verification impossible:
 *
 *   1. proxy.ts (Next 16 middleware) 307s any /dashboard/* without a
 *      tp_session JWT cookie.
 *   2. dashboard/layout.tsx (client component) ALSO bounces to /login
 *      when localStorage.tp_token is absent.
 *
 * The MEMORY entry "Local dev runs without DATABASE_URL" calls this out
 * as the convention — verify on Vercel preview, not localhost. Sprint 6
 * widens that gap: the new B1-B5 page is the whole reason we're shipping
 * the sprint, and waiting on a preview deploy just to look at it is too
 * slow a feedback loop.
 *
 * This route sits OUTSIDE /dashboard so proxy.ts line 58 (the catch-all
 * "not /api/ and not /dashboard → public") lets it through, and the
 * dashboard client layout doesn't apply (so no localStorage gate either).
 * It reads the fixture file from tests/fixtures/sprint6-page/ via fs and
 * hands the parsed output to a client child that renders the same B1-B5
 * components the dashboard page uses (imported from the dashboard page
 * file directly — those components are now exported for this reason).
 *
 * Hard-gated on NODE_ENV !== "production" so the route returns notFound()
 * in prod even if Next.js somehow served the page (it shouldn't — the
 * /dev/ prefix is excluded from any deployment matcher we'd set).
 *
 * Production read-side of the new B1-B5 page lands as Sprint 6b
 * (generator switch + lazy re-run on first GET for legacy rows).
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { notFound } from "next/navigation";

import PreviewClient from "./PreviewClient";
import type { ProposalOutputJSON } from "@/app/dashboard/proposals/[workOrderId]/scored-view";

const FIXTURE_DIR = "tests/fixtures/sprint6-page";

export const dynamic = "force-dynamic"; // never cache; this is a dev tool

export default async function DevProposalPreview({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();

  const { name } = await params;
  if (!/^[a-z0-9-]+$/i.test(name)) notFound();

  const fixturePath = join(process.cwd(), FIXTURE_DIR, `${name}.json`);
  let output: ProposalOutputJSON;
  try {
    const raw = await readFile(fixturePath, "utf8");
    output = JSON.parse(raw) as ProposalOutputJSON;
  } catch (err) {
    return (
      <div className="min-h-screen bg-stone-50 px-8 py-10 max-w-4xl mx-auto">
        <h1 className="text-[24px] font-medium text-stone-900">Fixture not found</h1>
        <p className="mt-3 text-[13.5px] text-stone-700">
          Could not load <code className="rounded bg-stone-100 px-1.5 py-0.5">{fixturePath}</code>
        </p>
        <p className="mt-3 text-[13px] text-stone-600">
          Generate it with: <code className="rounded bg-stone-100 px-1.5 py-0.5">npx tsx scripts/sprint6-acceptance.ts</code>
        </p>
        <p className="mt-3 text-[12px] text-stone-500">
          {err instanceof Error ? err.message : String(err)}
        </p>
      </div>
    );
  }

  return <PreviewClient name={name} output={output} />;
}
