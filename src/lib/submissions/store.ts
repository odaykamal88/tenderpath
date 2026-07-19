/* Submission orders — persistence + the guarded state machine.
 *
 * One shared order object drives the vendor dashboard and the ops queue
 * (prototype: sub-store.js / localStorage `tp_sub_orders_v2`; production: this
 * table + the API routes). Every transition appends to events[] — the log is
 * the truth. Concurrency is last-write-wins on guarded UPDATEs: a transition
 * whose WHERE stage = expected matches 0 rows means the order just changed
 * under the caller — surface that, never silently clobber (SPEC §9).
 *
 * Schema lives in BOTH scripts/migrate.mjs and ensureSubmissionsSchema() below
 * (launch-discipline rule 5: migrate doesn't auto-run on deploy). */

import { sql } from "@/lib/db";
import type {
  AdminOrderAction,
  ClientOrderAction,
  SubmissionBlocker,
  SubmissionCode,
  SubmissionDeliverable,
  SubmissionEvent,
  SubmissionArtifactVersion,
  SubmissionOrder,
  SubmissionStage,
  WizardDraftState,
} from "./types";
import { EMPTY_DRAFT } from "./types";
import { docContent } from "./doc-content";
import { canTransition, DEFAULT_STAGE_NOTE, OPS_ACTIONS } from "./stages";
import { shepherdSteps } from "./flows";

let ensurePromise: Promise<void> | null = null;

