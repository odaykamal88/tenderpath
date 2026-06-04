import OpenAI from "openai";
import { sql } from "@/lib/db";
import { FAQ_ANSWERS } from "./content";
import type { BotChannel } from "./types";
import type { LinkedUser } from "./identity";

/**
 * Natural-language answers, grounded in TenderPath product knowledge + (when
 * the chat is linked) the user's own assessment and matches. Reuses the OpenAI
 * client convention from src/lib/ai.ts (gpt-4o-mini, env-configured base URL).
 *
 * Guardrails: answer ONLY from supplied context, never invent tender facts,
 * and degrade to the human-escalation path on any error (returns null → the
 * engine shows the menu / Talk-to-Team).
 */

function getClient(): OpenAI {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
  });
}

function stripHtml(s: string): string {
  return s
    .replace(/<a\s+href="([^"]*)"[^>]*>(.*?)<\/a>/gis, "$2 ($1)")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .trim();
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Condensed product facts the model is allowed to draw on, built once from the
// canned FAQ answers (HTML stripped).
const PRODUCT_KNOWLEDGE = Object.values(FAQ_ANSWERS).map(stripHtml).join("\n\n");

interface AssessmentContextRow {
  company_name: string | null;
  sector: string | null;
  readiness_score: number | null;
  ai_analysis: { summary?: string; sectors?: string[]; detected_industry?: string } | null;
  matched_tenders: Array<{ title?: string; agency?: string; deadline?: string }> | null;
}

async function loadUserContext(user: LinkedUser): Promise<string> {
  const rows = await sql`
    SELECT company_name, sector, readiness_score, ai_analysis, matched_tenders
    FROM assessments
    WHERE LOWER(email) = LOWER(${user.email})
    ORDER BY created_at DESC LIMIT 1
  `;
  const row = rows[0] as AssessmentContextRow | undefined;
  if (!row) {
    return `Signed in as ${user.businessName ?? user.name ?? user.email}, but no completed assessment is on file yet.`;
  }
  const matches = Array.isArray(row.matched_tenders) ? row.matched_tenders.slice(0, 5) : [];
  const matchLines = matches
    .map((m) => `- ${m.title ?? "Untitled"} (${m.agency ?? "agency unknown"})${m.deadline ? `, deadline ${m.deadline}` : ""}`)
    .join("\n");
  return [
    `Company: ${row.company_name ?? user.businessName ?? "unknown"}`,
    `Sector: ${row.sector ?? row.ai_analysis?.detected_industry ?? "unknown"}`,
    row.readiness_score != null ? `Readiness score: ${row.readiness_score}/100` : null,
    row.ai_analysis?.summary ? `Assessment summary: ${row.ai_analysis.summary}` : null,
    matchLines ? `Top matched tenders:\n${matchLines}` : "No matched tenders on file yet.",
  ]
    .filter(Boolean)
    .join("\n");
}

export interface NlAnswer {
  /** HTML-escaped, safe to send through the HTML-parse-mode adapters. */
  text: string;
}

export async function answerQuestion(opts: {
  user: LinkedUser | null;
  channel: BotChannel;
  question: string;
}): Promise<NlAnswer | null> {
  if (!process.env.OPENAI_API_KEY) return null;

  const { user, question } = opts;
  let userContext = "The chat is not linked to an account. Do not reveal or assume any account-specific data.";
  if (user) {
    try {
      userContext = await loadUserContext(user);
    } catch (err) {
      console.error("[bot:nl:context_fail]", err);
    }
  }

  const system =
    `You are the TenderPath assistant inside a chat app. TenderPath is a procurement-intelligence platform that helps businesses find, assess, and win UN contracts and grants.\n` +
    `Answer using ONLY the PRODUCT KNOWLEDGE and USER CONTEXT below.\n` +
    `Rules:\n` +
    `- Be concise: 1–4 short sentences, plain text, friendly.\n` +
    `- NEVER invent tender names, agencies, deadlines, monetary values, or statistics. If a specific detail isn't in the context, say you don't have it to hand and point them to their dashboard or the team.\n` +
    `- For account-specific questions when no user context is available, ask them to connect their account or tap "Talk to Team".\n` +
    `- If the question is off-topic or you're unsure, say briefly that you'll pass it to the team.\n` +
    `- No markdown headings, no HTML.\n\n` +
    `PRODUCT KNOWLEDGE:\n${PRODUCT_KNOWLEDGE}\n\n` +
    `USER CONTEXT:\n${userContext}`;

  try {
    const res = await getClient().chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content: question.slice(0, 500) },
      ],
      temperature: 0.3,
      max_tokens: 300,
    });
    const text = res.choices[0]?.message?.content?.trim();
    if (!text) return null;
    return { text: escapeHtml(text) };
  } catch (err) {
    console.error("[bot:nl:error]", err);
    return null;
  }
}
