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

/** GET — fetch existing proposal package for a work order */
export async function GET(request: Request) {
  const guard = await requireAuth(request);
  if (!guard.authorized) return guard.response!;
  const user = guard.user!;

  const url = new URL(request.url);
  const workOrderId = url.searchParams.get("work_order_id");

  if (!workOrderId) {
    return NextResponse.json({ error: "work_order_id is required" }, { status: 400 });
  }

  const rows = await sql`
    SELECT * FROM proposal_packages
    WHERE user_id = ${user.id} AND work_order_id = ${Number(workOrderId)}
    ORDER BY created_at DESC
    LIMIT 1
  `;

  if (!rows.length) return NextResponse.json({ exists: false }, { status: 404 });
  return NextResponse.json({ exists: true, package: rows[0] });
}

/** POST — verify Stripe payment then run two-stage Claude proposal generation */
export async function POST(request: Request) {
  const guard = await requireAuth(request);
  if (!guard.authorized) return guard.response!;
  const user = guard.user!;

  const body = await request.json() as {
    work_order_id?: number;
    stripe_session_id?: string;
  };

  const { work_order_id, stripe_session_id } = body;

  if (!work_order_id) {
    return NextResponse.json({ error: "work_order_id is required" }, { status: 400 });
  }

  // Return existing package without re-generating
  const existing = await sql`
    SELECT * FROM proposal_packages
    WHERE user_id = ${user.id} AND work_order_id = ${work_order_id}
    ORDER BY created_at DESC LIMIT 1
  `;
  if (existing.length) return NextResponse.json({ package: existing[0] });

  // Fetch work order to get context and check payment
  const workOrderRows = await sql`
    SELECT * FROM work_orders
    WHERE id = ${work_order_id} AND (user_id = ${user.id} OR email = ${user.email})
    LIMIT 1
  `;

  if (!workOrderRows.length) {
    return NextResponse.json({ error: "Work order not found" }, { status: 404 });
  }

  const workOrder = workOrderRows[0] as {
    id: number;
    plan: string;
    service_slug: string | null;
    payment_status: string | null;
    stripe_session_id: string | null;
    pipeline_item_id: number | null;
    tender_title: string | null;
    agency: string | null;
    tender_url: string | null;
    intake: Record<string, string> | null;
  };

  // Determine plan from service_slug or plan field
  const plan = workOrder.service_slug ?? workOrder.plan;
  const isProposal = plan.includes("proposal");
  const isRoster = plan.includes("roster") || plan.includes("lta");

  if (!isProposal && !isRoster) {
    return NextResponse.json({ error: "This work order is not a proposal or roster service." }, { status: 400 });
  }

  // Verify payment: check work order status first, then Stripe session
  const alreadyPaid = workOrder.payment_status === "paid";

  if (!alreadyPaid) {
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

    // Prevent session reuse
    const sessionUsed = await sql`
      SELECT id FROM proposal_packages WHERE stripe_session_id = ${stripe_session_id}
    `;
    if (sessionUsed.length) {
      return NextResponse.json({ error: "This payment session has already been used" }, { status: 400 });
    }
  }

  const sessionId = stripe_session_id ?? workOrder.stripe_session_id ?? null;

  // Fetch pipeline item + linked tender data if available
  let tenderText = "";
  let pipelineItemId: number | null = workOrder.pipeline_item_id;

  if (pipelineItemId) {
    const pipelineRows = await sql`
      SELECT
        pi.id, pi.tender_id, pi.tender_title, pi.tender_agency,
        pi.tender_deadline, pi.tender_value,
        t.description AS t_description,
        t.source_name,
        t.opportunity_type,
        t.sector,
        t.eligibility_summary,
        t.requirements,
        t.source_url AS t_source_url
      FROM pipeline_items pi
      LEFT JOIN tenders t ON t.id = pi.tender_id
      WHERE pi.id = ${pipelineItemId} AND pi.user_id = ${user.id}
    `;

    if (pipelineRows.length) {
      const item = pipelineRows[0];
      tenderText = [
        `Title: ${item.tender_title}`,
        item.tender_agency ? `Agency: ${item.tender_agency}` : null,
        item.source_name ? `Source: ${item.source_name}` : null,
        item.opportunity_type ? `Opportunity Type: ${item.opportunity_type}` : null,
        item.sector ? `Sector/Category: ${item.sector}` : null,
        item.tender_value ? `Estimated Value: ${item.tender_value}` : null,
        item.tender_deadline ? `Deadline: ${item.tender_deadline}` : null,
        item.t_description ? `\nDescription:\n${item.t_description}` : null,
        item.eligibility_summary ? `\nEligibility:\n${item.eligibility_summary}` : null,
      ].filter(Boolean).join("\n");
    }
  }

  // Fall back to work order fields when no pipeline item
  if (!tenderText) {
    tenderText = [
      workOrder.tender_title ? `Title: ${workOrder.tender_title}` : null,
      workOrder.agency ? `Agency: ${workOrder.agency}` : null,
      workOrder.tender_url ? `Source URL: ${workOrder.tender_url}` : null,
    ].filter(Boolean).join("\n") || "No tender details provided.";
  }

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

  const intake = workOrder.intake ?? {};
  const intakeSummary = Object.entries(intake)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");

  const client = getClient();

  try {
    // Stage 1 — Haiku: extract structured requirements from the tender
    const stage1 = await client.messages.create({
      model: "claude-3-5-haiku-latest",
      max_tokens: 1500,
      temperature: 0.1,
      messages: [{
        role: "user",
        content: `Extract structured requirements from this tender or opportunity.

TENDER/OPPORTUNITY:
${tenderText}

Return a JSON object with:
- "eligibility_criteria": string[] — who is eligible
- "technical_requirements": string[] — technical/delivery scope
- "required_documents": string[] — documents to submit
- "evaluation_criteria": string[] — how submissions will be scored
- "key_constraints": string[] — budget limits, geography, language, timeline
- "submission_format": string — portal, email, physical, or unknown

Return ONLY valid JSON.`,
      }],
    });

    const stage1Text = stage1.content[0]?.type === "text" ? stage1.content[0].text : "{}";
    const requirements = safeParseJSON(stage1Text, {
      eligibility_criteria: [] as string[],
      technical_requirements: [] as string[],
      required_documents: [] as string[],
      evaluation_criteria: [] as string[],
      key_constraints: [] as string[],
      submission_format: "unknown",
    });

    let output: Record<string, unknown>;

    if (isProposal) {
      // Stage 2 — Sonnet: generate full proposal package
      const stage2 = await client.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 4000,
        temperature: 0.3,
        messages: [{
          role: "user",
          content: `You are a senior proposal writer specialising in UN, donor, and public sector procurement.

COMPANY PROFILE:
${companyContext}

TENDER REQUIREMENTS (extracted):
${JSON.stringify(requirements, null, 2)}

TENDER SUMMARY:
${tenderText}

USER INTAKE NOTES:
${intakeSummary || "None provided."}

Prepare a structured proposal package. Return a JSON object with:
- "executive_summary": string — 2-3 paragraph summary of the company's offer and fit for this tender
- "technical_approach": string[] — ordered paragraphs describing approach, methodology, and delivery plan
- "compliance_checklist": string[] — checklist items mapping each tender requirement to a compliance action
- "required_documents": string[] — complete list of documents to prepare and submit
- "cover_letter_draft": string — professional cover letter addressed to the contracting agency
- "financial_template_notes": string[] — guidance on pricing structure, cost breakdowns, and budget format
- "missing_information": string[] — gaps the user must fill before submission (e.g. references, certificates)
- "next_steps": string[] — ordered immediate actions to complete submission

Be specific. Use the company profile and tender requirements together. Do not invent facts.
Return ONLY valid JSON.`,
        }],
      });

      const stage2Text = stage2.content[0]?.type === "text" ? stage2.content[0].text : "{}";
      output = safeParseJSON(stage2Text, {
        executive_summary: "",
        technical_approach: [] as string[],
        compliance_checklist: [] as string[],
        required_documents: [] as string[],
        cover_letter_draft: "",
        financial_template_notes: [] as string[],
        missing_information: [] as string[],
        next_steps: [] as string[],
      });
    } else {
      // Stage 2 — Sonnet: generate roster/LTA package
      const stage2 = await client.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 3500,
        temperature: 0.3,
        messages: [{
          role: "user",
          content: `You are a senior procurement advisor specialising in UN agency vendor rosters and Long-Term Agreements.

COMPANY PROFILE:
${companyContext}

TARGET OPPORTUNITY / AGENCY:
${tenderText}

EXTRACTED REQUIREMENTS:
${JSON.stringify(requirements, null, 2)}

USER INTAKE NOTES:
${intakeSummary || "None provided."}

Prepare a structured roster / LTA application package. Return a JSON object with:
- "registration_checklist": string[] — step-by-step agency registration or roster application steps
- "capability_statement_draft": string — 2-3 paragraph capability statement tailored to the agency/roster
- "required_documents": string[] — complete list of documents to prepare and submit
- "organization_profile_notes": string[] — guidance on how to present the company profile for this roster
- "cover_letter_draft": string — professional cover letter for the roster/LTA application
- "submission_guidance": string[] — practical submission tips, common pitfalls, and portal navigation notes
- "missing_information": string[] — gaps the user must fill (e.g. DUNS number, audit reports, references)
- "next_steps": string[] — ordered immediate actions to complete application

Be specific to the target agency and the company's profile. Do not invent facts.
Return ONLY valid JSON.`,
        }],
      });

      const stage2Text = stage2.content[0]?.type === "text" ? stage2.content[0].text : "{}";
      output = safeParseJSON(stage2Text, {
        registration_checklist: [] as string[],
        capability_statement_draft: "",
        required_documents: [] as string[],
        organization_profile_notes: [] as string[],
        cover_letter_draft: "",
        submission_guidance: [] as string[],
        missing_information: [] as string[],
        next_steps: [] as string[],
      });
    }

    // Store result
    const inserted = await sql`
      INSERT INTO proposal_packages (
        user_id, work_order_id, pipeline_item_id, plan,
        tender_title, agency, tender_url, intake, stripe_session_id, output
      ) VALUES (
        ${user.id},
        ${work_order_id},
        ${pipelineItemId ?? null},
        ${isProposal ? "proposal-draft" : "roster-fast-track"},
        ${workOrder.tender_title ?? null},
        ${workOrder.agency ?? null},
        ${workOrder.tender_url ?? null},
        ${JSON.stringify(intake)},
        ${sessionId},
        ${JSON.stringify(output)}
      )
      RETURNING *
    `;

    return NextResponse.json({ package: inserted[0] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown generation error";
    console.error("[api/proposals/generate] generation failed", { work_order_id, error: msg });
    await sql`
      UPDATE work_orders
      SET fulfillment_notes = ${`Generation failed: ${msg}`}, updated_at = NOW()
      WHERE id = ${work_order_id}
    `.catch(() => {});
    return NextResponse.json(
      { error: "Package generation failed. Our team has been notified." },
      { status: 500 }
    );
  }
}
