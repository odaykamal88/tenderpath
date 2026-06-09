import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { getUserFromRequest } from "@/lib/auth";
import { sql } from "@/lib/db";
import { track } from "@/lib/telemetry/funnel";
import { evaluateServiceFulfillmentGate } from "@/lib/service-fulfillment-gates";
import { assertTenderDeadlineIsLive } from "@/lib/tender-deadline-guard";
import { resolveTierSlug, isComingSoonTier } from "@/lib/pricing";
import { TRIAL_DAYS } from "@/lib/access";
import { PROPOSAL_PLAN, ROSTER_PLAN } from "@/lib/proposal-package/types";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { consumeFreeSubmissionForProposal } from "@/lib/free-submission";

const SLUG_TO_PRICE_ENV: Record<string, string> = {
  "bid-no-bid":              "STRIPE_BIDNOBID_PRICE_ID",
  "grants-tenders-matching": "STRIPE_PRICE_TENDER_INTELLIGENCE",
  "proposal-draft":          "STRIPE_PRICE_SUBMISSION_PACKAGE",
  "roster-fast-track":       "STRIPE_PRICE_STRATEGIC_PARTNERSHIP",
  // PR-L (2026-05-23): annual dashboard access — same Stripe product,
  // two prices. The slug picks the price; both unlock the same tier.
  "annual-access":           "STRIPE_PRICE_ANNUAL_ACCESS_99",
  "annual-access-founding":  "STRIPE_PRICE_ANNUAL_ACCESS_49",
};

const SUBSCRIPTION_PLANS = new Set([
  "grants-tenders-matching",
  "annual-access",
  "annual-access-founding",
]);

// PR-L (2026-05-23): plans that get a Stripe-managed trial. The platform
// also has its own from-signup trial via evaluateAccess(). PR-M extended
// both to 30 days (TRIAL_DAYS in /lib/access) and added an anti-double-
// count rule: the Stripe trial is shortened to whatever's left of the
// platform trial, so a user can never get more than TRIAL_DAYS total free.
const TRIAL_PLANS = new Set(["annual-access", "annual-access-founding"]);

function metadataValue(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, 500);
}

interface CheckoutWorkOrderRow {
  id: number;
  plan: string;
  service_slug: string | null;
}

