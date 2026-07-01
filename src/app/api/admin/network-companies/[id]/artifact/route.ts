import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/subscription-guard";
import { buildProspectArtifact } from "@/lib/network/artifact";

// Admin-only: generate a prospect's shareable match artifact and log one
// calibration-corpus row per tender. GET previews without a fresh log write;
// POST regenerates and (re)writes the corpus.
export const maxDuration = 60;

async function handle(request: Request, rawId: string, log: boolean) {
  const guard = await requireAdmin(request);
  if (!guard.authorized) return guard.response!;

  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid company id" }, { status: 400 });
  }

  const origin = new URL(request.url).origin;
  const artifact = await buildProspectArtifact(id, { log, origin });
  if (!artifact) {
    return NextResponse.json({ error: "Company not found or profile not ready" }, { status: 404 });
  }

  console.log("[network:artifact:generated]", {
    companyId: id,
    tenders: artifact.tenders.length,
    logged: artifact.logged,
  });
  return NextResponse.json({ artifact }, { status: 200 });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handle(request, id, true);
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handle(request, id, false);
}
