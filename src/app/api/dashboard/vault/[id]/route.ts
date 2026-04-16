import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireDashboardAccess } from "@/lib/access";

export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const guard = await requireDashboardAccess(request);
  if (!guard.authorized) return guard.response!;

  const { id } = await ctx.params;
  const docId = Number(id);
  if (!Number.isFinite(docId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  await sql`
    DELETE FROM vault_documents
    WHERE id = ${docId} AND user_id = ${guard.user!.id}
  `;

  return NextResponse.json({ ok: true });
}
