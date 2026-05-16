import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";
import { buildServiceEvidencePack } from "@/lib/service-evidence-pack";

type JsonRecord = Record<string, unknown>;

interface WorkOrderRow extends JsonRecord {
  id: number;
  user_id?: number | null;
  plan: string;
  service_slug: string | null;
  status: string;
  payment_status: string | null;
  amount_cents: number | null;
  currency: string | null;
  email?: string | null;
  pipeline_item_id: number | null;
  tender_title: string | null;
  agency: string | null;
  tender_url: string | null;
  intake: JsonRecord | null;
  tender_deadline: string | null;
  fit_score: number | null;
  pipeline_stage: string | null;
  fulfillment_notes: string | null;
  created_at: string;
  updated_at: string;
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function appendFulfillmentNote(existing: string | null, note: string): string {
  if (!existing?.trim()) return note;
  if (existing.includes(note)) return existing;
  return `${existing.trim()}\n\n${note}`;
}

async function loadWorkOrder(userId: number, id: number): Promise<WorkOrderRow | null> {
  const rows = await sql`
    SELECT
      wo.id, wo.user_id, wo.plan, wo.service_slug, wo.status, wo.payment_status,
      wo.amount_cents, wo.currency, wo.email, wo.pipeline_item_id,
      wo.tender_title, wo.agency, wo.tender_url, wo.intake,
      wo.fulfillment_notes, wo.created_at, wo.updated_at,
      pi.tender_deadline, pi.fit_score, pi.stage AS pipeline_stage,
      pi.match_reasons
    FROM work_orders wo
    LEFT JOIN pipeline_items pi ON pi.id = wo.pipeline_item_id
    WHERE wo.user_id = ${userId} AND wo.id = ${id}
    LIMIT 1
  ` as unknown as WorkOrderRow[];

  return rows[0] ?? null;
}

function mergeIntake(existing: JsonRecord | null, patch: JsonRecord): JsonRecord {
  const next: JsonRecord = { ...(existing ?? {}), ...patch };
  const existingEvidence = asRecord(existing?.evidence_pack_documents);
  const patchEvidence = asRecord(patch.evidence_pack_documents);
  if (patchEvidence) {
    next.evidence_pack_documents = {
      ...(existingEvidence ?? {}),
      ...patchEvidence,
    };
  }
  return next;
}

function refreshEvidencePack(order: WorkOrderRow, intake: JsonRecord): JsonRecord {
  const pack = buildServiceEvidencePack({
    serviceSlug: order.service_slug ?? order.plan,
    intake,
    tenderSourceAvailable: Boolean(order.tender_url),
    targetAgency: stringOrNull(intake.target_agency) ?? order.agency,
    targetCategory: stringOrNull(intake.target_category),
    contextText: [
      order.tender_title,
      order.agency,
      order.tender_url,
      stringOrNull(intake.tender_context),
      stringOrNull(intake.requirement_scope),
      stringOrNull(intake.additional_details),
    ].filter(Boolean).join(" "),
  });
  const serviceContext = asRecord(intake.service_context);

  return {
    ...intake,
    evidence_pack: pack,
    ...(serviceContext
      ? { service_context: { ...serviceContext, evidence_pack: pack } }
      : {}),
  };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAuth(request);
  if (!guard.authorized) return guard.response!;

  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    return NextResponse.json({ error: "Invalid work order id" }, { status: 400 });
  }

  const workOrder = await loadWorkOrder(guard.user!.id, numericId);

  if (!workOrder) {
    return NextResponse.json({ error: "Work order not found" }, { status: 404 });
  }

  return NextResponse.json({ workOrder });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAuth(request);
  if (!guard.authorized) return guard.response!;

  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    return NextResponse.json({ error: "Invalid work order id" }, { status: 400 });
  }

  const body = await request.json().catch(() => null) as { intake?: JsonRecord } | null;
  const intakePatch = asRecord(body?.intake);
  if (!intakePatch) {
    return NextResponse.json({ error: "intake object is required" }, { status: 400 });
  }

  const current = await loadWorkOrder(guard.user!.id, numericId);
  if (!current) {
    return NextResponse.json({ error: "Work order not found" }, { status: 404 });
  }

  const nextIntake = refreshEvidencePack(current, mergeIntake(current.intake, intakePatch));
  const pack = asRecord(nextIntake.evidence_pack);
  const packStatus = stringOrNull(pack?.status);
  const shouldResume = current.status === "waiting_on_client" && packStatus === "ready";
  const status = shouldResume ? "in_progress" : current.status;
  const fulfillmentNotes = shouldResume
    ? appendFulfillmentNote(
        current.fulfillment_notes,
        "Evidence pack complete; customer proof received. Ready for fulfillment QA.",
      )
    : current.fulfillment_notes;

  await sql`
    UPDATE work_orders
    SET
      intake = ${JSON.stringify(nextIntake)}::jsonb,
      status = ${status},
      fulfillment_notes = ${fulfillmentNotes},
      updated_at = NOW()
    WHERE id = ${numericId} AND user_id = ${guard.user!.id}
  `;

  const updated = await loadWorkOrder(guard.user!.id, numericId);
  if (!updated) {
    return NextResponse.json({ error: "Work order not found" }, { status: 404 });
  }

  return NextResponse.json({
    workOrder: updated,
    evidence_pack_status: packStatus,
    resumed: shouldResume,
  });
}
