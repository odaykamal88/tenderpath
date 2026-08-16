/* drafting-run.ts — the paid-submission drafting run.
 *
 * Fires post-response (after()) once a submission order is paid. Writes the
 * prose slots, persists them, walks the order intake → drafting → qa → review,
 * and sends the review-ready email — so a paying customer gets a real drafted
 * pack instead of an order that sits in `intake` until someone clicks.
 *
 * Invariants:
 *  · Idempotent. A second call while `generating`, or after `ready`, is a
 *    no-op. Payment already succeeded; drafting must never double-charge
 *    Anthropic or double-send the client email.
 *  · Never blocks delivery. If generation is unavailable (no API key) or fails,
 *    the order still advances and docContent()'s deterministic template stands
 *    in — status records which happened, so it is diagnosable rather than
 *    silent (AGENTS.md: silent no-op is worse than explicit failure).
 *  · Gaps are surfaced, not swallowed. Because release to the client is
 *    automatic, anything the applicant has not evidenced is written into the
 *    event log and the stage note where both ops and the client can see it.
 */

import { sql } from "@/lib/db";
import { applyAdminAction, getOrderForAdmin, OrderStateError } from "./store";
import { generateSubmissionProse, type SubmissionProse } from "./draft-llm";
import { buildResponseOutline } from "./response-outline";
import { generateResponseDraft } from "./response-draft";
import {
  documentsForPrompt,
  loadRequirementDocuments,
} from "@/lib/tender-workspace/requirements-server";
import type { ResponseOutline, TenderPackState } from "@/lib/tender-workspace/types";
import { sendSubmissionReviewReadyEmail } from "./notify";
import type { SubmissionGenerationStatus, SubmissionOrder } from "./types";

export interface DraftingRunResult {
  ok: boolean;
  orderId: number;
  status: SubmissionGenerationStatus;
  slotCount: number;
  gapCount: number;
  released: boolean;
  skippedReason?: string;
}

/** A `generating` row older than this is assumed to belong to a lambda that
 *  died mid-run (Vercel caps the function at 300s). Without this, one crashed
 *  run would strand the order in `generating` forever and no retry could ever
 *  claim it — the same failure the proposal engine reaps with
 *  reapStaleGenerating(). Comfortably above the 300s ceiling. */
const STALE_GENERATING_MINUTES = 10;

/** Claim the run. Returns false when another run already holds it, or when the
 *  order has already been drafted — the guard is the UPDATE's WHERE clause, so
 *  two concurrent lambdas cannot both proceed. */
async function claimRun(orderId: number): Promise<boolean> {
  const rows = await sql`
    UPDATE submission_orders
    SET generation_status = 'generating', updated_at = NOW()
    WHERE id = ${orderId}
      AND stage = 'intake'
      AND (
        generation_status IN ('not_started', 'failed')
        OR (
          generation_status = 'generating'
          AND updated_at < NOW() - (${STALE_GENERATING_MINUTES} * INTERVAL '1 minute')
        )
      )
    RETURNING id
  `;
  return rows.length > 0;
}

async function persistProse(
  orderId: number,
  status: SubmissionGenerationStatus,
  prose: SubmissionProse | null,
): Promise<void> {
  await sql`
    UPDATE submission_orders
    SET generation_status = ${status},
        generated_prose = ${prose ? JSON.stringify(prose) : null}::jsonb,
        updated_at = NOW()
    WHERE id = ${orderId}
  `;
}

/**
 * Try the solicitation-driven path: read the notice's own section list and
 * answer it. Returns true when that produced a response, in which case the
 * format's document pack is replaced.
 *
 * Returns false — normally, not exceptionally — when there is no readable pack,
 * or the notice prescribes no structure. Most notices do not, and the fixed
 * format is the right answer for those.
 */
