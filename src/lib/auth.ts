import { SignJWT, jwtVerify } from "jose";
import { sql } from "./db";
import type { User } from "./types";

const JWT_SECRET_KEY = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set");
  return new TextEncoder().encode(secret);
};

const JWT_EXPIRY = "7d";

interface TokenClaims {
  isAdmin?: boolean;
  subscriptionStatus?: string | null;
  trialStartDate?: string | null;
}

export async function createToken(
  userId: number,
  email: string,
  claims: TokenClaims = {}
): Promise<string> {
  const trialExpiresAt = claims.trialStartDate
    ? new Date(new Date(claims.trialStartDate).getTime() + 14 * 24 * 60 * 60 * 1000).toISOString()
    : null;

  return new SignJWT({
    userId,
    email,
    isAdmin: claims.isAdmin ?? false,
    subscriptionStatus: claims.subscriptionStatus ?? null,
    trialExpiresAt,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRY)
    .sign(JWT_SECRET_KEY());
}

export async function verifyToken(
  token: string
): Promise<{ userId: number; email: string; isAdmin?: boolean; subscriptionStatus?: string | null; trialExpiresAt?: string | null } | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET_KEY());
    return {
      userId: payload.userId as number,
      email: payload.email as string,
      isAdmin: payload.isAdmin as boolean | undefined,
      subscriptionStatus: payload.subscriptionStatus as string | null | undefined,
      trialExpiresAt: payload.trialExpiresAt as string | null | undefined,
    };
  } catch {
    return null;
  }
}

// Reads the request's session token from EITHER the `Authorization: Bearer ...`
// header (set by clients that have a localStorage `tp_token`) OR the httpOnly
// `tp_session` cookie (set on every successful sign-in by /api/auth/password
// and /api/auth/verify). Audit 2026-05-20: legacy Bearer-only authentication
// silently 401'd users whose session lived only in the cookie (e.g. Google
// OAuth flows, or anyone whose localStorage was cleared but cookie still valid).
function readSessionToken(request: Request): string | null {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token) return token;
  }
  // Cookie fallback. The Cookie header is a single string of `k=v; k=v` pairs;
  // we parse for tp_session specifically (no general cookie lib needed).
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rest] = part.split("=");
    if (!rawName) continue;
    if (rawName.trim() === "tp_session") {
      const value = rest.join("=").trim();
      return value || null;
    }
  }
  return null;
}

export async function getUserFromRequest(
  request: Request
): Promise<User | null> {
  const token = readSessionToken(request);
  if (!token) return null;

  const payload = await verifyToken(token);
  if (!payload) return null;

  const rows = await sql`
    SELECT id, email, name, tier, subscription_status,
           subscription_expires_at, is_super_admin, created_at,
           business_name, website, sector, country_focus, org_type,
           profile_description, profile_source
    FROM users WHERE id = ${payload.userId}
  `;

  if (rows.length === 0) return null;

  const row = rows[0];
  return {
    id: row.id as number,
    email: row.email as string,
    name: row.name as string | null,
    business_name: row.business_name as string | null,
    website: row.website as string | null,
    sector: row.sector as string | null,
    country_focus: (row.country_focus as string[] | null) ?? [],
    org_type: row.org_type as string | null,
    profile_description: row.profile_description as string | null,
    profile_source: (row.profile_source as "assessment" | "manual" | "unset") ?? "unset",
    tier: row.tier as User["tier"],
    subscription_status: row.subscription_status as User["subscription_status"],
    subscription_expires_at: row.subscription_expires_at as string | null,
    is_super_admin: row.is_super_admin as boolean,
    created_at: row.created_at as string,
  };
}

export function generateMagicToken(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let token = "";
  const bytes = new Uint8Array(48);
  crypto.getRandomValues(bytes);
  for (const byte of bytes) {
    token += chars[byte % chars.length];
  }
  return token;
}
