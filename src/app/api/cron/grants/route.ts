import { NextResponse } from "next/server";
import { refreshGrantInventory } from "@/lib/grants/sync";

export const maxDuration = 300;

function authorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return true;
  return request.headers.get("authorization") === `Bearer ${cronSecret}`;
}

async function handle(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dry_run") === "1";
  const euLimit = Number(url.searchParams.get("eu_limit") ?? "");
  const undpLimit = Number(url.searchParams.get("undp_limit") ?? "");
  const unWomenLimit = Number(url.searchParams.get("unwomen_limit") ?? "");

  try {
    const result = await refreshGrantInventory({
      dryRun,
      euLimit: Number.isFinite(euLimit) && euLimit > 0 ? euLimit : undefined,
      undpLimit: Number.isFinite(undpLimit) && undpLimit > 0 ? undpLimit : undefined,
      unWomenLimit: Number.isFinite(unWomenLimit) && unWomenLimit > 0 ? unWomenLimit : undefined,
    });
    const status = result.ok ? 200 : 502;
    return NextResponse.json(result, { status });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown grant refresh error";
    console.error("[api/cron/grants]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
