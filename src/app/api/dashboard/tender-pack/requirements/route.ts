import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/subscription-guard";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import type { WizardDraftState } from "@/lib/submissions/types";
import type { TenderPackState } from "@/lib/tender-workspace/types";
import {
  generateTenderRequirements,
  TenderRequirementsInputError,
} from "@/lib/tender-workspace/requirements-server";
import {
  sanitizeTenderPackForUser,
  TenderPackOwnershipError,
} from "@/lib/tender-workspace/ownership";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

interface RequirementsBody {
  tender?: WizardDraftState["tender"];
  tenderPack?: TenderPackState;
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  let userId: number | null = null;
  let documentCount = 0;

  try {
    const guard = await requireAuth(request);
    if (!guard.authorized) return guard.response!;
    userId = guard.user!.id;
    const limited = enforceRateLimit(request, {
      namespace: "tender-requirements",
      limit: 10,
      windowMs: 60 * 60 * 1_000,
      keyParts: [userId],
    });
    if (limited) return limited;

    const body = (await request.json().catch(() => null)) as RequirementsBody | null;
    if (!body?.tender?.title?.trim()) {
      return NextResponse.json({ error: "Select a tender first." }, { status: 400 });
    }
    const tenderPack = await sanitizeTenderPackForUser(userId, body.tenderPack);
    documentCount = tenderPack.documents.length;
    console.log("[tender-requirements:started]", {
      userId,
      documentCount,
    });
    const requirements = await generateTenderRequirements({
      userId,
      tender: body.tender,
      pack: tenderPack,
    });
    console.log("[tender-requirements:generated]", {
      userId,
      documentCount,
      requirementCount: requirements.items.length,
      generationStatus: requirements.generationStatus,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ requirements });
  } catch (error) {
    if (error instanceof TenderPackOwnershipError) {
      console.warn("[tender-requirements:pack_forbidden]", { userId, documentCount });
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof TenderRequirementsInputError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 422 },
      );
    }
    console.error("[tender-requirements:route_failed]", {
      userId,
      documentCount,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Could not build the compliance map. Your saved tender files were not changed." },
      { status: 500 },
    );
  }
}