function workOrderPlanMatches(order: CheckoutWorkOrderRow, plan: string): boolean {
  return order.plan === plan
    || order.service_slug === plan
    || (plan === PROPOSAL_PLAN && order.service_slug === "proposal")
    || (plan === ROSTER_PLAN && order.service_slug === "lta-roster");
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    plan?: string;
    tender?: string | null;
    agency?: string | null;
    pipeline_item_id?: string | number | null;
    work_order_id?: string | number | null;
  };
  const requestedPlan = body.plan;

  if (!requestedPlan) {
    return NextResponse.json({ error: "plan is required" }, { status: 400 });
  }
  const checkoutLimit = enforceRateLimit(request, {
    namespace: "pay:checkout:ip",
    limit: 40,
    windowMs: 10 * 60 * 1000,
    keyParts: [requestedPlan],
  });
  if (checkoutLimit) return checkoutLimit;

  // Map legacy backend slugs (tender-intelligence etc.) to the canonical
  // TIERS slugs the price-env table understands. See SLUG_ALIASES in pricing.ts.
  const plan = resolveTierSlug(requestedPlan);
  if (!plan) {
    console.warn("[pay:slug:unknown]", { requestedPlan });
    return NextResponse.json({ error: "Unknown plan" }, { status: 400 });
  }

  // Product-wide "coming soon" gate (e.g. Roster/LTA). Block at the server so a
  // direct API call can't buy a held-back tier, not just the UI.
  if (isComingSoonTier(plan)) {
    console.warn("[pay:slug:coming_soon_blocked]", { plan });
    return NextResponse.json(
      { error: "This service is coming soon and isn't available for purchase yet.", code: "PLAN_COMING_SOON" },
      { status: 403 },
    );
  }

  const priceEnvKey = SLUG_TO_PRICE_ENV[plan];
  if (!priceEnvKey) {
    console.warn("[pay:slug:no_price_env]", { plan });
    return NextResponse.json({ error: "Unknown plan" }, { status: 400 });
  }

  const priceId = process.env[priceEnvKey];
  if (!priceId) {
    return NextResponse.json(
      { error: "Card payments for this plan are not yet configured. Please use USDT or wire transfer." },
      { status: 503 }
    );
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    console.error("[api/pay/checkout] STRIPE_SECRET_KEY is not configured");
    return NextResponse.json(
      { error: "Card payments are not configured yet. Please use USDT or wire transfer." },
      { status: 503 }
    );
  }

  try {
    const stripe = getStripe();
    const origin =
      request.headers.get("origin") ??
      process.env.NEXT_PUBLIC_APP_URL ??
      "http://localhost:3000";

    const tender = metadataValue(body.tender);
    const agency = metadataValue(body.agency);
    const pipelineItemId = metadataValue(String(body.pipeline_item_id ?? ""));
    const workOrderId = metadataValue(String(body.work_order_id ?? ""));
    const parsedWorkOrderId = workOrderId && /^\d+$/.test(workOrderId) ? Number(workOrderId) : null;
    const checkoutUser = await getUserFromRequest(request);

    if (parsedWorkOrderId) {
      if (!checkoutUser) {
        return NextResponse.json(
          { error: "Sign in before paying for a work order.", code: "AUTH_REQUIRED" },
          { status: 401 },
        );
      }

      const workOrderRows = await sql`
        SELECT id, plan, service_slug
        FROM work_orders
        WHERE id = ${parsedWorkOrderId}
          AND (
            user_id = ${checkoutUser.id}
            OR (email IS NOT NULL AND LOWER(email) = LOWER(${checkoutUser.email}))
          )
        LIMIT 1
      ` as unknown as CheckoutWorkOrderRow[];
      const workOrder = workOrderRows[0];
      if (!workOrder) {
        console.warn("[pay:checkout:ownership_blocked]", { workOrderId: parsedWorkOrderId, userId: checkoutUser.id });
        return NextResponse.json({ error: "Work order not found." }, { status: 404 });
      }
      if (!workOrderPlanMatches(workOrder, plan)) {
        return NextResponse.json(
          { error: "This checkout plan does not match the saved work order.", code: "PLAN_MISMATCH" },
          { status: 409 },
        );
      }
    }

    // Block tender-anchored paid services when the deadline has already passed
    // or is too close. Subscription plans + roster-fast-track skip this.
    if (plan === "bid-no-bid" || plan === "proposal-draft") {
      const parsedPipelineItemId = pipelineItemId && /^\d+$/.test(pipelineItemId)
        ? Number(pipelineItemId)
        : null;
      const deadlineErr = await assertTenderDeadlineIsLive({
        pipelineItemId: parsedPipelineItemId,
        workOrderId: parsedWorkOrderId,
        plan,
      });
      if (deadlineErr) {
        return NextResponse.json(
          { error: deadlineErr.message, code: deadlineErr.code, deadline_iso: deadlineErr.deadline_iso },
          { status: 409 },
        );
      }
    }

    const gate = await evaluateServiceFulfillmentGate({
      plan,
      workOrderId: parsedWorkOrderId,
    });
    if (!gate.payment_allowed) {
      return NextResponse.json(
        {
          error: gate.message,
          code: gate.code,
          missing_inputs: gate.missing_inputs,
          readiness: gate,
        },
        { status: 409 },
      );
    }

    // First-proposal-free credit: a trial user's first proposal submission is
    // fulfilled without payment (the promise the landing pricing card makes).
    // Applies only to proposal-draft with a work order owned by the signed-in
    // user; the claim is atomic (no double-spend) and falls through to paid
    // checkout when the credit isn't available. Runs AFTER the deadline + gate
    // checks so a free order is held to the same fulfillment bar as a paid one.
    if (plan === "proposal-draft" && parsedWorkOrderId && checkoutUser) {
      const free = await consumeFreeSubmissionForProposal({
        user: checkoutUser,
        workOrderId: parsedWorkOrderId,
        pipelineItemId: pipelineItemId || null,
        tenderTitle: tender || null,
        agency: agency || null,
      });
      if (free.applied && free.redirectUrl) {
        await track(
          "free_submission_redeemed",
          { plan, work_order_id: workOrderId || null, pipeline_item_id: pipelineItemId || null },
          { userId: checkoutUser.id },
        );
        return NextResponse.json({ free: true, url: `${origin}${free.redirectUrl}` });
      }
    }

    const returnParams = new URLSearchParams({ plan });
    if (tender) returnParams.set("tender", tender);
    if (agency) returnParams.set("agency", agency);
    if (pipelineItemId) returnParams.set("pipeline_item_id", pipelineItemId);
    if (workOrderId) returnParams.set("work_order_id", workOrderId);

    // PR-K (2026-05-23): when a paid service has a work order attached
    // (bid-no-bid / proposal-draft / roster-fast-track), Stripe sends the
    // user straight to /dashboard/work-orders/{id} after checkout so they
    // see generation progress immediately — no intermediate /pay/success
    // page. Subscription tiers + standalone purchases keep the existing
    // /pay/success landing for receipt + activation messaging.
    const returnUrl =
      parsedWorkOrderId && !SUBSCRIPTION_PLANS.has(plan)
        ? `${origin}/dashboard/work-orders/${parsedWorkOrderId}?paid=1`
        : `${origin}/pay/success?${returnParams.toString()}`;

    const isSubscription = SUBSCRIPTION_PLANS.has(plan);
    const wantsTrial = TRIAL_PLANS.has(plan);

    // PR-M (2026-05-23): anti-double-count. A user who has been on the
    // platform trial for N days only gets (TRIAL_DAYS - N) more days from
    // Stripe — so total free access is capped at TRIAL_DAYS from signup,
    // regardless of when they subscribed. Without this, signing up day 1
    // + subscribing day 28 would yield 28 + 30 = 58 free days.
    //
    // Reads the user from the auth header / tp_session cookie. If we
    // can't identify them (anonymous /pay flow), fall back to the full
    // TRIAL_DAYS — they haven't used any platform trial yet either.
    let trialDaysRemaining = TRIAL_DAYS;
    if (checkoutUser?.created_at) {
      const elapsedMs = Date.now() - new Date(checkoutUser.created_at).getTime();
      const elapsedDays = Math.floor(elapsedMs / (1000 * 60 * 60 * 24));
      trialDaysRemaining = Math.max(0, TRIAL_DAYS - elapsedDays);
    }

    const session = await stripe.checkout.sessions.create({
      ui_mode: "embedded_page",
      mode: isSubscription ? "subscription" : "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      // Surfaces the "Add promotion code" field in the embedded checkout so
      // Stripe-managed coupons (e.g. FREETEST) can be applied at the UI level.
      allow_promotion_codes: true,
      return_url: returnUrl,
      // PR-L/M (2026-05-23): for annual-access plans, defer the first
      // charge until the user's TOTAL trial window (platform + Stripe)
      // hits TRIAL_DAYS from signup. trial_period_days = 0 is rejected by
      // Stripe — omit subscription_data.trial_period_days entirely if
      // there's no trial left so the user is charged immediately.
      ...(isSubscription && wantsTrial && trialDaysRemaining > 0
        ? {
            subscription_data: {
              trial_period_days: trialDaysRemaining,
              metadata: {
                plan,
                tier: "annual-access",
                platform_trial_days_used: String(TRIAL_DAYS - trialDaysRemaining),
              },
            },
          }
        : isSubscription && wantsTrial
          ? {
              subscription_data: {
                metadata: {
                  plan,
                  tier: "annual-access",
                  platform_trial_days_used: String(TRIAL_DAYS),
                  trial_skipped: "platform_trial_exhausted",
                },
              },
            }
          : {}),
      metadata: {
        plan,
        userId: checkoutUser ? String(checkoutUser.id) : "",
        tender,
        agency,
        pipeline_item_id: pipelineItemId,
        work_order_id: workOrderId,
        ...gate.metadata,
      },
    });

    // PR-M (2026-05-23): reuse the user fetched above for the anti-double-
    // count trial calculation. Saves a redundant DB round-trip.
    await track(
      "paid_intent_clicked",
      {
        plan,
        is_subscription: SUBSCRIPTION_PLANS.has(plan),
        work_order_id: workOrderId || null,
        pipeline_item_id: pipelineItemId || null,
        stripe_session_id: session.id,
        fulfillment_mode: gate.mode,
        readiness_code: gate.code,
        readiness_score: gate.score_0_10,
        trial_days_remaining: trialDaysRemaining,
      },
      { userId: checkoutUser?.id ?? null },
    );

    return NextResponse.json({ clientSecret: session.client_secret });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown checkout error";
    console.error("[api/pay/checkout]", message);
    return NextResponse.json(
      { error: `Failed to create checkout session: ${message}` },
      { status: 500 }
    );
  }
}
