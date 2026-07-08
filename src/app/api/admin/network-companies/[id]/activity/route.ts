import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";
import { ensureNetworkMatchingColumns } from "@/lib/network/schema";

export const runtime = "nodejs";

const KINDS = ["note", "call", "email", "meeting", "linkedin", "other"] as const;

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(request);
  if (!guard.authorized) return guard.response!;
  await ensureNetworkMatchingColumns();

  const { id: rawId } = await context.params;
  const id = parseId(rawId);
  if (!id) return NextResponse.json({ error: "Invalid company id" }, { status: 400 });

  const activities = await sql`
    SELECT a.id, a.kind, a.body, a.created_at, u.email AS author_email
    FROM network_company_activity a
    LEFT JOIN users u ON u.id = a.created_by
    WHERE a.network_company_id = ${id}
    ORDER BY a.created_at DESC, a.id DESC
    LIMIT 200
  `;
  return NextResponse.json({ activities });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(request);
  if (!guard.authorized) return guard.response!;
  await ensureNetworkMatchingColumns();

  const { id: rawId } = await context.params;
  const id = parseId(rawId);
  if (!id) return NextResponse.json({ error: "Invalid company id" }, { status: 400 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const kind = KINDS.includes(String(b.kind) as (typeof KINDS)[number]) ? String(b.kind) : "note";
  const text = typeof b.body === "string" ? b.body.trim().slice(0, 4000) : "";
  if (!text) return NextResponse.json({ error: "Add a note before saving." }, { status: 400 });

  const exists = await sql`SELECT 1 FROM network_companies WHERE id = ${id} LIMIT 1`;
  if (!exists.length) return NextResponse.json({ error: "Company not found" }, { status: 404 });

  const out = await sql`
    INSERT INTO network_company_activity (network_company_id, kind, body, created_by)
    VALUES (${id}, ${kind}, ${text}, ${guard.user?.id ?? null})
    RETURNING id, kind, body, created_at
  `;
  return NextResponse.json({ activity: { ...out[0], author_email: guard.user?.email ?? null } }, { status: 201 });
}
