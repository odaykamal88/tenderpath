import { NextResponse } from "next/server";
import { DATA_ROOM_COOKIE } from "@/lib/data-room/auth";

export const runtime = "nodejs";

/** Clear the data room session cookie. */
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(DATA_ROOM_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
    path: "/",
  });
  return res;
}
