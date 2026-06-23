import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isDataRoomToken, DATA_ROOM_COOKIE } from "@/lib/data-room/auth";
import { getDataRoomMetrics } from "@/lib/data-room/metrics";
import { getUserFromRequest } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Investor data room metrics. Authorized by EITHER:
 *   - a valid tp_dataroom cookie (investor entered the password), OR
 *   - a logged-in super-admin Bearer token (founder opening it from /admin).
 *
 * Allowlisted in the proxy, so this handler owns authorization. 401 (not a
 * redirect) so the client can show the password screen.
 */
export async function GET(request: Request) {
  const cookieStore = await cookies();
  const cookieToken = cookieStore.get(DATA_ROOM_COOKIE)?.value;
  let authorized = await isDataRoomToken(cookieToken);

  if (!authorized) {
    const user = await getUserFromRequest(request).catch(() => null);
    authorized = Boolean(user?.is_super_admin);
  }

  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized", code: "DATA_ROOM_LOCKED" }, { status: 401 });
  }

  try {
    const metrics = await getDataRoomMetrics();
    return NextResponse.json(metrics);
  } catch (err) {
    console.error("[data-room:metrics:failed]", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: "Failed to load metrics" }, { status: 500 });
  }
}
