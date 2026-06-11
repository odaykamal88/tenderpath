/* Wizard autosave — the whole intake persists per format server-side (SPEC §3:
 * localStorage in the prototype, server draft in production). One draft per
 * user × type; cleared automatically when the paid order is fulfilled. */

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/subscription-guard";
import { isSubmissionCode } from "@/lib/workbench/pricing";
import type { SubmissionCode, WizardDraftState } from "@/lib/submissions/types";
import { EMPTY_DRAFT } from "@/lib/submissions/types";
import { clearDraft, getDraft, putDraft } from "@/lib/submissions/store";

export const dynamic = "force-dynamic";

function parseType(raw: string): SubmissionCode | null {
  const t = raw.toUpperCase();
  return isSubmissionCode(t) ? (t as SubmissionCode) : null;
}

export async function GET(request: Request, ctx: { params: Promise<{ type: string }> }) {
  const guard = await requireAuth(request);
  if (!guard.authorized) return guard.response!;
  const { type: typeRaw } = await ctx.params;
  const type = parseType(typeRaw);
  if (!type) return NextResponse.json({ error: "Unknown format." }, { status: 400 });
  try {
    const draft = await getDraft(guard.user!.id, type);
    return NextResponse.json({ draft });
  } catch (err) {
    console.error("[tp:submissions:draft_get_failed]", {
      userId: guard.user!.id,
      type,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ draft: EMPTY_DRAFT });
  }
}

export async function PUT(request: Request, ctx: { params: Promise<{ type: string }> }) {
  const guard = await requireAuth(request);
  if (!guard.authorized) return guard.response!;
  const { type: typeRaw } = await ctx.params;
  const type = parseType(typeRaw);
  if (!type) return NextResponse.json({ error: "Unknown format." }, { status: 400 });
  try {
    const body = (await request.json()) as { draft?: Partial<WizardDraftState> };
    const draft: WizardDraftState = { ...EMPTY_DRAFT, ...(body.draft ?? {}) };
    await putDraft(guard.user!.id, type, draft);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[tp:submissions:draft_put_failed]", {
      userId: guard.user!.id,
      type,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Autosave failed." }, { status: 500 });
  }
}

export async function DELETE(request: Request, ctx: { params: Promise<{ type: string }> }) {
  const guard = await requireAuth(request);
  if (!guard.authorized) return guard.response!;
  const { type: typeRaw } = await ctx.params;
  const type = parseType(typeRaw);
  if (!type) return NextResponse.json({ error: "Unknown format." }, { status: 400 });
  try {
    await clearDraft(guard.user!.id, type);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true });
  }
}
