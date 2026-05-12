import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";
import { getStripe } from "@/lib/stripe";
import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";
export const maxDuration = 300;

let _anthropic: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_anthropic) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
    _anthropic = new Anthropic({ apiKey: key });
  }
  return _anthropic;
}

function safeParseJSON<T>(text: string, fallback: T): T {
  try {
    const cleaned = text.replace(/^```json?\s*\n?/i, "").replace(/\n?```\s*$/i, "");
    return JSON.parse(cleaned) as T;
  } catch {
    return fallback;
  }
}

/** GET — check if analysis exists for a pipeline item */
export async function GET(request: Request) {
  const guard = await requireAuth(request);
  if (!guard.authorized) return guard.response!;
  const user = guard.user!;

  const url = new URL(request.url);
  const pipelineItemId = url.searchParams.get("pipeline_item_id");

  if (!pipelineItemId) {
    return NextResponse.json({ error: "pipeline_item_id is required" }, { status: 400 });
  }

  const rows = await sql`
    SELECT * FROM bid_analyses
    WHERE user_id = ${user.id} AND pipeline_item_id = ${Number(pipelineItemId)}
    ORDER BY created_at DESC
    LIMIT 1
  `;

  if (!rows.length) return NextResponse.json({ exists: false }, { status: 404 });
  return NextResponse.json({ exists: true, analysis: rows[0] });
}