async function tryOutlineDrivenResponse(
  order: SubmissionOrder,
  companyName: string,
  revision?: { round: number; notes: string },
): Promise<{ used: boolean; gaps: string[] }> {
  const pack = (order.intakeFields as { tenderPack?: TenderPackState })?.tenderPack;
  if (!pack?.documents?.length) return { used: false, gaps: [] };

  let outline: ResponseOutline;
  try {
    outline = await buildResponseOutline({
      userId: order.userId,
      pack,
      tenderTitle: order.tender,
      agency: order.agency,
    });
  } catch (err) {
    // An unreadable pack is an ordinary outcome here (no extracted text yet),
    // not a delivery failure — fall through to the format path.
    console.info("[tp:submissions:outline_unavailable]", {
      orderId: order.id,
      reason: err instanceof Error ? err.message : String(err),
    });
    return { used: false, gaps: [] };
  }

  await sql`
    UPDATE submission_orders
    SET response_outline = ${JSON.stringify(outline)}::jsonb, updated_at = NOW()
    WHERE id = ${order.id}
  `;
  if (outline.sections.length === 0) return { used: false, gaps: [] };

  // Give the writer the solicitation itself, not just the section titles:
  // "which of areas A–E" cannot be answered from a heading.
  let corpus: string | null = null;
  try {
    const { documents } = await loadRequirementDocuments(order.userId, pack);
    corpus = documentsForPrompt(documents);
  } catch {
    corpus = null;
  }

  const draft = await generateResponseDraft({
    order,
    companyName,
    outline,
    corpus,
    revision: revision
      ? { round: revision.round, notes: revision.notes, priorSections: order.responseDraft?.sections ?? [] }
      : undefined,
  });
  if (!draft) return { used: false, gaps: [] };

  // The document set changed, so the deliverable list must change with it —
  // otherwise the drawer lists the format's three files while the reader shows
  // one. Same object drives both surfaces.
  const deliverables = [
    { name: draft.documentTitle, fmt: "PDF", envelope: "technical" as const, status: "ready" as const },
  ];
  await sql`
    UPDATE submission_orders
    SET response_draft = ${JSON.stringify(draft)}::jsonb,
        deliverables = ${JSON.stringify(deliverables)}::jsonb,
        generation_status = 'ready',
        updated_at = NOW()
    WHERE id = ${order.id}
  `;
  console.info("[tp:submissions:outline_response_written]", {
    orderId: order.id,
    ref: order.ref,
    sections: draft.sections.length,
    unevidenced: draft.sections.filter((s) => s.unevidenced).length,
    gaps: draft.gaps.length,
    round: draft.round ?? 0,
  });
  return { used: true, gaps: draft.gaps };
}

async function companyFor(userId: number): Promise<{ name: string; email: string | null }> {
  const rows = await sql`
    SELECT email, name, business_name FROM users WHERE id = ${userId} LIMIT 1
  `;
  const u = rows[0] ?? {};
  return {
    name:
      (u.business_name as string | null)?.trim()
      || (u.name as string | null)?.trim()
      || (u.email as string | null)?.trim()
      || "Customer company",
    email: (u.email as string | null) ?? null,
  };
}

/** Put the evidence gaps on the client-visible timeline. Release is automatic,
 *  so this is the only place the customer learns what is not yet evidenced.
 *  post_note truncates at 400 chars, so each gap is clipped individually rather
 *  than letting the note be cut mid-sentence. */
async function postGapNote(orderId: number, gaps: string[]): Promise<void> {
  const head = `Open evidence gaps (${gaps.length}): `;
  const clipped: string[] = [];
  let budget = 400 - head.length;
  for (const g of gaps) {
    const one = g.length > 110 ? `${g.slice(0, 107)}…` : g;
    if (one.length + 3 > budget) break;
    clipped.push(one);
    budget -= one.length + 3;
  }
  if (clipped.length === 0) return;
  await applyAdminAction(orderId, {
    action: "post_note",
    note: `${head}${clipped.join(" · ")}`,
  }).catch((err) => {
    console.warn("[tp:submissions:gap_note_failed]", {
      orderId,
      err: err instanceof Error ? err.message : String(err),
    });
  });
}

