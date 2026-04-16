import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/subscription-guard";
import { syncAllTenders } from "@/lib/tender-sync";

export async function POST(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.authorized) return guard.response!;

  const result = await syncAllTenders();

  return NextResponse.json({
    ok: true,
    ...result,
  });
}