/** Idempotent runtime self-heal — mirrors the scripts/migrate.mjs block. */
export async function ensureSubmissionsSchema(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS submission_orders (
          id SERIAL PRIMARY KEY,
          ref TEXT UNIQUE,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          work_order_id INTEGER,
          type TEXT NOT NULL,
          price_cents INTEGER NOT NULL DEFAULT 0,
          currency TEXT NOT NULL DEFAULT 'usd',
          tender TEXT NOT NULL,
          agency TEXT,
          source TEXT,
          portal TEXT,
          tender_id INTEGER,
          pipeline_item_id INTEGER,
          due DATE,
          value TEXT,
          fit INTEGER,
          stage TEXT NOT NULL DEFAULT 'intake',
          pct INTEGER NOT NULL DEFAULT 0,
          round INTEGER NOT NULL DEFAULT 0,
          stage_note TEXT,
          sla_mins INTEGER NOT NULL DEFAULT 60,
          completeness INTEGER NOT NULL DEFAULT 0,
          blockers JSONB NOT NULL DEFAULT '[]'::jsonb,
          intake JSONB NOT NULL DEFAULT '[]'::jsonb,
          intake_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
          deliverables JSONB NOT NULL DEFAULT '[]'::jsonb,
          events JSONB NOT NULL DEFAULT '[]'::jsonb,
          artifact_versions JSONB NOT NULL DEFAULT '[]'::jsonb,
          revision_notes TEXT,
          amendments JSONB NOT NULL DEFAULT '[]'::jsonb,
          qna JSONB NOT NULL DEFAULT '[]'::jsonb,
          outcome JSONB NOT NULL DEFAULT '{"state":"pending"}'::jsonb,
          shepherd JSONB NOT NULL DEFAULT '{"checked":[]}'::jsonb,
          paid_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `;
      await sql`ALTER TABLE submission_orders ADD COLUMN IF NOT EXISTS artifact_versions JSONB NOT NULL DEFAULT '[]'::jsonb`;
      await sql`CREATE INDEX IF NOT EXISTS submission_orders_user_idx ON submission_orders (user_id, updated_at DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS submission_orders_stage_idx ON submission_orders (stage, updated_at DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS submission_orders_wo_idx ON submission_orders (work_order_id)`;
      await sql`
        CREATE TABLE IF NOT EXISTS submission_drafts (
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          type TEXT NOT NULL,
          draft JSONB NOT NULL DEFAULT '{}'::jsonb,
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          PRIMARY KEY (user_id, type)
        )
      `;
    })().catch((err) => {
      ensurePromise = null;
      throw err;
    });
  }
  return ensurePromise;
}

/* ── Row mapping ───────────────────────────────────────────────────────── */

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function iso(v: unknown): string | null {
  if (!v) return null;
  const d = new Date(v as string | Date);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Display ref, stable per order — also the inbound-mail local part later. */
export function submissionRef(id: number): string {
  return `TP-${2000 + id}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rowToOrder(row: Record<string, any>): SubmissionOrder {
  const outcome = row.outcome && typeof row.outcome === "object" ? row.outcome : { state: "pending" };
  const shepherd = row.shepherd && typeof row.shepherd === "object" ? row.shepherd : { checked: [] };
  return {
    id: row.id,
    ref: row.ref ?? submissionRef(row.id),
    userId: row.user_id,
    workOrderId: row.work_order_id ?? null,
    type: row.type as SubmissionCode,
    priceCents: row.price_cents ?? 0,
    currency: row.currency ?? "usd",
    tender: row.tender ?? "",
    agency: row.agency ?? null,
    source: row.source ?? null,
    portal: row.portal ?? null,
    tenderId: row.tender_id ?? null,
    pipelineItemId: row.pipeline_item_id ?? null,
    due: row.due ? String(row.due).slice(0, 10) : null,
    value: row.value ?? null,
    fit: row.fit ?? null,
    stage: row.stage as SubmissionStage,
    pct: row.pct ?? 0,
    round: row.round ?? 0,
    stageNote: row.stage_note ?? null,
    slaMins: row.sla_mins ?? 60,
    completeness: row.completeness ?? 0,
    blockers: asArray<SubmissionBlocker>(row.blockers),
    intake: asArray<[string, string]>(row.intake),
    intakeFields: row.intake_fields && typeof row.intake_fields === "object" ? row.intake_fields : {},
    deliverables: asArray<SubmissionDeliverable>(row.deliverables),
    events: asArray<SubmissionEvent>(row.events),
    artifactVersions: asArray<SubmissionArtifactVersion>(row.artifact_versions),
    revisionNotes: row.revision_notes ?? null,
    amendments: asArray(row.amendments),
    qna: asArray(row.qna),
    outcome: { state: "pending", ...outcome },
    shepherd: { checked: [], ...shepherd },
    paidAt: iso(row.paid_at),
    createdAt: iso(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: iso(row.updated_at) ?? new Date(0).toISOString(),
  };
}

function event(label: string, by: "client" | "ops"): SubmissionEvent {
  return { at: new Date().toISOString(), label, by };
}

/** Append events through jsonb concat so concurrent appends never lose one. */
async function appendEvents(orderId: number, events: SubmissionEvent[]): Promise<void> {
  await sql`
    UPDATE submission_orders
    SET events = events || ${JSON.stringify(events)}::jsonb, updated_at = NOW()
    WHERE id = ${orderId}
  `;
}

/* ── Commission (pre-payment) ──────────────────────────────────────────── */

export interface PendingOrderInput {
  userId: number;
  type: SubmissionCode;
  priceCents: number;
  tender: string;
  agency: string | null;
  source: string | null;
  portal: string | null;
  tenderId: number | null;
  pipelineItemId: number | null;
  due: string | null;
  value: string | null;
  fit: number | null;
  completeness: number;
  slaMins: number;
  blockers: SubmissionBlocker[];
  intake: [string, string][];
  intakeFields: Record<string, unknown>;
  deliverables: SubmissionDeliverable[];
}

/** Create (or refresh) the unpaid order for this user × type × tender. The
 *  order goes live — visible to ops, SLA clock running — only at paid_at. */
export async function upsertPendingOrder(input: PendingOrderInput): Promise<SubmissionOrder> {
  await ensureSubmissionsSchema();

  const existing = await sql`
    SELECT id FROM submission_orders
    WHERE user_id = ${input.userId} AND type = ${input.type} AND tender = ${input.tender}
      AND paid_at IS NULL
    ORDER BY id DESC
    LIMIT 1
  `;

  const blockers = JSON.stringify(input.blockers);
  const intake = JSON.stringify(input.intake);
  const intakeFields = JSON.stringify(input.intakeFields);
  const deliverables = JSON.stringify(input.deliverables);

  if (existing.length > 0) {
    const id = existing[0].id as number;
    const rows = await sql`
      UPDATE submission_orders
      SET price_cents = ${input.priceCents},
          agency = ${input.agency}, source = ${input.source}, portal = ${input.portal},
          tender_id = ${input.tenderId}, pipeline_item_id = ${input.pipelineItemId},
          due = ${input.due}, value = ${input.value}, fit = ${input.fit},
          completeness = ${input.completeness},
          sla_mins = ${input.slaMins},
          blockers = ${blockers}::jsonb,
          intake = ${intake}::jsonb,
          intake_fields = ${intakeFields}::jsonb,
          deliverables = ${deliverables}::jsonb,
          updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;
    return rowToOrder(rows[0]);
  }

  const flags = input.blockers.length;
  const intakeEvent = JSON.stringify([
    event(`Intake completed — ${input.completeness}% complete, ${flags} flag${flags === 1 ? "" : "s"}`, "client"),
  ]);
  const rows = await sql`
    INSERT INTO submission_orders (
      user_id, type, price_cents, tender, agency, source, portal,
      tender_id, pipeline_item_id, due, value, fit,
      stage, completeness, sla_mins, blockers, intake, intake_fields, deliverables, events
    ) VALUES (
      ${input.userId}, ${input.type}, ${input.priceCents}, ${input.tender}, ${input.agency},
      ${input.source}, ${input.portal}, ${input.tenderId}, ${input.pipelineItemId},
      ${input.due}, ${input.value}, ${input.fit},
      'intake', ${input.completeness}, ${input.slaMins}, ${blockers}::jsonb, ${intake}::jsonb,
      ${intakeFields}::jsonb, ${deliverables}::jsonb, ${intakeEvent}::jsonb
    )
    RETURNING *
  `;
  const id = rows[0].id as number;
  const ref = submissionRef(id);
  await sql`UPDATE submission_orders SET ref = ${ref} WHERE id = ${id}`;
  return rowToOrder({ ...rows[0], ref });
}

export async function linkWorkOrder(orderId: number, workOrderId: number): Promise<void> {
  await sql`
    UPDATE submission_orders SET work_order_id = ${workOrderId}, updated_at = NOW()
    WHERE id = ${orderId}
  `;
}

/** Payment seam — called from createWorkOrderFromCheckout when the paid work
 *  order is linked to a submission order. Starts the SLA clock, appends the
 *  order-placed event, and clears the wizard draft. Idempotent. */
export async function markSubmissionOrderPaidByWorkOrder(
  workOrderId: number,
  amountCents: number | null,
  currency: string | null,
): Promise<SubmissionOrder | null> {
  await ensureSubmissionsSchema();
  const rows = await sql`
    UPDATE submission_orders
    SET paid_at = NOW(),
        price_cents = COALESCE(${amountCents}, price_cents),
        currency = COALESCE(${currency}, currency),
        pct = 8,
        stage_note = ${DEFAULT_STAGE_NOTE.intake},
        updated_at = NOW()
    WHERE work_order_id = ${workOrderId} AND paid_at IS NULL
    RETURNING *
  `;
  if (rows.length === 0) return null;
  const order = rowToOrder(rows[0]);
  const paid = amountCents === 0 ? "first-submission credit applied" : `$${Math.round(order.priceCents / 100)} paid`;
  await appendEvents(order.id, [event(`Order placed · ${paid}`, "client")]);
  await clearDraft(order.userId, order.type).catch(() => {});
  return order;
}

export async function getOrderByWorkOrder(workOrderId: number): Promise<SubmissionOrder | null> {
  await ensureSubmissionsSchema();
  const rows = await sql`SELECT * FROM submission_orders WHERE work_order_id = ${workOrderId} LIMIT 1`;
  return rows.length ? rowToOrder(rows[0]) : null;
}

/* ── Reads ─────────────────────────────────────────────────────────────── */

export async function getOrderForUser(userId: number, id: number): Promise<SubmissionOrder | null> {
  await ensureSubmissionsSchema();
  const rows = await sql`
    SELECT * FROM submission_orders WHERE id = ${id} AND user_id = ${userId} LIMIT 1
  `;
  return rows.length ? rowToOrder(rows[0]) : null;
}

export async function listOrdersForUser(userId: number): Promise<SubmissionOrder[]> {
  await ensureSubmissionsSchema();
  const rows = await sql`
    SELECT * FROM submission_orders
    WHERE user_id = ${userId} AND (paid_at IS NOT NULL OR updated_at > NOW() - INTERVAL '7 days')
    ORDER BY (stage = 'submitted') ASC, updated_at DESC
    LIMIT 100
  `;
  return rows.map(rowToOrder);
}

export interface AdminOrderRow extends SubmissionOrder {
  userEmail: string | null;
  userBusiness: string | null;
  hasContentAccess: boolean;
  contentAccessExpiresAt: string | null;
  contentLoaded: boolean;
}

/**
 * Ops queue metadata only. Intake, evidence, blockers, Q&A, revisions and
 * deliverables are deliberately omitted; an admin must use the detail route,
 * which verifies a live customer grant and records the read.
 */
export async function listOrdersForAdmin(): Promise<AdminOrderRow[]> {
  await ensureSubmissionsSchema();
  const rows = await sql`
    SELECT
      so.id, so.ref, so.user_id, so.work_order_id, so.type, so.price_cents,
      so.currency, so.tender, so.agency, so.source, so.portal, so.tender_id,
      so.pipeline_item_id, so.due, so.value, so.fit, so.stage, so.pct, so.round,
      so.stage_note, so.sla_mins, so.completeness, so.paid_at, so.created_at,
      so.updated_at,
      u.email AS user_email,
      u.business_name AS user_business,
      grant_row.expires_at AS content_access_expires_at
    FROM submission_orders so
    LEFT JOIN users u ON u.id = so.user_id
    LEFT JOIN LATERAL (
      SELECT expires_at
      FROM customer_access_grants
      WHERE owner_user_id = so.user_id
        AND work_order_id = so.work_order_id
        AND revoked_at IS NULL
        AND expires_at > NOW()
      ORDER BY granted_at DESC
      LIMIT 1
    ) grant_row ON TRUE
    WHERE so.paid_at IS NOT NULL
    ORDER BY (so.stage = 'submitted') ASC, so.paid_at DESC
    LIMIT 200
  `;
  return rows.map((r) => ({
    ...rowToOrder(r),
    userEmail: (r.user_email as string | null) ?? null,
    userBusiness: (r.user_business as string | null) ?? null,
    hasContentAccess: Boolean(r.content_access_expires_at),
    contentAccessExpiresAt: iso(r.content_access_expires_at),
    contentLoaded: false,
  }));
}

export async function getAdminOrderAccessContext(orderId: number): Promise<{
  ownerUserId: number;
  workOrderId: number | null;
} | null> {
  await ensureSubmissionsSchema();
  const rows = await sql`
    SELECT user_id, work_order_id
    FROM submission_orders
    WHERE id = ${orderId}
    LIMIT 1
  `;
  if (!rows.length) return null;
  return {
    ownerUserId: Number(rows[0].user_id),
    workOrderId: rows[0].work_order_id == null ? null : Number(rows[0].work_order_id),
  };
}

export async function getOrderForAdmin(orderId: number): Promise<SubmissionOrder | null> {
  await ensureSubmissionsSchema();
  const rows = await sql`SELECT * FROM submission_orders WHERE id = ${orderId} LIMIT 1`;
  return rows.length ? rowToOrder(rows[0]) : null;
}

/* ── Guarded transitions ───────────────────────────────────────────────── */

export class OrderStateError extends Error {
  code: "ORDER_CHANGED" | "INVALID_ACTION" | "NOT_FOUND";
  constructor(code: "ORDER_CHANGED" | "INVALID_ACTION" | "NOT_FOUND", message: string) {
    super(message);
    this.code = code;
  }
}

function deliverableStatusFor(stage: SubmissionStage): SubmissionDeliverable["status"] | null {
  switch (stage) {
    case "drafting": return "drafting";
    case "qa": return "drafted";
    case "review": return "ready";
    case "submitted": return "submitted";
    default: return null;
  }
}

async function transition(
  orderId: number,
  actor: "ops" | "client",
  from: SubmissionStage,
  to: SubmissionStage,
  patch: {
    pct?: number;
    round?: number;
    stageNote?: string | null;
    revisionNotes?: string | null;
    deliverables?: SubmissionDeliverable[] | null;
    shepherd?: Record<string, unknown> | null;
    outcome?: Record<string, unknown> | null;
    artifactVersions?: SubmissionArtifactVersion[] | null;
  },
  eventLabel: string,
): Promise<SubmissionOrder> {
  if (!canTransition(actor, from, to)) {
    throw new OrderStateError("INVALID_ACTION", `Cannot move ${from} → ${to} as ${actor}.`);
  }
  const note = patch.stageNote === undefined ? DEFAULT_STAGE_NOTE[to] : patch.stageNote;
  const rows = await sql`
    UPDATE submission_orders
    SET stage = ${to},
        pct = COALESCE(${patch.pct ?? null}, pct),
        round = COALESCE(${patch.round ?? null}, round),
        stage_note = ${note},
        revision_notes = COALESCE(${patch.revisionNotes ?? null}, revision_notes),
        deliverables = COALESCE(${patch.deliverables ? JSON.stringify(patch.deliverables) : null}::jsonb, deliverables),
        shepherd = COALESCE(${patch.shepherd ? JSON.stringify(patch.shepherd) : null}::jsonb, shepherd),
        outcome = COALESCE(${patch.outcome ? JSON.stringify(patch.outcome) : null}::jsonb, outcome),
        artifact_versions = COALESCE(${patch.artifactVersions ? JSON.stringify(patch.artifactVersions) : null}::jsonb, artifact_versions),
        updated_at = NOW()
    WHERE id = ${orderId} AND stage = ${from}
    RETURNING *
  `;
  if (rows.length === 0) {
    throw new OrderStateError("ORDER_CHANGED", "This order just changed — reload and retry.");
  }
  await appendEvents(orderId, [event(eventLabel, actor === "ops" ? "ops" : "client")]);
  return rowToOrder({ ...rows[0] });
}

/* ── Client actions ────────────────────────────────────────────────────── */

export async function applyClientAction(
  userId: number,
  orderId: number,
  action: ClientOrderAction,
): Promise<SubmissionOrder> {
  await ensureSubmissionsSchema();
  const order = await getOrderForUser(userId, orderId);
  if (!order) throw new OrderStateError("NOT_FOUND", "Order not found.");

  switch (action.action) {
    case "approve": {
      return transition(orderId, "client", "review", "final", {
        pct: 100,
        deliverables: order.deliverables.map((d) => ({ ...d, status: "ready" as const })),
      }, "Draft approved — preparing final submission pack");
    }
    case "request_changes": {
      const notes = action.notes?.trim();
      if (!notes) throw new OrderStateError("INVALID_ACTION", "Describe the changes you need.");
      const round = order.round + 1;
      return transition(orderId, "client", "review", "revisions", {
        round,
        revisionNotes: notes,
        pct: 80,
        stageNote: `Revision round ${round} — applying your notes`,
      }, `Changes requested (round ${round}): “${notes.length > 80 ? `${notes.slice(0, 80)}…` : notes}”`);
    }
    case "submit_final": {
      const required = shepherdSteps(order.type, order.portal, order.due).map((s) => s.id);
      const missing = required.filter((id) => !order.shepherd.checked.includes(id));
      if (missing.length > 0) {
        throw new OrderStateError("INVALID_ACTION", "Complete every step of the submission checklist first.");
      }
      const receipt = action.receipt?.trim() || null;
      const deliverables = order.deliverables.map((d) => ({ ...d, status: "submitted" as const }));
      return transition(orderId, "client", "final", "submitted", {
        deliverables,
        shepherd: { ...order.shepherd, receipt },
        outcome: { state: "pending" },
        stageNote: `Submitted · receipt ${receipt || "on file"} · decision pending`,
      }, `Submitted via ${order.portal || "the agency's channel"}${receipt ? ` · receipt ${receipt}` : ""}`);
    }
    case "shepherd_toggle": {
      const checked = new Set(order.shepherd.checked);
      if (action.done) checked.add(action.item);
      else checked.delete(action.item);
      const rows = await sql`
        UPDATE submission_orders
        SET shepherd = ${JSON.stringify({ ...order.shepherd, checked: [...checked] })}::jsonb,
            updated_at = NOW()
        WHERE id = ${orderId} AND user_id = ${userId}
        RETURNING *
      `;
      if (!rows.length) throw new OrderStateError("ORDER_CHANGED", "This order just changed — reload and retry.");
      return rowToOrder(rows[0]);
    }
    case "lodge_qna": {
      const q = action.q?.trim();
      if (!q) throw new OrderStateError("INVALID_ACTION", "Write the question first.");
      const entry = { at: new Date().toISOString(), src: "lodged", q };
      const rows = await sql`
        UPDATE submission_orders
        SET qna = qna || ${JSON.stringify([entry])}::jsonb, updated_at = NOW()
        WHERE id = ${orderId} AND user_id = ${userId}
        RETURNING *
      `;
      if (!rows.length) throw new OrderStateError("NOT_FOUND", "Order not found.");
      await appendEvents(orderId, [event("Clarification lodged with the agency (anonymously, in procurement language).", "client")]);
      return rowToOrder(rows[0]);
    }
    case "forward_agency_mail": {
      const text = action.text?.trim();
      if (!text) throw new OrderStateError("INVALID_ACTION", "Paste the agency message first.");
      const entry = {
        at: new Date().toISOString(),
        src: "forward",
        q: text.slice(0, 2000),
        via: action.via?.trim()?.slice(0, 160) || null,
      };
      const rows = await sql`
        UPDATE submission_orders
        SET qna = qna || ${JSON.stringify([entry])}::jsonb, updated_at = NOW()
        WHERE id = ${orderId} AND user_id = ${userId}
        RETURNING *
      `;
      if (!rows.length) throw new OrderStateError("NOT_FOUND", "Order not found.");
      await appendEvents(orderId, [event("Agency message forwarded — we check it against the draft.", "client")]);
      return rowToOrder(rows[0]);
    }
    case "request_debrief": {
      if (order.outcome.state !== "lost" || order.outcome.debrief) {
        throw new OrderStateError("INVALID_ACTION", "Debrief requests apply to lost submissions only.");
      }
      const outcome = {
        ...order.outcome,
        debrief: { state: "requested", requestedAt: new Date().toISOString(), lessons: [] },
      };
      const rows = await sql`
        UPDATE submission_orders
        SET outcome = ${JSON.stringify(outcome)}::jsonb, updated_at = NOW()
        WHERE id = ${orderId} AND user_id = ${userId}
        RETURNING *
      `;
      if (!rows.length) throw new OrderStateError("NOT_FOUND", "Order not found.");
      await appendEvents(orderId, [
        event("Debrief requested from the agency — you're entitled to know why.", "client"),
      ]);
      return rowToOrder(rows[0]);
    }
    case "ack_blocker": {
      const blockers = order.blockers.map((b) =>
        b.id === action.blockerId && b.state === "open"
          ? { ...b, state: "acknowledged" as const, note: "Proceeding at risk — flagged in the draft." }
          : b,
      );
      const rows = await sql`
        UPDATE submission_orders
        SET blockers = ${JSON.stringify(blockers)}::jsonb, updated_at = NOW()
        WHERE id = ${orderId} AND user_id = ${userId}
        RETURNING *
      `;
      if (!rows.length) throw new OrderStateError("NOT_FOUND", "Order not found.");
      return rowToOrder(rows[0]);
    }
  }
}

/* ── Admin actions ─────────────────────────────────────────────────────── */

export async function applyAdminAction(
  orderId: number,
  action: AdminOrderAction,
): Promise<SubmissionOrder> {
  await ensureSubmissionsSchema();
  const rows = await sql`SELECT * FROM submission_orders WHERE id = ${orderId} LIMIT 1`;
  if (!rows.length) throw new OrderStateError("NOT_FOUND", "Order not found.");
  const order = rowToOrder(rows[0]);

  switch (action.action) {
    case "advance": {
      const opsAction = OPS_ACTIONS[order.stage];
      if (!opsAction || opsAction.next !== action.to) {
        throw new OrderStateError("INVALID_ACTION", `Cannot move ${order.stage} → ${action.to} as ops.`);
      }
      const status = deliverableStatusFor(action.to);
      const deliverables = status
        ? order.deliverables.map((d) => ({ ...d, status }))
        : null;
      const pct = action.to === "review" || action.to === "qa" ? 100 : action.to === "drafting" ? Math.max(order.pct, 8) : undefined;
      const isQARelease = order.stage === "qa";
      const stageNote = action.to === "review" ? "Draft pack ready for your review" : opsAction.note;
      let artifactVersions: SubmissionArtifactVersion[] | null = null;
      if (action.to === "review") {
        const userRows = await sql`
          SELECT email, name, business_name
          FROM users
          WHERE id = ${order.userId}
          LIMIT 1
        `;
        const user = userRows[0] ?? {};
        const generatedAt = new Date().toISOString();
        const revision = order.round + 1;
        const releasedOrder: SubmissionOrder = {
          ...order,
          stage: "review",
          pct: 100,
          stageNote,
          updatedAt: generatedAt,
        };
        const version: SubmissionArtifactVersion = {
          revision,
          generatedAt,
          basedOnRevisionNotes: order.revisionNotes,
          intakeFields: structuredClone(order.intakeFields),
          documents: docContent(releasedOrder, {
            name:
              (user.business_name as string | null)?.trim()
              || (user.name as string | null)?.trim()
              || (user.email as string | null)?.trim()
              || "Customer company",
            signatory:
              (user.name as string | null)?.trim()
              || (user.email as string | null)?.trim()
              || "Authorized representative",
          }),
        };
        artifactVersions = [...order.artifactVersions, version];
      }
      return transition(
        orderId,
        "ops",
        order.stage,
        action.to,
        { pct, deliverables, stageNote, artifactVersions },
        `${opsAction.note}${isQARelease ? " (34-point checklist)" : ""}`,
      );
    }
    case "set_progress": {
      if (order.stage !== "drafting" && order.stage !== "revisions") {
        throw new OrderStateError("INVALID_ACTION", "Progress applies to drafting/revisions stages.");
      }
      const pct = Math.max(0, Math.min(99, Math.round(action.pct)));
      const updated = await sql`
        UPDATE submission_orders
        SET pct = ${pct}, stage_note = COALESCE(${action.stageNote ?? null}, stage_note), updated_at = NOW()
        WHERE id = ${orderId} AND stage = ${order.stage}
        RETURNING *
      `;
      if (!updated.length) throw new OrderStateError("ORDER_CHANGED", "This order just changed — reload and retry.");
      return rowToOrder(updated[0]);
    }
    case "post_note": {
      const note = action.note?.trim();
      if (!note) throw new OrderStateError("INVALID_ACTION", "Write the note first.");
      await appendEvents(orderId, [event(note.slice(0, 400), "ops")]);
      const fresh = await sql`SELECT * FROM submission_orders WHERE id = ${orderId} LIMIT 1`;
      return rowToOrder(fresh[0]);
    }
    case "record_outcome": {
      if (order.stage !== "submitted") {
        throw new OrderStateError("INVALID_ACTION", "Outcomes are recorded on submitted orders.");
      }
      const outcome = {
        ...order.outcome,
        state: action.state,
        decidedAt: action.decidedAt ?? new Date().toISOString(),
        scores: action.scores ?? order.outcome.scores ?? [],
      };
      const stageNote =
        action.state === "lost"
          ? "Not selected — debrief available on request"
          : action.state === "won"
            ? "Awarded — contracting next"
            : "Shortlisted — next stage to follow";
      const updated = await sql`
        UPDATE submission_orders
        SET outcome = ${JSON.stringify(outcome)}::jsonb, stage_note = ${stageNote}, updated_at = NOW()
        WHERE id = ${orderId}
        RETURNING *
      `;
      await appendEvents(orderId, [
        event(`Outcome recorded: ${action.state === "lost" ? "not selected" : action.state}`, "ops"),
      ]);
      return rowToOrder(updated[0]);
    }
    case "record_debrief": {
      const lessons = (action.lessons ?? []).map((l) => l.trim()).filter(Boolean);
      if (!lessons.length) throw new OrderStateError("INVALID_ACTION", "Add at least one lesson.");
      const outcome = {
        ...order.outcome,
        debrief: { state: "received", requestedAt: order.outcome.debrief?.requestedAt ?? null, lessons },
      };
      const updated = await sql`
        UPDATE submission_orders
        SET outcome = ${JSON.stringify(outcome)}::jsonb, updated_at = NOW()
        WHERE id = ${orderId}
        RETURNING *
      `;
      await appendEvents(orderId, [
        event("Debrief received — lessons applied to your drafting defaults and readiness score.", "ops"),
      ]);
      return rowToOrder(updated[0]);
    }
    case "answer_qna": {
      const qna = [...order.qna];
      if (!qna[action.index]) throw new OrderStateError("INVALID_ACTION", "No such Q&A entry.");
      qna[action.index] = {
        ...qna[action.index],
        a: action.a.trim(),
        impact: action.impact?.trim() || qna[action.index].impact || null,
      };
      const updated = await sql`
        UPDATE submission_orders
        SET qna = ${JSON.stringify(qna)}::jsonb, updated_at = NOW()
        WHERE id = ${orderId}
        RETURNING *
      `;
      await appendEvents(orderId, [event("Clarification answered — draft impact checked.", "ops")]);
      return rowToOrder(updated[0]);
    }
    case "add_amendment": {
      const entry = {
        n: order.amendments.length + 1,
        at: new Date().toISOString(),
        summary: action.summary.trim().slice(0, 400),
        action: action.actionTaken.trim().slice(0, 400),
      };
      const updated = await sql`
        UPDATE submission_orders
        SET amendments = amendments || ${JSON.stringify([entry])}::jsonb,
            due = COALESCE(${action.due ?? null}, due),
            updated_at = NOW()
        WHERE id = ${orderId}
        RETURNING *
      `;
      await appendEvents(orderId, [event(`Amendment ${entry.n} recorded — ${entry.summary}`, "ops")]);
      return rowToOrder(updated[0]);
    }
    case "resolve_blocker": {
      const blockers = order.blockers.map((b) =>
        b.id === action.blockerId ? { ...b, state: "resolved" as const, note: action.note ?? b.note } : b,
      );
      const updated = await sql`
        UPDATE submission_orders
        SET blockers = ${JSON.stringify(blockers)}::jsonb, updated_at = NOW()
        WHERE id = ${orderId}
        RETURNING *
      `;
      const label = order.blockers.find((b) => b.id === action.blockerId)?.label ?? action.blockerId;
      await appendEvents(orderId, [event(`${label} — resolved and attached to the pack.`, "ops")]);
      return rowToOrder(updated[0]);
    }
  }
}

/* ── Wizard drafts (server-side autosave, one per user × type) ─────────── */

export async function getDraft(userId: number, type: SubmissionCode): Promise<WizardDraftState> {
  await ensureSubmissionsSchema();
  const rows = await sql`
    SELECT draft FROM submission_drafts WHERE user_id = ${userId} AND type = ${type} LIMIT 1
  `;
  const draft = rows[0]?.draft;
  if (!draft || typeof draft !== "object") return { ...EMPTY_DRAFT };
  return { ...EMPTY_DRAFT, ...(draft as Partial<WizardDraftState>) };
}

export async function putDraft(userId: number, type: SubmissionCode, draft: WizardDraftState): Promise<void> {
  await ensureSubmissionsSchema();
  await sql`
    INSERT INTO submission_drafts (user_id, type, draft, updated_at)
    VALUES (${userId}, ${type}, ${JSON.stringify(draft)}::jsonb, NOW())
    ON CONFLICT (user_id, type) DO UPDATE SET draft = EXCLUDED.draft, updated_at = NOW()
  `;
}

export async function clearDraft(userId: number, type: SubmissionCode): Promise<void> {
  await ensureSubmissionsSchema();
  await sql`DELETE FROM submission_drafts WHERE user_id = ${userId} AND type = ${type}`;
}
