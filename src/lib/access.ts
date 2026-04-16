import { NextResponse } from "next/server";
import { getUserFromRequest } from "./auth";
import type { User } from "./types";

export const TRIAL_DAYS = 14;

export interface AccessInfo {
  hasAccess: boolean;
  reason: "admin" | "subscribed" | "trial" | "expired" | "no_subscription";
  trialDaysLeft: number;
  isTrialing: boolean;
}

export function evaluateAccess(user: User): AccessInfo {
  if (user.is_super_admin) {
    return { hasAccess: true, reason: "admin", trialDaysLeft: 0, isTrialing: false };
  }

  if (user.subscription_status === "active") {
    return { hasAccess: true, reason: "subscribed", trialDaysLeft: 0, isTrialing: false };
  }

  const created = new Date(user.created_at).getTime();
  const elapsedDays = Math.floor((Date.now() - created) / (1000 * 60 * 60 * 24));
  const trialDaysLeft = Math.max(0, TRIAL_DAYS - elapsedDays);

  if (trialDaysLeft > 0) {
    return { hasAccess: true, reason: "trial", trialDaysLeft, isTrialing: true };
  }

  return {
    hasAccess: false,
    reason: user.subscription_status ? "expired" : "no_subscription",
    trialDaysLeft: 0,
    isTrialing: false,
  };
}

export interface DashboardGuardResult {
  authorized: boolean;
  user: User | null;
  access: AccessInfo | null;
  response?: NextResponse;
}

export async function requireDashboardAccess(
  request: Request
): Promise<DashboardGuardResult> {
  const user = await getUserFromRequest(request);
  if (!user) {
    return {
      authorized: false,
      user: null,
      access: null,
      response: NextResponse.json(
        { error: "Authentication required", code: "AUTH_REQUIRED" },
        { status: 401 }
      ),
    };
  }

  const access = evaluateAccess(user);
  if (!access.hasAccess) {
    return {
      authorized: false,
      user,
      access,
      response: NextResponse.json(
        {
          error: "Trial expired. Subscribe to continue.",
          code: "TRIAL_EXPIRED",
          upgradeUrl: "/pricing",
        },
        { status: 402 }
      ),
    };
  }

  return { authorized: true, user, access };
}
