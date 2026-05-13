import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { isFunnelEvent, track } from "@/lib/telemetry/funnel";

export const runtime = "nodejs";

/**
 * Client-side activation funnel beacon.
 *
 * Authentication is optional — anonymous events still count toward the
 * top-of-funnel via the anonId field. Validation is strict on `event`
 * (must be a known FunnelEvent) but tolerant on `props` (any JSON
 * serializable object). Telemetry never throws — failures are logged
 * server-side and the client always sees `{ ok: true }`.
 */
export async function POST(request: Request) {
  let body: { event?: unknown; props?: unknown; anon_id?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!isFunnelEvent(body.event)) {
    return NextResponse.json({ error: "Unknown event" }, { status: 400 });
  }

  const props =
    body.props && typeof body.props === "object" && !Array.isArray(body.props)
      ? (body.props as Record<string, unknown>)
      : {};

  const anonId =
    typeof body.anon_id === "string" && body.anon_id.length > 0 && body.anon_id.length <= 64
      ? body.anon_id
      : null;

  const user = await getUserFromRequest(request);

  await track(body.event, props, {
    userId: user?.id ?? null,
    anonId,
  });

  return NextResponse.json({ ok: true });
}