/** POST — verify Stripe payment then run two-stage Claude analysis */
export async function POST(request: Request) {
  const guard = await requireAuth(request);
  if (!guard.authorized) return guard.response!;
  const user = guard.user!;

  const body = await request.json() as {
    pipeline_item_id?: number;
    stripe_session_id?: string;
  };

  const { pipeline_item_id, stripe_session_id } = body;

  if (!pipeline_item_id) {
    return NextResponse.json({ error: "pipeline_item_id is required" }, { status: 400 });
  }

  // Return existing analysis without re-charging
  const existing = await sql`
    SELECT * FROM bid_analyses
    WHERE user_id = ${user.id} AND pipeline_item_id = ${pipeline_item_id}
    ORDER BY created_at DESC LIMIT 1
  `;
  if (existing.length) return NextResponse.json({ analysis: existing[0] });

  // Verify Stripe payment
  if (!stripe_session_id) {
    return NextResponse.json({ error: "Payment required", code: "PAYMENT_REQUIRED" }, { status: 402 });
  }

  const stripe = getStripe();
  let stripeSession;
  try {
    stripeSession = await stripe.checkout.sessions.retrieve(stripe_session_id);
  } catch {
    return NextResponse.json({ error: "Invalid Stripe session" }, { status: 400 });
  }

  if (stripeSession.payment_status !== "paid") {
    return NextResponse.json({ error: "Payment not completed" }, { status: 402 });
  }

  // Prevent session reuse across users/items
  const sessionUsed = await sql`
    SELECT id FROM bid_analyses WHERE stripe_session_id = ${stripe_session_id}
  `;
  if (sessionUsed.length) {
    return NextResponse.json({ error: "This payment session has already been used" }, { status: 400 });
  }

  // Fetch pipeline item + linked tender data
  const pipelineRows = await sql`
    SELECT
      pi.id, pi.tender_id, pi.tender_title, pi.tender_agency,
      pi.tender_deadline, pi.tender_value, pi.source_url AS manual_source_url,
      t.description AS t_description,
      t.source_name,
      t.opportunity_type,
      t.sector,
      t.eligibility_summary,
      t.requirements,
      t.source_url AS t_source_url
    FROM pipeline_items pi
    LEFT JOIN tenders t ON t.id = pi.tender_id
    WHERE pi.id = ${pipeline_item_id} AND pi.user_id = ${user.id}
  `;

  if (!pipelineRows.length) {
    return NextResponse.json({ error: "Pipeline item not found" }, { status: 404 });
  }

  const item = pipelineRows[0];

  const tenderText = [
    `Title: ${item.tender_title}`,
    item.tender_agency ? `Agency: ${item.tender_agency}` : null,
    item.source_name ? `Source: ${item.source_name}` : null,
    item.opportunity_type ? `Opportunity Type: ${item.opportunity_type}` : null,
    item.sector ? `Sector/Category: ${item.sector}` : null,
    item.tender_value ? `Estimated Value: ${item.tender_value}` : null,
    item.tender_deadline ? `Deadline: ${item.tender_deadline}` : null,
    (item.t_source_url ?? item.manual_source_url) ? `Source URL: ${item.t_source_url ?? item.manual_source_url}` : null,
    item.t_description ? `\nDescription:\n${item.t_description}` : null,
    item.eligibility_summary ? `\nEligibility:\n${item.eligibility_summary}` : null,
  ].filter(Boolean).join("\n");

  // Fetch company profile from most recent assessment
  const assessmentRows = await sql`
    SELECT company_name, description, sector, countries, ai_analysis, readiness_score, gaps
    FROM assessments
    WHERE email = ${user.email}
    ORDER BY created_at DESC LIMIT 1
  `;

  const assessment = assessmentRows[0] ?? null;
  const aiAnalysis = assessment?.ai_analysis as Record<string, unknown> | null;

  const companyContext = assessment
    ? [
        `Company: ${assessment.company_name}`,
        `Description: ${assessment.description}`,
        `Sector: ${assessment.sector ?? "Not specified"}`,
        `Countries: ${(assessment.countries as string[]).join(", ")}`,
        `Readiness Score: ${assessment.readiness_score}/100`,
        aiAnalysis?.capabilities ? `Capabilities: ${JSON.stringify(aiAnalysis.capabilities)}` : null,
        aiAnalysis?.strengths ? `Strengths: ${JSON.stringify(aiAnalysis.strengths)}` : null,
        aiAnalysis?.certifications_detected ? `Certifications: ${JSON.stringify(aiAnalysis.certifications_detected)}` : null,
        assessment.gaps ? `Known Gaps: ${JSON.stringify(assessment.gaps)}` : null,
      ].filter(Boolean).join("\n")
    : "No company profile found. Assume a small consultancy with limited track record.";

  // Fetch intake from work order if the session carries one
  const workOrderId = stripeSession.metadata?.work_order_id;
  let intakeSummary = "";
  if (workOrderId) {
    const workOrderRows = await sql`
      SELECT intake FROM work_orders
      WHERE id = ${Number(workOrderId)} AND user_id = ${user.id}
      LIMIT 1
    `;
    const intake = workOrderRows[0]?.intake as Record<string, string> | null;
    if (intake) {
      intakeSummary = Object.entries(intake)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n");
    }
  }

  const client = getClient();

  // Stage 1 — Haiku: extract structured tender requirements
  const stage1 = await client.messages.create({
    model: "claude-3-5-haiku-latest",
    max_tokens: 1500,
    temperature: 0.1,
    messages: [{
      role: "user",
      content: `Extract structured requirements from this tender.

TENDER:
${tenderText}

Return a JSON object with:
- "eligibility_criteria": string[] — who is eligible to bid
- "technical_requirements": string[] — technical/delivery requirements
- "required_documents": string[] — documents to submit
- "evaluation_criteria": string[] — how bids will be scored
- "key_constraints": string[] — budget limits, geography, language, etc.

Return ONLY valid JSON.`,
    }],
  });

  const stage1Text = stage1.content[0]?.type === "text" ? stage1.content[0].text : "{}";
  const tenderRequirements = safeParseJSON(stage1Text, {
    eligibility_criteria: [] as string[],
    technical_requirements: [] as string[],
    required_documents: [] as string[],
    evaluation_criteria: [] as string[],
    key_constraints: [] as string[],
  });

  // Stage 2 — Sonnet: bid/no-bid recommendation
  const stage2 = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 2000,
    temperature: 0.2,
    messages: [{
      role: "user",
      content: `You are a senior bid/no-bid analyst specialising in international development and public sector procurement.

COMPANY PROFILE:
${companyContext}

TENDER REQUIREMENTS (extracted):
${JSON.stringify(tenderRequirements, null, 2)}

TENDER SUMMARY:
${tenderText}${intakeSummary ? `\n\nUSER INTAKE NOTES:\n${intakeSummary}` : ""}

Analyse whether this company should bid on this tender and return a JSON object with:
- "win_probability": number 0-100 — realistic estimate given the company profile vs. requirements
- "recommendation": "Bid" | "No-Bid" | "Conditional"
- "strength_areas": string[] — where the company clearly matches the tender
- "gap_areas": string[] — where the company falls short or faces risk
- "required_documents": string[] — documents the company must prepare for submission
- "effort_estimate": "Low" | "Medium" | "High" — total bid preparation effort
- "key_risks": string[] — top risks if they proceed
- "next_steps": string[] — concrete immediate actions (ordered)

Scoring guide: >65 → Bid, 40-65 → Conditional, <40 → No-Bid.
Be rigorous. Do not inflate scores.

Return ONLY valid JSON.`,
    }],
  });

  const stage2Text = stage2.content[0]?.type === "text" ? stage2.content[0].text : "{}";
  const result = safeParseJSON(stage2Text, {
    win_probability: 30,
    recommendation: "Conditional" as "Bid" | "No-Bid" | "Conditional",
    strength_areas: [] as string[],
    gap_areas: [] as string[],
    required_documents: [] as string[],
    effort_estimate: "Medium" as "Low" | "Medium" | "High",
    key_risks: [] as string[],
    next_steps: [] as string[],
  });

  // Clamp win_probability
  result.win_probability = Math.max(0, Math.min(100, Number(result.win_probability) || 30));

  // Store result
  const inserted = await sql`
    INSERT INTO bid_analyses (
      user_id, pipeline_item_id, tender_id, tender_url,
      stripe_session_id, win_probability, recommendation,
      strength_areas, gap_areas, required_documents,
      effort_estimate, key_risks, next_steps
    ) VALUES (
      ${user.id}, ${pipeline_item_id},
      ${item.tender_id ?? null},
      ${item.t_source_url ?? null},
      ${stripe_session_id},
      ${result.win_probability},
      ${result.recommendation},
      ${JSON.stringify(result.strength_areas)},
      ${JSON.stringify(result.gap_areas)},
      ${JSON.stringify(result.required_documents)},
      ${result.effort_estimate},
      ${JSON.stringify(result.key_risks)},
      ${JSON.stringify(result.next_steps)}
    )
    RETURNING *
  `;

  return NextResponse.json({ analysis: inserted[0] });
}
