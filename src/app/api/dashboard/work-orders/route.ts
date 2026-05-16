import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";
import { buildServiceEvidencePack, type ServiceEvidencePack } from "@/lib/service-evidence-pack";

const STATUSES = new Set(["new", "in_progress", "waiting_on_client", "delivered", "canceled"]);
const PAID_SERVICE_PLANS = new Set(["bid-no-bid", "proposal", "proposal-draft", "lta-roster", "roster-fast-track"]);

type JsonRecord = Record<string, unknown>;

type WorkOrderRow = JsonRecord & {
  plan?: string | null;
  service_slug?: string | null;
  tender_title?: string | null;
  agency?: string | null;
  tender_url?: string | null;
  intake?: JsonRecord | null;
};

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isEvidencePack(value: unknown): value is ServiceEvidencePack {
  const record = asRecord(value);
  return Boolean(
    record
      && record.version === "sprint6-service-evidence-pack-v1"
      && Array.isArray(record.requirements),
  );
}

function evidencePackForRow(row: WorkOrderRow): ServiceEvidencePack | null {
  const service = row.service_slug ?? row.plan ?? null;
  if (!service || !PAID_SERVICE_PLANS.has(service)) return null;

  const intake = asRecord(row.intake) ?? null;
  const serviceContext = asRecord(intake?.service_context);
  const storedPack = serviceContext?.evidence_pack ?? intake?.evidence_pack;
  if (isEvidencePack(storedPack)) return storedPack;

  return buildServiceEvidencePack({
    serviceSlug: service,
    intake,
    tenderSourceAvailable: Boolean(row.tender_url),
    targetAgency: stringOrNull(intake?.target_agency) ?? stringOrNull(row.agency),
    targetCategory: stringOrNull(intake?.target_category),
    contextText: [
      row.tender_title,
      row.agency,
      row.tender_url,
      stringOrNull(intake?.tender_context),
      stringOrNull(intake?.requirement_scope),
      stringOrNull(intake?.additional_details),
    ].filter(Boolean).join(" "),
  });
}

function withEvidenceSummary(row: WorkOrderRow): JsonRecord {
  const pack = evidencePackForRow(row);
  if (!pack) return row;

  return {
    ...row,
    evidence_pack_status: pack.status,
    evidence_pack_score: pack.score_0_10,
    evidence_pack_missing_required: pack.missing_required.map((item) => item.label).slice(0, 6),
  };
}

export async function GET(request: Request) {
  const guard = await requireAuth(request);
  if (!guard.authorized) return guard.response!;

  const user = guard.user!;
  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const limitRaw = Number(url.searchParams.get("limit") ?? "20");
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 50) : 20;

  const rows = status && STATUSES.has(status)
    ? await sql`
        SELECT
          wo.id, wo.plan, wo.service_slug, wo.status, wo.payment_status,
          wo.amount_cents, wo.currency, wo.email, wo.pipeline_item_id,
          wo.tender_title, wo.agency, wo.tender_url, wo.intake,
          wo.fulfillment_notes, wo.created_at, wo.updated_at,
          pi.tender_deadline, pi.fit_score, pi.stage AS pipeline_stage
        FROM work_orders wo
        LEFT JOIN pipeline_items pi ON pi.id = wo.pipeline_item_id
        WHERE wo.user_id = ${user.id} AND wo.status = ${status}
        ORDER BY wo.created_at DESC
        LIMIT ${limit}
      `
    : await sql`
        SELECT
          wo.id, wo.plan, wo.service_slug, wo.status, wo.payment_status,
          wo.amount_cents, wo.currency, wo.email, wo.pipeline_item_id,
          wo.tender_title, wo.agency, wo.tender_url, wo.intake,
          wo.fulfillment_notes, wo.created_at, wo.updated_at,
          pi.tender_deadline, pi.fit_score, pi.stage AS pipeline_stage
        FROM work_orders wo
        LEFT JOIN pipeline_items pi ON pi.id = wo.pipeline_item_id
        WHERE wo.user_id = ${user.id}
        ORDER BY wo.created_at DESC
        LIMIT ${limit}
      `;

  return NextResponse.json({ workOrders: (rows as WorkOrderRow[]).map(withEvidenceSummary) });
}
