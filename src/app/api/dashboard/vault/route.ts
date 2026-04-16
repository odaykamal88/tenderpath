import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireDashboardAccess } from "@/lib/access";

const DOC_TYPES = ["certification", "financial", "cv", "past_performance", "other"] as const;
type DocType = (typeof DOC_TYPES)[number];
const isType = (v: unknown): v is DocType =>
  typeof v === "string" && (DOC_TYPES as readonly string[]).includes(v);

export async function GET(request: Request) {
  const guard = await requireDashboardAccess(request);
  if (!guard.authorized) return guard.response!;

  const rows = await sql`
    SELECT id, name, type, expiry_date, file_url, created_at
    FROM vault_documents
    WHERE user_id = ${guard.user!.id}
    ORDER BY created_at DESC
  `;

  return NextResponse.json({ documents: rows });
}

export async function POST(request: Request) {
  const guard = await requireDashboardAccess(request);
  if (!guard.authorized) return guard.response!;

  const body = await request.json();
  const { name, type, expiry_date = null, file_url } = body ?? {};

  if (!name || typeof name !== "string") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (!isType(type)) {
    return NextResponse.json({ error: "invalid type" }, { status: 400 });
  }
  if (!file_url || typeof file_url !== "string" || !/^https?:\/\//.test(file_url)) {
    return NextResponse.json({ error: "valid file_url (http/https) required" }, { status: 400 });
  }

  const rows = await sql`
    INSERT INTO vault_documents (user_id, name, type, expiry_date, file_url)
    VALUES (${guard.user!.id}, ${name}, ${type}, ${expiry_date}, ${file_url})
    RETURNING *
  `;

  return NextResponse.json({ document: rows[0] }, { status: 201 });
}
