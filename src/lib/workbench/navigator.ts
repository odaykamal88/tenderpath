/* Gap Navigator scripts.
 *
 * The Navigator is the product's "hold your hand" promise: a conversational,
 * step-by-step drawer that walks a user through closing a readiness gap.
 *
 * Real gaps come from the assessment as { gap, fix, action_steps[], severity }
 * — they carry no hand-authored walkthrough. This module:
 *   1. detects a recognized gap *type* (ungm, financials, iso-9001, …) so we
 *      can attach a rich, pre-filled script (copy blocks from the real company
 *      profile, official portal links, the UNGM levels table, …); and
 *   2. falls back to building steps from the assessment's own action_steps for
 *      any gap we don't recognize — so every gap is still walkable.
 *
 * Pre-filled copy blocks are emitted ONLY when the underlying value is real
 * (e.g. we never invent a registration number). When a value is unknown the
 * step instructs the user in plain language instead. */

import type { Gap } from "@/lib/types";
import type { NavigatorScript, NavigatorStep } from "./types";

export interface NavigatorCompany {
  legalName: string | null;
  regNo: string | null;
  incorporated: string | null; // year or date
  country: string | null;
  email: string | null;
}

const TYPE_PATTERNS: { type: string; pattern: RegExp }[] = [
  { type: "ungm", pattern: /\bUNGM\b|UN Global Marketplace|vendor registration|supplier registration/i },
  { type: "financials", pattern: /audited?.*financ|audited statement|financial statement|balance sheet|profit (?:and|&) loss/i },
  { type: "iso-9001", pattern: /\bISO\s*9001|quality management/i },
  { type: "iso-14001", pattern: /\bISO\s*14001|environmental management/i },
  { type: "iso-27001", pattern: /\bISO\s*27001|information security management/i },
  { type: "references", pattern: /past performance|reference contracts?|reference letter|project references?|track record/i },
  { type: "hs-policy", pattern: /health (?:and|&) safety/i },
  { type: "code-of-conduct", pattern: /code of conduct|anti-?corruption/i },
  { type: "safeguarding", pattern: /\bPSEA\b|safeguarding|sexual exploitation/i },
];

/** Recognized gap type for routing/deep-linking, or null. */
export function detectGapType(gap: Gap): string | null {
  const haystack = `${gap.gap}\n${gap.fix}\n${(gap.action_steps ?? []).join("\n")}`;
  for (const { type, pattern } of TYPE_PATTERNS) {
    if (pattern.test(haystack)) return type;
  }
  return null;
}

/** Stable key for a gap: its recognized type, else g{index}. Multiple gaps of
 *  the same recognized type are disambiguated with a -{index} suffix. */
export function gapKey(gap: Gap, idx: number, seen: Set<string>): string {
  const type = detectGapType(gap);
  if (!type) return `g${idx}`;
  if (!seen.has(type)) {
    seen.add(type);
    return type;
  }
  return `${type}-${idx}`;
}

function fallbackSteps(gap: Gap): NavigatorStep[] {
  const steps = (gap.action_steps ?? []).filter((s) => s && s.trim().length > 0);
  if (steps.length === 0) {
    return [{ t: gap.fix || "Close this gap", detail: gap.fix || "" }];
  }
  return steps.map((s) => {
    // Split "Title: detail" or "Title — detail" into title + body when present.
    const m = s.match(/^(.{4,60}?)[:—-]\s+(.+)$/);
    if (m) return { t: m[1].trim(), detail: m[2].trim() };
    return { t: s.length > 70 ? s.slice(0, 67) + "…" : s, detail: s };
  });
}

function ungmScript(c: NavigatorCompany): NavigatorScript {
  const identityParts = [c.legalName, c.regNo, c.incorporated].filter(Boolean);
  const identityStep: NavigatorStep = {
    t: "Company identity",
    detail:
      "Your legal name must match your registration documents exactly" +
      (c.country ? `. Country: ${c.country}.` : ".") +
      (identityParts.length > 1
        ? " I've pulled the details below from your profile — copy them straight in."
        : " Enter your legal name, registration number, and incorporation year."),
  };
  if (identityParts.length > 1) identityStep.copy = identityParts.join(" · ");

  return {
    kind: "guided",
    est: "~15 minutes · free",
    intro:
      "UNGM — the UN Global Marketplace — is one free registration that 30+ agencies screen against before anyone reads your bid. It's the highest-leverage thing you can do this week, and most of it I can pre-fill from your profile. I'll stay with you field by field.",
    steps: [
      {
        t: "Create the account",
        detail:
          "Open the UNGM portal, choose New registration → Company, and use your official domain email" +
          (c.email ? ` (${c.email})` : "") +
          " — agencies cross-check it against your website.",
        link: "ungm.org/Account/Registration",
      },
      identityStep,
      {
        t: "Pick your UNSPSC codes",
        detail:
          "These are the codes agencies filter by. Add the codes that match your sectors so you appear in the widest set of searches — pick three to start.",
      },
      {
        t: "Attach your core documents",
        detail:
          "Certificate of incorporation and a bank reference letter. If they're already in your Vault I've queued them so you can download and upload in one go.",
        link: "vault",
      },
      {
        t: "Submit at Basic level — then stop",
        detail:
          "Don't over-invest now. Basic registration is free, instant, and enough to appear in agency searches. The higher levels need extra documents and review time you don't need yet — I'll prompt you to upgrade the first time a matched tender actually requires it.",
        link: "ungm.org/Account/Registration",
        levels: [
          ["Basic", "Free · instant", "Appear in searches, receive notices, bid on most RFQ/RFP"],
          ["Level 1", "+ Financial docs · ~2 days review", "Larger contracts; some agencies require it to award"],
          ["Level 2", "+ Audited accounts, QA review", "High-value / framework agreements (LTAs)"],
        ],
      },
    ],
    done: "Registered — agencies can now find you",
  };
}

