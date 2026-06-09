"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { C, F } from "@/components/workbench/tokens";
import { useMedia } from "@/components/workbench/useMedia";
import { FitBadge, DeadlinePill } from "@/components/workbench/ui";
import { bucketMeta } from "@/components/workbench/buckets";
import { TenderOpenLink } from "@/components/telemetry/TenderOpenLink";
import { CountryFilterPills } from "./CountryFilterPills";
import type { OpportunityBucket } from "@/lib/types";

export type Tender = {
  code: string;
  title: string;
  agency: string;
  fit: number;
  deadline: string;
  value: string;
  urgent?: boolean;
  sector?: string | null;
  country?: string | null;
  sourceUrl?: string | null;
  sourceProvenance?: "primary" | "aggregator" | "unknown";
  confidence?: "high" | "medium" | "low" | null;
  bucketLabel?: string | null;
  bucket?: OpportunityBucket | null;
  type?: string | null;
  matchReasons?: string[];
  caveats?: string[];
  decisionHeadline?: string | null;
  // Supplier-portal registration the bidder must complete before submitting.
  // Resolved server-side (keyed off agency) so the deadline-risk flag is a
  // stable request-time value — no Date.now() in render, no hydration drift.
  registration?: {
    portalName: string;
    url: string;
    leadLabel: string;
    risk: "none" | "tight" | "very-tight";
  } | null;
};

function confColor(c: Tender["confidence"]): string {
  if (c === "high") return C.pos;
  if (c === "medium") return C.warn;
  if (c === "low") return C.neg;
  return C.faint;
}
function confLabel(c: Tender["confidence"]): string {
  if (c === "high") return "high confidence";
  if (c === "medium") return "medium confidence";
  if (c === "low") return "low confidence";
  return "confidence unknown";
}

function describeCountries(countries: string[]): string {
  const cleaned = countries.filter(Boolean);
  if (cleaned.length === 0) return "your selected countries";
  if (cleaned.length === 1) return cleaned[0];
  if (cleaned.length === 2) return `${cleaned[0]} or ${cleaned[1]}`;
  return `${cleaned.slice(0, -1).join(", ")}, or ${cleaned[cleaned.length - 1]}`;
}

// Audit 2026-05-19 P1 #6: when the post-filter result list is empty or very
// thin, render an honest empty-state instead of silently showing zero rows.
const THIN_RESULT_THRESHOLD = 3;

