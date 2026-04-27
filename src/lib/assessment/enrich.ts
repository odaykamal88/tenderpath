import type { MatchedTender } from "@/lib/types";

const ENRICH_LIMIT = 8;
const FETCH_TIMEOUT_MS = 4500;
const MAX_HTML_CHARS = 500_000;

type DetailEvidence = {
  summary: string | null;
  fetched: boolean;
};

function stripHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function isPageChrome(sentence: string): boolean {
  const lower = sentence.toLowerCase();
  const chromeHits = [
    "this page in",
    "dropdown",
    "email print",
    "tweet share",
    "share linkedin",
    "feedback survey",
    "what we do",
    "projects & operations",
    "skip to main content",
    "privacy notice",
    "terms and conditions",
  ].filter((token) => lower.includes(token)).length;

  return chromeHits >= 2 || lower.startsWith("-->") || lower.split(/\s+/).length > 70;
}

function sentenceSummary(text: string, fallbackTitle: string): string | null {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length < 120) return null;

  const titleWords = new Set(
    fallbackTitle.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 4),
  );
  const sentences = cleaned
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 80 && sentence.length <= 420 && !isPageChrome(sentence));

  const scored = sentences
    .map((sentence) => {
      const lower = sentence.toLowerCase();
      let score = 0;
      for (const word of titleWords) if (lower.includes(word)) score += 2;
      if (/eligib|require|scope|deliver|submission|proposal|supplier|contract|procure|terms of reference/i.test(sentence)) score += 3;
      return { sentence, score };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored.find((item) => item.score > 0);
  return best?.sentence.slice(0, 360) ?? null;
}

async function fetchDetailEvidence(tender: MatchedTender): Promise<DetailEvidence> {
  if (!tender.source_url || !/^https?:\/\//i.test(tender.source_url)) {
    return { summary: null, fetched: false };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(tender.source_url, {
        redirect: "follow",
        signal: controller.signal,
        headers: { "User-Agent": "TenderPath/1.0 (+https://www.tenderpath.me)" },
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok) return { summary: null, fetched: false };
    const contentType = res.headers.get("content-type") ?? "";
    if (!/text\/html|text\/plain|application\/json/i.test(contentType)) {
      return { summary: null, fetched: false };
    }
    const raw = (await res.text()).slice(0, MAX_HTML_CHARS);
    const text = contentType.includes("json") ? raw : stripHtml(raw);
    return { summary: sentenceSummary(text, tender.title), fetched: true };
  } catch {
    return { summary: null, fetched: false };
  }
}

function deadlineNote(deadline: string | null | undefined): string | null {
  if (!deadline) return "Deadline missing; verify the source notice before planning.";
  const time = new Date(deadline).getTime();
  if (Number.isNaN(time)) return "Deadline format is unclear; verify on the source notice.";
  const days = Math.ceil((time - Date.now()) / 86_400_000);
  if (days < 0) return "Deadline may have passed; confirm immediately on the source notice.";
  if (days <= 7) return `Deadline is very close (${days} day${days === 1 ? "" : "s"} left).`;
  if (days <= 21) return `Deadline is approaching (${days} days left).`;
  return null;
}

function confidenceReason(tender: MatchedTender, detail: DetailEvidence): string {
  if (detail.summary) return "Source detail page yielded usable scope text.";
  if (tender.structured_reasons?.evidenceQuality === "rich") return "Structured tender evidence is available.";
  if (detail.fetched) return "Source page loaded but useful scope text was limited.";
  return "Based mostly on listing metadata; source details should be verified.";
}

function sourceConfidence(tender: MatchedTender, detail: DetailEvidence): "high" | "medium" | "low" {
  if (detail.summary || tender.structured_reasons?.evidenceQuality === "rich") return "high";
  if (tender.source_url && detail.fetched) return "medium";
  return "low";
}

function decisionBrief(tender: MatchedTender, detail: DetailEvidence): NonNullable<MatchedTender["decision_brief"]> {
  const summary = tender.structured_reasons?.summary ?? [];
  const caveats = tender.structured_reasons?.caveats ?? [];
  const reasonsToAct = [
    ...summary.filter((line) => !/thin|verify|caveat/i.test(line)).slice(0, 2),
  ];
  if (tender.score >= 70) reasonsToAct.unshift("High fit based on your company profile.");
  else if (tender.score >= 50) reasonsToAct.unshift("Relevant enough to review before the deadline.");
  else if (tender.is_adjacent) reasonsToAct.unshift("Adjacent opportunity worth monitoring.");

  const verifyBeforeBidding = [
    deadlineNote(tender.deadline),
    ...caveats.slice(0, 2),
  ].filter((item): item is string => Boolean(item));

  const recommendedAction =
    tender.score >= 70 && !tender.is_adjacent
      ? "Run bid/no-bid analysis"
      : tender.is_adjacent
      ? "Review source before saving"
      : "Open source notice";

  return {
    headline: detail.summary ?? summary[0] ?? "Review the source notice to confirm scope and eligibility.",
    reasons_to_act: [...new Set(reasonsToAct)].slice(0, 3),
    verify_before_bidding: [...new Set(verifyBeforeBidding)].slice(0, 3),
    recommended_action: recommendedAction,
    source_confidence: sourceConfidence(tender, detail),
    source_confidence_reason: confidenceReason(tender, detail),
  };
}

export async function enrichTopMatches(matches: MatchedTender[]): Promise<MatchedTender[]> {
  const topIds = new Set(matches.slice(0, ENRICH_LIMIT).map((match) => match.id));
  const detailById = new Map<number, DetailEvidence>();

  await Promise.all(
    matches
      .slice(0, ENRICH_LIMIT)
      .map(async (match) => detailById.set(match.id, await fetchDetailEvidence(match))),
  );

  return matches.map((match) => {
    const detail = detailById.get(match.id) ?? { summary: null, fetched: false };
    if (!topIds.has(match.id)) {
      return {
        ...match,
        decision_brief: decisionBrief(match, detail),
      };
    }
    return {
      ...match,
      enriched_summary: detail.summary,
      decision_brief: decisionBrief(match, detail),
    };
  });
}
