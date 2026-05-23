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

  // PR-L (2026-05-23): a Stripe-managed trial is just as valid as a paid
  // active subscription. Without this branch, a user mid-Stripe-trial
  // (day 1-14 of the annual-access subscription) gets locked out the
  // moment their platform created_at trial elapses — even though Stripe
  // is deferring billing on their behalf. trialing status now grants
  // access. The 0 days-left + isTrialing:true tells the UI to show a
  // trial pill via the layout but never the "expired" red banner.
  if (user.subscription_status === "active") {
    return { hasAccess: true, reason: "subscribed", trialDaysLeft: 0, isTrialing: false };
  }
  if (user.subscription_status === "trialing") {
    return { hasAccess: true, reason: "trial", trialDaysLeft: 0, isTrialing: true };
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
          // PR-L (2026-05-23): point trial-expired upgrade flow at the
          // founding-100 lock-in (highest-converting price). Falls back
          // gracefully if STRIPE_PRICE_ANNUAL_ACCESS_49 isn't set.
          upgradeUrl: "/pay?plan=annual-access-founding",
        },
        { status: 402 }
      ),
    };
  }

  return { authorized: true, user, access };
}
