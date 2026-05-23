import { NextResponse } from "next/server";
import { getUserFromRequest } from "./auth";
import type { User } from "./types";

// PR-M (2026-05-23): trial extended 14 → 30 days. Day 27 is the warning-
// email trigger (see src/app/api/cron/trial-reminders/route.ts). Bumping
// here also bumps the Stripe-managed trial via subscription_data.trial_
// period_days inside /api/pay/checkout, so the two trial systems stay
// aligned to a single 30-day window from the user's created_at.
export const TRIAL_DAYS = 30;
// Days before trial end when the warning email fires. Cron picks up
// users whose elapsed day == TRIAL_WARNING_DAY exactly once.
export const TRIAL_WARNING_DAY = 27;

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
          // PR-M (2026-05-23): point trial-expired upgrade flow at the
          // regular $99/year. The founding-100 lock-in surfaces in a
          // separate banner (not on this fallback path).
          upgradeUrl: "/pay?plan=annual-access",
        },
        { status: 402 }
      ),
    };
  }

  return { authorized: true, user, access };
}
