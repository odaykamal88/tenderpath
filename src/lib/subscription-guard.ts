import { NextResponse } from "next/server";
import { getUserFromRequest } from "./auth";
import type { TierSlug, User } from "./types";

const TIER_HIERARCHY: Record<TierSlug, number> = {
  "tender-intelligence": 1,
  "submission-package": 2,
  "strategic-partnership": 3,
};

const TIER_TO_PAY_PLAN: Record<TierSlug, string> = {
  "tender-intelligence": "grants-tenders-matching",
  "submission-package": "proposal-draft",
  "strategic-partnership": "roster-fast-track",
};

function payUrlForTier(tier: TierSlug) {
  return `/pay?plan=${TIER_TO_PAY_PLAN[tier]}`;
}

interface GuardResult {
  authorized: boolean;
  user: User | null;
  response?: NextResponse;
}

/**
 * FIX #2: Server-side subscription guard.
 * Checks that the requesting user has an active subscription
 * at or above the required tier level.
 */
export async function requireSubscription(
  request: Request,
  minimumTier: TierSlug
): Promise<GuardResult> {
  const user = await getUserFromRequest(request);

  if (!user) {
    return {
      authorized: false,
      user: null,
      response: NextResponse.json(
        { error: "Authentication required", code: "AUTH_REQUIRED" },
        { status: 401 }
      ),
    };
  }

  // Super admins bypass all gating
  if (user.is_super_admin) {
    return { authorized: true, user };
  }

  // Check subscription is active
  if (user.subscription_status !== "active" && user.subscription_status !== "trialing") {
    return {
      authorized: false,
      user,
      response: NextResponse.json(
        {
          error: "Active subscription required",
          code: "SUBSCRIPTION_REQUIRED",
          requiredTier: minimumTier,
          currentTier: user.tier,
          upgradeUrl: payUrlForTier(minimumTier),
        },
        { status: 403 }
      ),
    };
  }

  // Check tier hierarchy
  const userTierLevel = user.tier ? TIER_HIERARCHY[user.tier] ?? 0 : 0;
  const requiredLevel = TIER_HIERARCHY[minimumTier];

  if (userTierLevel < requiredLevel) {
    return {
      authorized: false,
      user,
      response: NextResponse.json(
        {
          error: `This feature requires the ${minimumTier} plan or higher`,
          code: "TIER_INSUFFICIENT",
          requiredTier: minimumTier,
          currentTier: user.tier,
          upgradeUrl: payUrlForTier(minimumTier),
        },
        { status: 403 }
      ),
    };
  }

  // Check expiration
  if (user.subscription_expires_at) {
    const expiresAt = new Date(user.subscription_expires_at);
    if (expiresAt < new Date()) {
      return {
        authorized: false,
        user,
        response: NextResponse.json(
          {
            error: "Subscription has expired",
            code: "SUBSCRIPTION_EXPIRED",
            expiredAt: user.subscription_expires_at,
            renewUrl: payUrlForTier(minimumTier),
          },
          { status: 403 }
        ),
      };
    }
  }

  return { authorized: true, user };
}

/**
 * Lightweight auth check — just needs to be logged in, no tier required.
 */
export async function requireAuth(request: Request): Promise<GuardResult> {
  const user = await getUserFromRequest(request);

  if (!user) {
    return {
      authorized: false,
      user: null,
      response: NextResponse.json(
        { error: "Authentication required", code: "AUTH_REQUIRED" },
        { status: 401 }
      ),
    };
  }

  return { authorized: true, user };
}

/**
 * Admin-only guard
 */
export async function requireAdmin(request: Request): Promise<GuardResult> {
  const user = await getUserFromRequest(request);

  if (!user) {
    return {
      authorized: false,
      user: null,
      response: NextResponse.json(
        { error: "Authentication required", code: "AUTH_REQUIRED" },
        { status: 401 }
      ),
    };
  }

  if (!user.is_super_admin) {
    return {
      authorized: false,
      user,
      response: NextResponse.json(
        { error: "Admin access required", code: "ADMIN_REQUIRED" },
        { status: 403 }
      ),
    };
  }

  return { authorized: true, user };
}
