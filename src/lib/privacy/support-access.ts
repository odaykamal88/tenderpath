import { sql } from "@/lib/db";
import { ensureCustomerPrivacySchema } from "./schema";

const MAX_GRANT_HOURS = 7 * 24;

export interface SupportAccessOrder {
  workOrderId: number;
  label: string;
  plan: string;
  status: string;
  paymentStatus: string | null;
  createdAt: string;
  grantId: number | null;
  purpose: string | null;
  grantedAt: string | null;
  expiresAt: string | null;
}

export interface ActiveSupportAccess {
  grantId: number;
  ownerUserId: number;
  workOrderId: number;
  purpose: string;
  expiresAt: string;
}

function iso(value: unknown): string | null {
  if (!value) return null;
  const date = new Date(value as string | Date);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function listSupportAccessOrders(ownerUserId: number): Promise<SupportAccessOrder[]> {
  await ensureCustomerPrivacySchema();
  const rows = await sql`
    SELECT
      wo.id,
      COALESCE(NULLIF(wo.tender_title, ''), NULLIF(wo.service_slug, ''), wo.plan, 'Work order #' || wo.id::text) AS label,
      wo.plan,
      wo.status,
      wo.payment_status,
      wo.created_at,
      grant_row.id AS grant_id,
      grant_row.purpose,
      grant_row.granted_at,
      grant_row.expires_at
    FROM work_orders wo
    LEFT JOIN LATERAL (
      SELECT id, purpose, granted_at, expires_at
      FROM customer_access_grants
      WHERE owner_user_id = ${ownerUserId}
        AND work_order_id = wo.id
        AND revoked_at IS NULL
        AND expires_at > NOW()
      ORDER BY granted_at DESC
      LIMIT 1
    ) grant_row ON TRUE
    WHERE wo.user_id = ${ownerUserId}
      AND (wo.payment_status = 'paid' OR wo.status <> 'new' OR wo.payment_proof_url IS NOT NULL)
    ORDER BY wo.created_at DESC
    LIMIT 100
  `;

  return rows.map((row) => ({
    workOrderId: Number(row.id),
    label: String(row.label),
    plan: String(row.plan),
    status: String(row.status),
    paymentStatus: row.payment_status == null ? null : String(row.payment_status),
    createdAt: iso(row.created_at) ?? new Date(0).toISOString(),
    grantId: row.grant_id == null ? null : Number(row.grant_id),
    purpose: row.purpose == null ? null : String(row.purpose),
    grantedAt: iso(row.granted_at),
    expiresAt: iso(row.expires_at),
  }));
}

export async function grantSupportAccess(args: {
  ownerUserId: number;
  workOrderId: number;
  durationHours: number;
  purpose: string;
}): Promise<ActiveSupportAccess | null> {
  await ensureCustomerPrivacySchema();
  const requestedHours = Number.isFinite(args.durationHours) ? args.durationHours : 72;
  const durationHours = Math.min(MAX_GRANT_HOURS, Math.max(1, Math.round(requestedHours)));
  const purpose = args.purpose.trim().slice(0, 500);
  if (!purpose) return null;

  const owned = await sql`
    SELECT id
    FROM work_orders
    WHERE id = ${args.workOrderId} AND user_id = ${args.ownerUserId}
    LIMIT 1
  `;
  if (!owned.length) return null;

  await sql`
    UPDATE customer_access_grants
    SET revoked_at = NOW(), updated_at = NOW()
    WHERE owner_user_id = ${args.ownerUserId}
      AND work_order_id = ${args.workOrderId}
      AND revoked_at IS NULL
      AND expires_at > NOW()
  `;

  const rows = await sql`
    INSERT INTO customer_access_grants (
      owner_user_id, work_order_id, purpose, expires_at
    ) VALUES (
      ${args.ownerUserId}, ${args.workOrderId}, ${purpose}, NOW() + (${durationHours} * INTERVAL '1 hour')
    )
    RETURNING id, owner_user_id, work_order_id, purpose, expires_at
  `;
  const row = rows[0];

  await recordSupportAccessEvent({
    ownerUserId: args.ownerUserId,
    workOrderId: args.workOrderId,
    actorUserId: args.ownerUserId,
    eventType: "grant_created",
    purpose,
    metadata: { durationHours },
  });

  return {
    grantId: Number(row.id),
    ownerUserId: Number(row.owner_user_id),
    workOrderId: Number(row.work_order_id),
    purpose: String(row.purpose),
    expiresAt: iso(row.expires_at) ?? new Date().toISOString(),
  };
}

export async function revokeSupportAccess(args: {
  ownerUserId: number;
  workOrderId: number;
}): Promise<boolean> {
  await ensureCustomerPrivacySchema();
  const rows = await sql`
    UPDATE customer_access_grants
    SET revoked_at = NOW(), updated_at = NOW()
    WHERE owner_user_id = ${args.ownerUserId}
      AND work_order_id = ${args.workOrderId}
      AND revoked_at IS NULL
      AND expires_at > NOW()
    RETURNING id, purpose
  `;
  if (!rows.length) return false;

  await recordSupportAccessEvent({
    ownerUserId: args.ownerUserId,
    workOrderId: args.workOrderId,
    actorUserId: args.ownerUserId,
    eventType: "grant_revoked",
    purpose: String(rows[0].purpose ?? "Customer revoked access"),
    metadata: { grantId: Number(rows[0].id) },
  });
  return true;
}

export async function activeSupportAccess(
  ownerUserId: number,
  workOrderId: number,
): Promise<ActiveSupportAccess | null> {
  await ensureCustomerPrivacySchema();
  const rows = await sql`
    SELECT id, owner_user_id, work_order_id, purpose, expires_at
    FROM customer_access_grants
    WHERE owner_user_id = ${ownerUserId}
      AND work_order_id = ${workOrderId}
      AND revoked_at IS NULL
      AND expires_at > NOW()
    ORDER BY granted_at DESC
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    grantId: Number(row.id),
    ownerUserId: Number(row.owner_user_id),
    workOrderId: Number(row.work_order_id),
    purpose: String(row.purpose),
    expiresAt: iso(row.expires_at) ?? new Date().toISOString(),
  };
}

export async function recordSupportAccessEvent(args: {
  ownerUserId: number;
  workOrderId: number;
  actorUserId: number | null;
  eventType: "grant_created" | "grant_revoked" | "content_read" | "content_write" | "access_denied";
  purpose?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await ensureCustomerPrivacySchema();
  await sql`
    INSERT INTO customer_access_events (
      owner_user_id, work_order_id, actor_user_id, event_type, purpose, metadata
    ) VALUES (
      ${args.ownerUserId}, ${args.workOrderId}, ${args.actorUserId}, ${args.eventType},
      ${args.purpose ?? null}, ${JSON.stringify(args.metadata ?? {})}::jsonb
    )
  `;
}

export async function listSupportAccessEvents(ownerUserId: number) {
  await ensureCustomerPrivacySchema();
  const rows = await sql`
    SELECT id, work_order_id, actor_user_id, event_type, purpose, metadata, occurred_at
    FROM customer_access_events
    WHERE owner_user_id = ${ownerUserId}
    ORDER BY occurred_at DESC
    LIMIT 100
  `;
  return rows.map((row) => ({
    id: Number(row.id),
    workOrderId: Number(row.work_order_id),
    actorUserId: row.actor_user_id == null ? null : Number(row.actor_user_id),
    eventType: String(row.event_type),
    purpose: row.purpose == null ? null : String(row.purpose),
    metadata: row.metadata && typeof row.metadata === "object" ? row.metadata : {},
    occurredAt: iso(row.occurred_at) ?? new Date(0).toISOString(),
  }));
}