function financialsScript(): NavigatorScript {
  return {
    kind: "guided",
    est: "~20 minutes",
    intro:
      "You don't need to create anything new here — you almost certainly already have these. We just need your last three years of audited statements on file so the system can attach them automatically when a tender demands them.",
    steps: [
      {
        t: "Gather the three years",
        detail:
          "Request signed audited statements (ISA-standard preferred) for the last three fiscal years from your finance lead or external auditor.",
      },
      {
        t: "Convert and tag",
        detail:
          "Export each as PDF/A and name them clearly with the fiscal year, e.g. Audited_FY24.pdf — the year in the filename lets us route each to the right tender field.",
      },
      {
        t: "Upload to the Vault",
        detail:
          "Drop all three under Financials → Audited statements. We checksum and date-stamp them so officers can verify they're untouched.",
        link: "vault",
      },
    ],
    done: "Audited financials on file",
  };
}

function isoScript(standard: string, area: string): NavigatorScript {
  return {
    kind: "guided",
    est: "6–8 weeks · external cost",
    intro: `This one's a project, not a task — a realistic timeline is 6–8 weeks through an accredited certifier. I'll lay out the path so it runs in the background while you keep bidding. Nothing here blocks the work you can win today.`,
    steps: [
      {
        t: `Scope your ${area} system`,
        detail:
          "Decide which sites and services the certificate covers. Match the scope statement to the sectors in your profile so it reads as relevant to evaluators.",
      },
      {
        t: "Choose an accredited body",
        detail:
          "Use a nationally- or UKAS-accredited certifier (e.g. Bureau Veritas, SGS, TÜV). Avoid non-accredited 'certificates' — agencies reject them at screening.",
        link: "iso.org/certification",
      },
      {
        t: "Run a gap audit",
        detail:
          "A short pre-assessment shows what documentation you're missing. We can hand the auditor your Vault to speed this up.",
        link: "vault",
      },
      {
        t: "Stage 1 & 2 assessment",
        detail:
          "Stage 1 reviews documents; Stage 2 is the on-site audit. Budget 3–4 weeks between them for fixes.",
      },
    ],
    done: `${standard} certification in progress`,
  };
}

function referencesScript(): NavigatorScript {
  return {
    kind: "guided",
    est: "~1 week",
    intro:
      "You're likely one reference short of the comfortable threshold most evaluators want. The fastest win is a short, specific ask to a client whose project mirrors the tenders you're chasing.",
    steps: [
      {
        t: "Pick the right client",
        detail:
          "Choose a project completed in the last 36 months that's close to your target sectors. Relevance beats prestige here.",
      },
      {
        t: "Send the request",
        detail:
          "Write a short reference-letter request naming the project and the points evaluators look for, then send it to your contact.",
        copy: "Subject: Quick reference letter — [Project name]",
      },
      {
        t: "File the signed PDF",
        detail:
          "Once returned, attach it in the Vault under Past performance. We'll surface it automatically on matching bids.",
        link: "vault",
      },
    ],
    done: "Additional reference letter on file",
  };
}

function reviewScript(intro: string): NavigatorScript {
  return { kind: "review", est: "On file", intro, steps: [], done: "Reviewed" };
}

/** Build the Navigator script for a gap, enriching recognized types from the
 *  real company profile and falling back to the assessment's action_steps. */
export function buildNavigatorScript(gap: Gap, company: NavigatorCompany): NavigatorScript {
  const type = detectGapType(gap);
  switch (type) {
    case "ungm":
      return ungmScript(company);
    case "financials":
      return financialsScript();
    case "iso-9001":
      return isoScript("ISO 9001", "quality management");
    case "iso-14001":
      return isoScript("ISO 14001", "environmental management");
    case "iso-27001":
      return isoScript("ISO 27001", "information security");
    case "references":
      return referencesScript();
    case "hs-policy":
      return reviewScript(
        "This is a policy document — if a current, leadership-signed version is in your Vault you're covered. Re-check the signature date annually.",
      );
    case "code-of-conduct":
      return reviewScript(
        "A standard one-page Code of Conduct / anti-corruption statement on file satisfies most agency onboarding. Confirm it's in your Vault.",
      );
    default: {
      const steps = fallbackSteps(gap);
      return {
        kind: "guided",
        est: gap.severity === "high" ? "Worth doing this week" : "When you have a moment",
        intro:
          gap.fix ||
          "Here's how to close this gap. Work through each step — I'll keep your progress and re-check it against your Vault.",
        steps,
        done: "Gap addressed",
      };
    }
  }
}

/** Short effort label for the gap register, derived from the script estimate. */
export function effortLabel(script: NavigatorScript, severity: Gap["severity"]): string {
  if (script.est && script.est !== "On file") {
    // "~15 minutes · free" → "15 min"; "6–8 weeks · external cost" → "6–8 weeks"
    const head = script.est.split("·")[0].trim();
    return head.replace(/^~/, "").replace("minutes", "min");
  }
  return severity === "high" ? "Priority" : "—";
}
