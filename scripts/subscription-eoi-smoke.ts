/**
 * Pure-logic smoke for subscription EOI entitlements (P1.2). No DB.
 * Run: npx tsx scripts/subscription-eoi-smoke.ts
 *
 * Guards the load-bearing gate: a bundled EOI (a ~$149 deliverable) attaches to a
 * REAL subscription (active | Stripe-trialing), NOT the free platform trial
 * (null subscription_status) or a lapsed one.
 */

import { isPaidSubscriber, subscriptionEntitlements } from "../src/lib/subscription/entitlements";
import { SUB_BUNDLED_EOI_PER_MONTH } from "../src/lib/workbench/pricing";
import type { User, SubscriptionStatus } from "../src/lib/types";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.error(`  ✗ ${name}`); }
}

function mkUser(subscription_status: SubscriptionStatus | null): User {
  return {
    id: 1,
    email: "a@b.co",
    name: null,
    business_name: null,
    website: null,
    sector: null,
    country_focus: [],
    org_type: null,
    profile_description: null,
    profile_source: "unset",
    tier: null,
    subscription_status,
    subscription_expires_at: null,
    is_super_admin: false,
    created_at: new Date(0).toISOString(),
  };
}

console.log("isPaidSubscriber — real subscription only");
{
  check("active → subscriber", isPaidSubscriber(mkUser("active")) === true);
  check("trialing (Stripe sub-trial) → subscriber", isPaidSubscriber(mkUser("trialing")) === true);
  check("null (free platform trial) → NOT subscriber", isPaidSubscriber(mkUser(null)) === false);
  check("canceled → NOT subscriber", isPaidSubscriber(mkUser("canceled")) === false);
  check("past_due → NOT subscriber", isPaidSubscriber(mkUser("past_due")) === false);
}

console.log("entitlements — bundled EOIs follow eligibility");
{
  const active = subscriptionEntitlements(mkUser("active"));
  check("active bundles SUB_BUNDLED_EOI_PER_MONTH", active.isSubscriber && active.bundledEoisPerMonth === SUB_BUNDLED_EOI_PER_MONTH);
  const free = subscriptionEntitlements(mkUser(null));
  check("free trial bundles 0", free.isSubscriber === false && free.bundledEoisPerMonth === 0);
  const lapsed = subscriptionEntitlements(mkUser("canceled"));
  check("canceled bundles 0", lapsed.bundledEoisPerMonth === 0);
  check("config is a positive integer", Number.isInteger(SUB_BUNDLED_EOI_PER_MONTH) && SUB_BUNDLED_EOI_PER_MONTH >= 1);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
