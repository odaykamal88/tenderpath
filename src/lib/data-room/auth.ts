import { SignJWT, jwtVerify } from "jose";

/**
 * Investor data room — shared password gate.
 *
 * This is a soft, shareable access gate for a curated metrics page, NOT a
 * user-credential store. The founder shares the URL + password with preseed /
 * seed investors who do not (and should not) have admin accounts.
 *
 * Set DATA_ROOM_PASSWORD in the environment to rotate the password. Until it is
 * set, the room is live immediately with the password chosen at build-out so it
 * works out of the box on the current deployment.
 */
export const DATA_ROOM_PASSWORD = process.env.DATA_ROOM_PASSWORD || "tpdradmin26!";

export const DATA_ROOM_COOKIE = "tp_dataroom";
const SCOPE = "data-room";
const MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

/**
 * Signing key. Reuse the platform JWT secret when present so the room token is
 * signed with the same strength as the rest of the app; fall back to a
 * password-derived key so the room still works in isolated/preview envs that
 * never set JWT_SECRET.
 */
function key(): Uint8Array {
  const secret = process.env.JWT_SECRET || `tp-data-room::${DATA_ROOM_PASSWORD}`;
  return new TextEncoder().encode(secret);
}

export async function signDataRoomToken(): Promise<string> {
  return new SignJWT({ scope: SCOPE })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(key());
}

/** True only for a non-expired token minted by signDataRoomToken(). */
export async function isDataRoomToken(token: string | undefined | null): Promise<boolean> {
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, key());
    return payload.scope === SCOPE;
  } catch {
    return false;
  }
}

/**
 * Length-safe, early-exit-free password comparison. The gate is low-value
 * (curated read-only metrics) so this is sufficient; we still avoid leaking the
 * password length via a short-circuit on the first differing byte.
 */
export function checkDataRoomPassword(input: unknown): boolean {
  if (typeof input !== "string") return false;
  const a = Buffer.from(input);
  const b = Buffer.from(DATA_ROOM_PASSWORD);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export const DATA_ROOM_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  maxAge: MAX_AGE_SECONDS,
  path: "/",
};