export function TendersTab({
  tenders,
  countsByFilter,
  selectedCountries = [],
}: {
  tenders: Tender[];
  countsByFilter: { all: number; strong: number; closing: number };
  selectedCountries?: string[];
}) {
  const mobile = useMedia("(max-width: 860px)");
  const isThin = tenders.length <= THIN_RESULT_THRESHOLD;
  const geoCopy = describeCountries(selectedCountries);

  // Country filter — exclude a dominant funding geography to surface the rest.
  const countryCounts = useMemo<[string, number][]>(() => {
    const m = new Map<string, number>();
    for (const t of tenders) {
      const c = (t.country ?? "").trim();
      if (c) m.set(c, (m.get(c) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [tenders]);
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
  const visible = useMemo(
    () => (excluded.size === 0 ? tenders : tenders.filter((t) => !excluded.has((t.country ?? "").trim()))),
    [tenders, excluded],
  );
  const toggleCountry = (c: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });

  const cols = mobile ? "34px 1fr auto" : "34px 1fr 96px 78px 60px";
  const headStyle: CSSProperties = {
    fontFamily: F.mono,
    fontSize: 9.5,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: C.faint,
  };
  const note = (tag: string, body: string) => (
    <p style={{ fontFamily: F.sans, fontSize: 12.5, color: C.ink2, lineHeight: 1.55, margin: "14px 0 0", display: "flex", gap: 8, flexWrap: "wrap" }}>
      <span style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: C.faint, border: `1px solid ${C.ruleSoft}`, padding: "2px 6px", whiteSpace: "nowrap" }}>{tag}</span>
      <span style={{ flex: 1, minWidth: 200 }}>{body}</span>
    </p>
  );

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16, gap: 16, flexWrap: "wrap" }}>
        <p style={{ fontFamily: F.sans, fontSize: 14, color: C.ink2, lineHeight: 1.55, maxWidth: 620, margin: 0 }}>
          Live tenders matched to your profile, ranked by fit. {countsByFilter.strong} are a strong fit (≥70%)
          {countsByFilter.closing > 0 ? <>; {countsByFilter.closing} close within two weeks.</> : "."}
        </p>
        <span style={{ fontFamily: F.mono, fontSize: 10, color: C.faint, whiteSpace: "nowrap" }}>
          {visible.length} of {countsByFilter.all} shown
        </span>
      </div>

      <CountryFilterPills
        counts={countryCounts}
        excluded={excluded}
        visibleCount={visible.length}
        totalCount={tenders.length}
        noun="tenders"
        onToggle={toggleCountry}
        onClear={() => setExcluded(new Set())}
      />

      {isThin && (
        <div
          style={{
            margin: "12px 0",
            padding: "14px 16px",
            borderLeft: `2px solid ${C.warn}`,
            background: "rgba(176,133,48,0.06)",
            fontFamily: F.sans,
            fontSize: 12.5,
            lineHeight: 1.55,
            color: C.ink2,
          }}
        >
          <div style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: C.warn, marginBottom: 6, fontWeight: 600 }}>
            Thin country supply
          </div>
          {tenders.length === 0
            ? `No live tenders matching ${geoCopy} this week.`
            : `Only ${tenders.length} live tender${tenders.length === 1 ? "" : "s"} in ${geoCopy} this week.`}{" "}
          We hard-filter by country so you don&rsquo;t see off-country noise — broaden your geography by running a new assessment with more countries.
        </div>
      )}

      {!mobile && (
        <div style={{ display: "grid", gridTemplateColumns: cols, gap: 14, padding: "8px 0", borderBottom: `1px solid ${C.ink}` }}>
          <span style={headStyle}>Fit</span>
          <span style={headStyle}>Tender · why this matches</span>
          <span style={headStyle}>Value</span>
          <span style={{ ...headStyle, textAlign: "right" }}>Closes</span>
          <span style={{ ...headStyle, textAlign: "right" }}>Type</span>
        </div>
      )}

      {visible.length === 0 && excluded.size > 0 && note("Filtered", "All matches are from countries you’ve hidden. Re-enable a country above to see them.")}

      {visible.map((t) => {
        const reasons = (t.matchReasons ?? []).filter(Boolean).slice(0, 3);
        const aggregatorWarn = t.sourceProvenance === "aggregator";
        const headline = t.decisionHeadline?.trim() || null;
        const caveats = (t.caveats ?? []).filter(Boolean);
        const hasDetail = reasons.length > 0 || !!headline || caveats.length > 0 || aggregatorWarn;
        const [bLabel, bColor] = t.bucket ? bucketMeta(t.bucket) : [t.bucketLabel ?? null, C.mute];
        const typeShort = t.type ? t.type.split("—")[0].split("/")[0].trim().slice(0, 12) : "—";

        return (
          <div
            key={t.code}
            style={{
              display: "grid",
              gridTemplateColumns: cols,
              gap: 14,
              padding: "13px 0",
              borderBottom: `1px solid ${C.ruleSoft}`,
              alignItems: mobile ? "baseline" : "start",
            }}
          >
            <span style={{ paddingTop: 1 }}>
              <FitBadge score={t.fit} size={mobile ? 15 : 14} />
            </span>

            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: F.sans, fontSize: 13.5, color: C.ink, lineHeight: 1.3 }}>
                {t.sourceUrl ? (
                  <TenderOpenLink
                    href={t.sourceUrl}
                    code={t.code}
                    sourceProvenance={t.sourceProvenance}
                    confidence={t.confidence}
                    fit={t.fit}
                    style={{ color: C.ink, textDecoration: "none", borderBottom: `1px solid ${C.rule}` }}
                  >
                    {t.title}
                  </TenderOpenLink>
                ) : (
                  t.title
                )}
              </div>

              <div
                style={{ fontFamily: F.mono, fontSize: 10, color: C.mute, marginTop: 4, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}
              >
                <span
                  title={confLabel(t.confidence)}
                  style={{ width: 7, height: 7, borderRadius: 999, background: confColor(t.confidence), display: "inline-block", flexShrink: 0 }}
                />
                <span style={{ color: C.faint }}>{t.code}</span>
                {bLabel && (
                  <>
                    <span style={{ color: C.faint }}>·</span>
                    <span style={{ width: 6, height: 6, borderRadius: 999, background: bColor, display: "inline-block" }} />
                    <span>{bLabel}</span>
                  </>
                )}
                <span style={{ color: C.faint }}>· {t.agency.split("—")[0].trim()}</span>
                {t.sector && <span style={{ color: C.faint }}>· {t.sector}</span>}
                {t.country && <span style={{ color: C.faint }}>· {t.country}</span>}
                {mobile && (
                  <span style={{ color: C.ink2 }}>
                    {t.value && t.value !== "—" ? `· ${t.value} ` : ""}· <DeadlinePill deadline={t.deadline} />
                  </span>
                )}
              </div>

              {t.registration && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "baseline", marginTop: 5, fontFamily: F.mono, fontSize: 11, lineHeight: 1.45 }}>
                  <span style={{ fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 600, color: C.faint }}>
                    Register first
                  </span>
                  <a href={t.registration.url} target="_blank" rel="noopener noreferrer" style={{ color: C.ink2, textDecoration: "underline", textUnderlineOffset: 2 }}>
                    {t.registration.portalName}
                  </a>
                  <span style={{ color: C.faint }}>· {t.registration.leadLabel}</span>
                  {t.registration.risk !== "none" && (
                    <span style={{ fontWeight: 600, color: t.registration.risk === "very-tight" ? C.neg : C.warn }}>
                      ⚑ {t.registration.risk === "very-tight" ? "may not finish before the deadline" : "register now — little time left"}
                    </span>
                  )}
                </div>
              )}

              {hasDetail && (
                <details style={{ marginTop: 6, fontFamily: F.sans, fontSize: 13, color: C.ink2 }}>
                  <summary style={{ cursor: "pointer", fontFamily: F.mono, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: C.faint, listStyle: "none" }}>
                    {reasons[0] ?? headline ?? "Why this matched"}
                  </summary>
                  <div style={{ marginTop: 6, lineHeight: 1.5 }}>
                    {headline && <p style={{ fontWeight: 500, margin: "0 0 6px" }}>{headline}</p>}
                    {reasons.length > 0 && (
                      <ul style={{ paddingLeft: 16, margin: "0 0 6px" }}>
                        {reasons.map((r, i) => (
                          <li key={i}>{r}</li>
                        ))}
                      </ul>
                    )}
                    {aggregatorWarn && (
                      <p style={{ margin: "0 0 4px", color: C.warn, fontSize: 12 }}>
                        Aggregator copy — verify with the primary source before bidding.
                      </p>
                    )}
                    {caveats.length > 0 && (
                      <ul style={{ paddingLeft: 16, margin: "4px 0 0", color: C.faint, fontStyle: "italic", fontSize: 12 }}>
                        {caveats.slice(0, 3).map((c, i) => (
                          <li key={i}>{c}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </details>
              )}
            </div>

            {!mobile && (
              <span style={{ fontFamily: F.mono, fontSize: 11.5, color: C.ink2 }}>{t.value || "—"}</span>
            )}
            {!mobile && (
              <span style={{ textAlign: "right" }}>
                <DeadlinePill deadline={t.deadline} />
              </span>
            )}
            {!mobile && (
              <span style={{ fontFamily: F.mono, fontSize: 9.5, letterSpacing: "0.06em", textTransform: "uppercase", color: C.mute, textAlign: "right" }}>
                {typeShort}
              </span>
            )}
          </div>
        );
      })}

      {countsByFilter.all > visible.length && excluded.size === 0 && (
        <div style={{ fontFamily: F.mono, fontSize: 10, color: C.faint, marginTop: 14, letterSpacing: "0.04em" }}>
          Showing {visible.length} of {countsByFilter.all} matched · open the full ranked feed in your Workbench →
        </div>
      )}
    </div>
  );
}