/** Advance one ops step, tolerating an order another actor already moved. */
async function advance(
  orderId: number,
  to: "drafting" | "qa" | "review",
): Promise<SubmissionOrder | null> {
  try {
    return await applyAdminAction(orderId, { action: "advance", to });
  } catch (err) {
    if (err instanceof OrderStateError) {
      console.warn("[tp:submissions:draft_run_advance_skipped]", {
        orderId,
        to,
        code: err.code,
      });
      return null;
    }
    throw err;
  }
}

/**
 * Re-draft after the client requests changes.
 *
 * Without this the revision loop repeats the original bug: `request_changes`
 * moved the order to `revisions`, ops clicked "Revisions applied → re-run QA",
 * and the client got the SAME prose re-released with a fresh "ready" email.
 *
 * Claimed per ROUND, not per order — the guard compares the round already
 * written into `generated_prose` against the order's current round, so a second
 * call for the same round is a no-op while round 2 can still run later.
 */
export async function runSubmissionRevision(orderId: number): Promise<DraftingRunResult> {
  const claimed = await sql`
    UPDATE submission_orders
    SET generation_status = 'generating', updated_at = NOW()
    WHERE id = ${orderId}
      AND stage = 'revisions'
      AND COALESCE((generated_prose->>'round')::int, 0) < round
      AND (
        generation_status <> 'generating'
        OR updated_at < NOW() - (${STALE_GENERATING_MINUTES} * INTERVAL '1 minute')
      )
    RETURNING id, round
  `;
  if (!claimed.length) {
    console.info("[tp:submissions:revision_not_claimed]", { orderId });
    return { ok: false, orderId, status: "ready", slotCount: 0, gapCount: 0, released: false, skippedReason: "already_revised_or_running" };
  }

  const order = await getOrderForAdmin(orderId);
  if (!order) {
    await persistProse(orderId, "failed", null);
    return { ok: false, orderId, status: "failed", slotCount: 0, gapCount: 0, released: false, skippedReason: "order_not_found" };
  }

  const company = await companyFor(order.userId);
  const notes = (order.revisionNotes ?? "").trim();
  console.info("[tp:submissions:revision_run_start]", {
    orderId,
    ref: order.ref,
    round: order.round,
    noteChars: notes.length,
  });

  // A response built from the notice's own outline is revised the same way.
  const outlineRun = await tryOutlineDrivenResponse(order, company.name, {
    round: order.round,
    notes,
  }).catch((err) => {
    console.error("[tp:submissions:outline_revision_threw]", {
      orderId,
      err: err instanceof Error ? err.message : String(err),
    });
    return { used: false, gaps: [] as string[] };
  });

  let prose: SubmissionProse | null = null;
  if (outlineRun.used) {
    // Keep the round marker on generated_prose so claimRun stays idempotent.
    await persistProse(orderId, "ready", {
      ...(order.generatedProse ?? { slots: {}, claims: [], gaps: [], model: "outline", generatedAt: new Date().toISOString() }),
      gaps: outlineRun.gaps,
      round: order.round,
    });
  } else {
    try {
      prose = await generateSubmissionProse({
        order,
        companyName: company.name,
        revision: {
          round: order.round,
          notes,
          priorSlots: order.generatedProse?.slots ?? {},
        },
      });
    } catch (err) {
      console.error("[tp:submissions:revision_generate_threw]", {
        orderId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // A failed revision must not silently re-release the prior prose as if the
  // notes had been applied — leave the round unconsumed so it can be retried.
  if (!outlineRun.used && !prose) {
    await persistProse(orderId, "failed", order.generatedProse);
    console.warn("[tp:submissions:revision_failed]", { orderId, ref: order.ref, round: order.round });
    return { ok: false, orderId, status: "failed", slotCount: 0, gapCount: 0, released: false, skippedReason: "generation_unavailable" };
  }

  if (prose) await persistProse(orderId, "ready", prose);
  const gaps = outlineRun.used ? outlineRun.gaps : prose?.gaps ?? [];

  await advance(orderId, "qa");
  if (gaps.length > 0) await postGapNote(orderId, gaps);
  const released = await advance(orderId, "review");

  if (released) {
    try {
      await sendSubmissionReviewReadyEmail(released, company.email);
    } catch (err) {
      console.error("[tp:submissions:revision_email_failed]", {
        orderId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  console.info("[tp:submissions:revision_run_done]", {
    orderId,
    ref: order.ref,
    round: order.round,
    slotCount: prose ? Object.keys(prose.slots).length : 0,
    gapCount: gaps.length,
    released: Boolean(released),
  });

  return {
    ok: true,
    orderId,
    status: "ready",
    slotCount: prose ? Object.keys(prose.slots).length : 0,
    gapCount: gaps.length,
    released: Boolean(released),
  };
}

export async function runSubmissionDrafting(orderId: number): Promise<DraftingRunResult> {
  const claimed = await claimRun(orderId);
  if (!claimed) {
    console.info("[tp:submissions:draft_run_not_claimed]", { orderId });
    return { ok: false, orderId, status: "not_started", slotCount: 0, gapCount: 0, released: false, skippedReason: "already_running_or_done" };
  }

  const order = await getOrderForAdmin(orderId);
  if (!order) {
    await persistProse(orderId, "failed", null);
    return { ok: false, orderId, status: "failed", slotCount: 0, gapCount: 0, released: false, skippedReason: "order_not_found" };
  }

  const company = await companyFor(order.userId);
  console.info("[tp:submissions:draft_run_start]", {
    orderId,
    ref: order.ref,
    type: order.type,
    requirements: Array.isArray((order.intakeFields as { tenderRequirements?: { items?: unknown[] } })?.tenderRequirements?.items)
      ? (order.intakeFields as { tenderRequirements: { items: unknown[] } }).tenderRequirements.items.length
      : 0,
  });

  // Preferred path: let the notice dictate the document. Falls through to the
  // format's fixed slots when the notice prescribes no structure.
  const outlineRun = await tryOutlineDrivenResponse(order, company.name).catch((err) => {
    console.error("[tp:submissions:outline_run_threw]", {
      orderId,
      err: err instanceof Error ? err.message : String(err),
    });
    return { used: false, gaps: [] as string[] };
  });

  let prose: SubmissionProse | null = null;
  if (!outlineRun.used) {
    try {
      prose = await generateSubmissionProse({ order, companyName: company.name });
    } catch (err) {
      console.error("[tp:submissions:draft_run_generate_threw]", {
        orderId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
    await persistProse(orderId, prose ? "ready" : "skipped", prose);
  }

  const status: SubmissionGenerationStatus = outlineRun.used || prose ? "ready" : "skipped";
  const slotCount = outlineRun.used ? 0 : prose ? Object.keys(prose.slots).length : 0;
  const gaps = outlineRun.used ? outlineRun.gaps : prose?.gaps ?? [];

  // Walk to the client. Each step re-reads the order, so the qa → review seal
  // picks up the prose persisted above.
  await advance(orderId, "drafting");
  await advance(orderId, "qa");

  if (gaps.length > 0) await postGapNote(orderId, gaps);

  const released = await advance(orderId, "review");

  if (released) {
    try {
      await sendSubmissionReviewReadyEmail(released, company.email);
    } catch (err) {
      console.error("[tp:submissions:draft_run_email_failed]", {
        orderId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  console.info("[tp:submissions:draft_run_done]", {
    orderId,
    ref: order.ref,
    status,
    slotCount,
    gapCount: gaps.length,
    released: Boolean(released),
  });

  return {
    ok: true,
    orderId,
    status,
    slotCount,
    gapCount: gaps.length,
    released: Boolean(released),
    skippedReason: prose ? undefined : "generation_unavailable",
  };
}
