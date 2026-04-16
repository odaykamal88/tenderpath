import { SignJWT, jwtVerify } from "jose";
import { sql } from "./db";
import type { User } from "./types";

const JWT_SECRET_KEY = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set");
  return new TextEncoder().encode(secret);
};

const JWT_EXPIRY = "7d";

export async function createToken(userId: number, email: string): Promise<string> {
  return new SignJWT({ userId, email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRY)
    .sign(JWT_SECRET_KEY());
}

export async function verifyToken(
  token: string
): Promise<{ userId: number; email: string } | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET_KEY());
    return {
      userId: payload.userId as number,
      email: payload.email as string,
    };
  } catch {
    return null;
  }
}

export async function getUserFromRequest(
  request: Request
): Promise<User | null> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice(7);
  const payload = await verifyToken(token);
  if (!payload) return null;

  const rows = await sql`
    SELECT id, email, name, tier, subscription_status,
           subscription_expires_at, is_super_admin, created_at
    FROM users WHERE id = ${payload.userId}
  `;

  if (rows.length === 0) return null;

  const row = rows[0];
  return {
    id: row.id as number,
    email: row.email as string,
    name: row.name as string | null,
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
