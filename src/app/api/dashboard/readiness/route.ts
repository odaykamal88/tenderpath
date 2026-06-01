import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireDashboardAccess } from "@/lib/access";
import { isComingSoonTier } from "@/lib/pricing";
import type { Gap, TierSlug } from "@/lib/types";

type VaultDocType = "certification" | "financial" | "cv" | "past_performance" | "other";

type ReadinessAction = {
  gap: string;
  severity: Gap["severity"];
  fix: string;
  action_steps: string[];
  upsell_tier: TierSlug;
  recommended_doc_type: VaultDocType;
  covered_by_vault: boolean;
  vault_document_count: number;
  primary_action_label: string;
  primary_action_href: string;
  paid_action_label: string;
  paid_action_href: string;
};

function recommendedDocType(gap: Gap): VaultDocType {
  const text = `${gap.gap} ${gap.fix} ${gap.action_steps?.join(" ") ?? ""}`.toLowerCase();
  if (/(financial|audit|bank|revenue|turnover|statement|balance|tax)/.test(text)) return "financial";
  if (/(cv|resume|team|staff|expert|personnel|consultant|qualification)/.test(text)) return "cv";
  if (/(past performance|case stud|reference|portfolio|contract|experience|track record)/.test(text)) return "past_performance";
  if (/(certif|registration|license|iso|policy|compliance|legal|vendor|roster)/.test(text)) return "certification";
  return "other";
}

function paidActionForTier(tier: TierSlug): { label: string; href: string } {
  // Roster/LTA is held back ("coming soon") — don't route the readiness upsell
  // to a checkout the user can't complete. Fall through to the proposal action.
  if (tier === "strategic-partnership" && !isComingSoonTier(tier)) {
    return {
      label: "Get roster help",
      href: "/pay?plan=roster-fast-track",
    };
  }

  if (tier === "submission-package") {
    return {
      label: "Get proposal package",
      href: "/pay?plan=proposal-draft",
    };
  }

  return {
    label: "Keep matched tenders coming",
    href: "/pay?plan=grants-tenders-matching",
  };
}

function buildActionPlan(
  gaps: Gap[],
  vaultCounts: Map<VaultDocType, number>,
): ReadinessAction[] {
  const severityOrder: Record<Gap["severity"], number> = { high: 0, medium: 1, low: 2 };

  return gaps
    .map((gap) => {
      const recommendedType = recommendedDocType(gap);
      const count = vaultCounts.get(recommendedType) ?? 0;
      const paidAction = paidActionForTier(gap.upsell_tier);
      const params = new URLSearchParams({
        type: recommendedType,
        gap: gap.gap.slice(0, 180),
      });

      return {
        gap: gap.gap,
        severity: gap.severity,
        fix: gap.fix,
        action_steps: gap.action_steps ?? [],
        upsell_tier: gap.upsell_tier,
        recommended_doc_type: recommendedType,
        covered_by_vault: count > 0,
        vault_document_count: count,
        primary_action_label: count > 0 ? "Review Vault evidence" : "Upload supporting doc",
        primary_action_href: `/dashboard/vault?${params.toString()}`,
        paid_action_label: paidAction.label,
        paid_action_href: paidAction.href,
      };
    })
    .sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
}

export async function GET(request: Request) {
  const guard = await requireDashboardAccess(request);
  if (!guard.authorized) return guard.response!;

  const user = guard.user!;

  // Fetch the latest assessment for this user by email
  const rows = await sql`
    SELECT id, company_name, readiness_score, gaps, matched_tenders, recommended_tier, created_at
    FROM assessments
    WHERE email = ${user.email}
    ORDER BY created_at DESC
    LIMIT 1
  `;

  if (!rows.length) {
    return NextResponse.json({ assessment: null });
  }

  const row = rows[0];
  const gaps = (row.gaps as Gap[] | null) ?? [];
  const highSeverityGaps = gaps.filter((g) => g.severity === "high");
  const matchedTenders = row.matched_tenders as unknown[];
  const vaultRows = await sql`
    SELECT type, COUNT(*) AS count
    FROM vault_documents
    WHERE user_id = ${user.id}
    GROUP BY type
  `;
  const vaultCounts = new Map<VaultDocType, number>(
    (vaultRows as Array<{ type: VaultDocType; count: number | string }>).map((doc) => [
      doc.type,
      Number(doc.count ?? 0),
    ]),
  );
  const actionPlan = buildActionPlan(gaps, vaultCounts);

  return NextResponse.json({
    assessment: {
      id: row.id,
      company_name: row.company_name,
      readiness_score: row.readiness_score,
      recommended_tier: row.recommended_tier,
      matched_tenders_count: Array.isArray(matchedTenders) ? matchedTenders.length : 0,
      high_severity_gaps: highSeverityGaps,
      action_plan: actionPlan,
      vault_coverage: {
        covered_gaps: actionPlan.filter((item) => item.covered_by_vault).length,
        total_gaps: actionPlan.length,
      },
      gap_count: gaps.length,
      created_at: row.created_at,
    },
  });
}
