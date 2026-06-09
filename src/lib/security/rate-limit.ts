import { NextResponse } from "next/server";

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  namespace: string;
  limit: number;
  windowMs: number;
  keyParts?: Array<string | number | null | undefined>;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
}

const buckets = new Map<string, Bucket>();
let lastSweep = 0;

export function clientIp(request: Request): string {
  return request.headers.get("cf-connecting-ip")
    ?? request.headers.get("x-real-ip")
    ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "unknown";
}

function keyFor(request: Request, options: RateLimitOptions): string {
  const parts = [
    options.namespace,
    clientIp(request),
    ...(options.keyParts ?? []).map((part) => String(part ?? "").trim().toLowerCase()),
  ];
  return parts.join(":");
}

function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function checkRateLimit(request: Request, options: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  sweep(now);
  const key = keyFor(request, options);
  const existing = buckets.get(key);
  const bucket = existing && existing.resetAt > now
    ? existing
    : { count: 0, resetAt: now + options.windowMs };

  bucket.count += 1;
  buckets.set(key, bucket);

  const remaining = Math.max(0, options.limit - bucket.count);
  return {
    allowed: bucket.count <= options.limit,
    limit: options.limit,
    remaining,
    resetAt: bucket.resetAt,
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

export function rateLimitResponse(result: RateLimitResult): NextResponse {
  return NextResponse.json(
    { error: "Too many requests. Please wait and try again.", code: "RATE_LIMITED" },
    {
      status: 429,
      headers: {
        "Retry-After": String(result.retryAfterSeconds),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": String(result.remaining),
        "X-RateLimit-Reset": String(Math.floor(result.resetAt / 1000)),
      },
    },
  );
}

export function enforceRateLimit(request: Request, options: RateLimitOptions): NextResponse | null {
  const result = checkRateLimit(request, options);
  return result.allowed ? null : rateLimitResponse(result);
}

