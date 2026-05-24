/**
 * brand/tokens.ts — single source of truth for TenderPath brand tokens.
 *
 * Sprint 6 scope (proposal-output-ux.md PART B + readiness-output-ux.md):
 * lifts the GOLD / INK / INK2 / INK3 / RULE / RED / GREEN palette from
 * pdfDocs.tsx into a shared module so screens AND PDFs reuse the same
 * source. The PDF renderer consumes BRAND_COLORS hex values directly;
 * the React screens consume them inline OR map to Tailwind utility
 * classes via the helpers below.
 *
 * No font-loading happens here — the SERIF / MONO stacks are CSS
 * font-family strings that the @next/font-loaded fonts (Fraunces, IBM
 * Plex Mono) satisfy. Keep the literal strings stable across
 * pdfDocs.tsx + screens.
 */

import type { Confidence, ServiceSku } from "@/lib/proposal-package/scoring-engine";

// ============================================================================
// Fonts — must stay in lockstep with the @next/font imports
// ============================================================================

export const BRAND_FONTS = {
  mono: "'IBM Plex Mono', 'SF Mono', ui-monospace, monospace",
  serif: "'Fraunces', 'Times New Roman', serif",
} as const;

// Legacy aliases — preserved so existing screens that destructure these
// names from inline constants don't need to be rewritten on import.
export const MONO = BRAND_FONTS.mono;
export const SERIF = BRAND_FONTS.serif;

// ============================================================================
// Color palette — hex values consumed by pdfDocs.tsx + inline CSS
// ============================================================================

export const BRAND_COLORS = {
  gold: "#b08530",
  ink: "#1a1a1a",
  ink2: "#4a4a4a",
  ink3: "#6b6b6b",
  rule: "#d8d0bd",
  red: "#b8463f",
  green: "#1f6a3c",
  paperBg: "#f5f1e8",
} as const;

// ============================================================================
// Semantic tone helpers — used by the proposal output page + readiness page
// ============================================================================

/**
 * Map a Confidence enum value onto BOTH a hex color (for PDF / inline CSS)
 * AND a Tailwind utility class (for React components that already speak
 * stone-* / emerald-* / amber-* / red-*). Returning both lets components
 * pick whichever fits their rendering pattern.
 */
export function confidenceTone(c: Confidence): {
  hex: string;
  tw: string;
  bg: string;
  border: string;
  label: string;
} {
  switch (c) {
    case "evidenced":
      return {
        hex: BRAND_COLORS.green,
        tw: "text-emerald-700",
        bg: "bg-emerald-50/60",
        border: "border-emerald-200",
        label: "Evidenced",
      };
    case "inferred":
      return {
        hex: BRAND_COLORS.gold,
        tw: "text-amber-700",
        bg: "bg-amber-50/60",
        border: "border-amber-200",
        label: "Inferred",
      };
    case "gap":
      return {
        hex: BRAND_COLORS.red,
        tw: "text-red-700",
        bg: "bg-red-50/60",
        border: "border-red-200",
        label: "Gap",
      };
    case "unverified":
    default:
      return {
        hex: BRAND_COLORS.ink3,
        tw: "text-stone-500",
        bg: "bg-stone-50",
        border: "border-stone-200",
        label: "Unverified",
      };
  }
}

/**
 * Map a ServiceSku onto display tokens for the routed-gap CTAs.
 * Roster is the warmest (amber — long-arc structural fix), Bid/No-Bid
 * is red (urgency — catch admin gates), Matching is neutral stone
 * (recurring), Proposal Draft is emerald (the high-trust output).
 */
export function skuTone(sku: ServiceSku): {
  tw: string;
  bg: string;
  border: string;
  badge: string;
} {
  switch (sku) {
    case "roster":
      return {
        tw: "text-amber-900",
        bg: "bg-amber-50/70",
        border: "border-amber-300",
        badge: "bg-amber-700",
      };
    case "matching":
      return {
        tw: "text-stone-900",
        bg: "bg-stone-50",
        border: "border-stone-300",
        badge: "bg-stone-700",
      };
    case "bid_no_bid":
      return {
        tw: "text-red-900",
        bg: "bg-red-50/70",
        border: "border-red-300",
        badge: "bg-red-700",
      };
    case "proposal_draft":
      return {
        tw: "text-emerald-900",
        bg: "bg-emerald-50/70",
        border: "border-emerald-300",
        badge: "bg-emerald-700",
      };
  }
}
