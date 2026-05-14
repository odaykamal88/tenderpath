import { sql } from "@/lib/db";
import type { User } from "@/lib/types";
import { buildServiceContextPacket, mergeServiceContextIntoIntake } from "@/lib/service-context";

export type ServiceSlug = "bid-no-bid" | "digest" | "proposal" | "lta-roster";

export const SERVICE_TO_PLAN: Record<ServiceSlug, string> = {
  "bid-no-bid": "bid-no-bid",
  digest: "grants-tenders-matching",
  proposal: "proposal-draft",
  "lta-roster": "roster-fast-track",
};

export function isServiceSlug(value: unknown): value is ServiceSlug {
  return value === "bid-no-bid" || value === "digest" || value === "proposal" || value === "lta-roster";
}

function clean(value: unknown, max = 500): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

const LONG_INTAKE_TEXT_KEYS = new Set([
  "tender_context",
  "additional_details",
  "package_notes",
  "supplementary_notes",
]);

function cleanIntake(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, raw]) => {
      if (typeof raw === "string") {
        const max = LONG_INTAKE_TEXT_KEYS.has(key) ? 12_000 : 2_000;
        return [key, raw.trim().slice(0, max)];
      }
      if (typeof raw === "boolean") return [key, raw];
      if (Array.isArray(raw)) {
        return [key, raw.filter((item) => typeof item === "string").map((item) => item.trim().slice(0, 300)).filter(Boolean)];
      }
      return [key, raw ?? null];
    }),
  );
}

export async function createServiceWorkOrder(
  user: User,
  body: {
    service?: unknown;
    pipeline_item_id?: unknown;
    tender_title?: unknown;
    agency?: unknown;
    tender_url?: unknown;
    intake?: unknown;
  },
) {
  if (!isServiceSlug(body.service)) {
    throw new Error("Invalid service");
  }

  const pipelineItemIdRaw = typeof body.pipeline_item_id === "number" || typeof body.pipeline_item_id === "string"
    ? String(body.pipeline_item_id)
    : "";
  const pipelineItemId = /^\d+$/.test(pipelineItemIdRaw) ? Number(pipelineItemIdRaw) : null;
  type PipelineItemContext = {
    id: number;
    tender_title: string;
    tender_agency: string | null;
  };
  let pipelineItem: PipelineItemContext | null = null;

  if (pipelineItemId) {
    const rows = await sql`
      SELECT id, tender_title, tender_agency
      FROM pipeline_items
      WHERE id = ${pipelineItemId} AND user_id = ${user.id}
      LIMIT 1
    `;
    if (!rows.length) {
      throw new Error("Pipeline item not found");
    }
    pipelineItem = rows[0] as PipelineItemContext;
  }

  const tenderTitle = clean(body.tender_title) ?? pipelineItem?.tender_title ?? null;
  const agency = clean(body.agency) ?? pipelineItem?.tender_agency ?? null;
  const tenderUrl = clean(body.tender_url, 1000);
  const intake = cleanIntake(body.intake);
  const serviceContext = await buildServiceContextPacket({
    userId: user.id,
    userEmail: user.email,
    serviceSlug: body.service,
    pipelineItemId,
    tenderTitle,
    agency,
    tenderUrl,
    intake,
  });
  const intakeJson = JSON.stringify(mergeServiceContextIntoIntake(intake, serviceContext));
  const plan = SERVICE_TO_PLAN[body.service];

  const rows = await sql`
    INSERT INTO work_orders (
      user_id, plan, service_slug, status, payment_status, email,
      pipeline_item_id, tender_title, agency, tender_url, intake
    ) VALUES (
      ${user.id}, ${plan}, ${body.service}, 'new', 'pending', ${user.email},
      ${pipelineItemId}, ${tenderTitle}, ${agency}, ${tenderUrl}, ${intakeJson}::jsonb
    )
    RETURNING *
  `;

  return rows[0];
}
