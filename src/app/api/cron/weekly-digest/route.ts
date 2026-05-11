import { NextResponse } from "next/server";
import { runWeeklyDigest } from "@/lib/digest/weekly";

export const maxDuration = 300;

function authorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("[api/cron/weekly-digest] CRON_SECRET not configured — refusing request");
    return false;
  }
  return request.headers.get("authorization") === `Bearer ${cronSecret}`;
}

async function handle(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dry_run") === "1";
  const limitParam = Number(url.searchParams.get("limit") ?? "");
  const limit = Number.isFinite(limitParam) && limitParam > 0
    ? Math.min(200, Math.floor(limitParam))
    : 100;

  try {
    return NextResponse.json(await runWeeklyDigest({ dryRun, limit }));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown weekly digest error";
    console.error("[api/cron/weekly-digest]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
