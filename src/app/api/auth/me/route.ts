import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/subscription-guard";

export async function GET(request: Request) {
  const guard = await requireAuth(request);
  if (!guard.authorized) return guard.response!;

  const user = guard.user!;

  return NextResponse.json({
    id: user.id,
    email: user.email,
    name: user.name,
    tier: user.tier,
    subscription_status: user.subscription_status,
    subscription_expires_at: user.subscription_expires_at,
    is_super_admin: user.is_super_admin,
    business_name: user.business_name,
    website: user.website,
    sector: user.sector,
    country_focus: user.country_focus,
    org_type: user.org_type,
    profile_description: user.profile_description,
    profile_source: user.profile_source,
  });
}
