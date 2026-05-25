import { NextResponse, after } from "next/server";
import { requireAuth } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";
import {
  mineProfileFactsFromIntake,
  mergeMinedFacts,
  type MinedProfileFacts,
} from "@/lib/applicant-evidence/profile-miner";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAuth(request);
  if (!guard.authorized) return guard.response!;

  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    return NextResponse.json({ error: "Invalid work order id" }, { status: 400 });
  }

  const rows = await sql`
    SELECT
      wo.id, wo.plan, wo.service_slug, wo.status, wo.payment_status,
      wo.amount_cents, wo.currency, wo.email, wo.pipeline_item_id,
      wo.tender_title, wo.agency, wo.tender_url, wo.intake,
      wo.fulfillment_notes, wo.created_at, wo.updated_at,
      pi.tender_deadline, pi.fit_score, pi.stage AS pipeline_stage,
      pi.match_reasons
    FROM work_orders wo
    LEFT JOIN pipeline_items pi ON pi.id = wo.pipeline_item_id
    WHERE wo.user_id = ${guard.user!.id} AND wo.id = ${numericId}
    LIMIT 1
  `;

  if (!rows.length) {
    return NextResponse.json({ error: "Work order not found" }, { status: 404 });
  }

  return NextResponse.json({ workOrder: rows[0] });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAuth(request);
  if (!guard.authorized) return guard.response!;

  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    return NextResponse.json({ error: "Invalid work order id" }, { status: 400 });
  }

  const body = await request.json().catch(() => null) as { intake?: Record<string, string> } | null;
  if (!body?.intake || typeof body.intake !== "object") {
    return NextResponse.json({ error: "intake object is required" }, { status: 400 });
  }

  // Merge new intake fields into existing JSONB without overwriting unchanged keys
  const rows = await sql`
    UPDATE work_orders
    SET
      intake = COALESCE(intake, '{}'::jsonb) || ${JSON.stringify(body.intake)}::jsonb,
      updated_at = NOW()
    WHERE id = ${numericId} AND user_id = ${guard.user!.id}
    RETURNING id, intake, updated_at
  `;

  if (!rows.length) {
    return NextResponse.json({ error: "Work order not found" }, { status: 404 });
  }

  // Sprint 8e: free-text intake mining. Run a Haiku pass on the merged intake
  // to extract structured profile facts (years_of_experience, sectors_covered,
  // agencies_worked_with, geographic_reach, key_capabilities) and merge them
  // into users.mined_profile_facts. These are CLAIMS, not EVIDENCE — the
  // engine treats them as inferred fallbacks, not evidenced requirement
  // matches. Subsequent engine runs read mined_profile_facts to fill empty
  // ApplicantContext fields the user hasn't supplied via the wizard.
  //
  // Wrapped in after() so the user's PATCH returns immediately; the miner
  // (one Haiku call, ~1-2s) runs post-response and is non-fatal. Mining only
  // fires when the merged intake has free-text material worth processing —
  // mineProfileFactsFromIntake guards on MIN_TEXT_CHARS internally.
  const userId = guard.user!.id;
  const fullIntake = (rows[0] as { intake: Record<string, unknown> }).intake;
  after(async () => {
    try {
      const fresh = await mineProfileFactsFromIntake(fullIntake);
      if (!fresh) return; // not enough text, or LLM failed — miner already logged

      const priorRows = await sql`
        SELECT mined_profile_facts FROM users WHERE id = ${userId} LIMIT 1
      ` as unknown as Array<{ mined_profile_facts: MinedProfileFacts | null }>;
      const prior = priorRows[0]?.mined_profile_facts ?? {};
      const merged = mergeMinedFacts(prior, fresh);

      await sql`
        UPDATE users
        SET mined_profile_facts = ${JSON.stringify(merged)}::jsonb,
            updated_at = NOW()
        WHERE id = ${userId}
      `;
      console.log("[applicant-evidence:profile_miner:merged]", {
        userId,
        workOrderId: numericId,
        priorKeys: Object.keys(prior).length,
        freshKeys: Object.keys(fresh).length,
        mergedKeys: Object.keys(merged).length,
      });
    } catch (err) {
      console.warn("[applicant-evidence:profile_miner:after_failed]", {
        userId,
        workOrderId: numericId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return NextResponse.json({ workOrder: rows[0] });
}
