import { NextResponse } from "next/server";
import {
  checkDataRoomPassword,
  signDataRoomToken,
  DATA_ROOM_COOKIE,
  DATA_ROOM_COOKIE_OPTS,
} from "@/lib/data-room/auth";

export const runtime = "nodejs";

/**
 * Investor data room — password exchange. POST { password }. On success sets
 * the httpOnly tp_dataroom session cookie and returns { ok: true }. The route
 * self-authorizes (it is allowlisted in the proxy), so the password is the
 * only gate.
 */
export async function POST(request: Request) {
  let password: unknown;
  try {
    const body = await request.json();
    password = body?.password;
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request" }, { status: 400 });
  }

  if (!checkDataRoomPassword(password)) {
    console.warn("[data-room:login:rejected]");
    return NextResponse.json({ ok: false, error: "Incorrect password" }, { status: 401 });
  }

  const token = await signDataRoomToken();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(DATA_ROOM_COOKIE, token, DATA_ROOM_COOKIE_OPTS);
  return res;
}
