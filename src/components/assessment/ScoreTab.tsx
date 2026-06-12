"use client";

import Link from "next/link";
import { useState, type CSSProperties } from "react";
import { C, F } from "@/components/workbench/tokens";
import { useMedia } from "@/components/workbench/useMedia";
import { Eyebrow, Bar, FitBadge, DeadlinePill } from "@/components/workbench/ui";
import { HowWeCalculate } from "./trust/HowWeCalculateSheet";
import SignupSheet from "@/app/assessment/SignupSheet";

export type Dimension = { label: string; value: number; peer?: number };

// Kept exported for the email-completion template — see src/lib/email/sendAssessment.ts.
export type TenderPeek = {
  code: string;
  title: string;
  agency: string;
  fit: number;
  deadline: string;
  urgent?: boolean;
  sector?: string | null;
  matchReason?: string | null;
  confidence?: "high" | "medium" | "low" | null;
  sourceUrl?: string | null;
};

export type ViewerActivity = {
  pipeline: { total: number; applied: number; inProgress: number; saved: number };
  services: {
    active: { id: number; service: string; status: string; tender_title?: string | null }[];
    activeCount: number;
  };
};

function dimTag(v: number): [string, string] {
  if (v >= 75) return ["Strong", C.pos];
  if (v >= 60) return ["Workable", C.mute];
  return ["Gap", C.neg];
}

export function ScoreTab({
  score,
  delta,
  tier,
  summary,
  dimensions,
  topTenders = [],
  matchedCount = 0,
  viewerSignedIn = false,
  activity,
}: {
  score: number;
  delta: number;
  tier: string;
  summary: string;
  dimensions: Dimension[];
  topTenders?: TenderPeek[];
  matchedCount?: number;
  viewerSignedIn?: boolean;
  activity?: ViewerActivity | null;
  recommendedTier?: { name: string; price: string; pitch: string };
}) {
  const mobile = useMedia("(max-width: 860px)");
  const [signupOpen, setSignupOpen] = useState(false);
  const peek = topTenders.slice(0, 4);
  const activeCount = activity?.services.activeCount ?? 0;

  const ctaLinkStyle: CSSProperties = {
    background: C.accent,
    color: C.white,
    border: `1px solid ${C.accent}`,
    fontFamily: F.mono,
    fontSize: 11.5,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    padding: "11px 18px",
    marginTop: 16,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    textDecoration: "none",
    cursor: "pointer",
    width: "100%",
    boxSizing: "border-box",
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr" : "1.05fr 0.95fr", gap: mobile ? 28 : 52 }}>
      {/* left — score + dimensions */}
      <div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
          <span
            role="meter"
            aria-label={`Readiness score ${score} of 100`}
            aria-valuenow={score}
            aria-valuemin={0}
            aria-valuemax={100}
            style={{
              fontFamily: F.display,
              fontSize: mobile ? 104 : 150,
              fontWeight: 400,
              lineHeight: 0.82,
              letterSpacing: "-0.045em",
              color: C.ink,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {score}
          </span>
          <div>
            <div style={{ fontFamily: F.display, fontSize: mobile ? 24 : 32, color: C.faint }}>/100</div>
            {delta > 0 && (
              <div
                style={{
                  fontFamily: F.mono,
                  fontSize: 10.5,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: C.pos,
                  marginTop: 8,
                  whiteSpace: "nowrap",
                }}
              >
                ↑ +{delta} from resolved gaps
              </div>
            )}
          </div>
        </div>
        <div
          style={{
            fontFamily: F.mono,
            fontSize: 11,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: C.accent,
            marginTop: 12,
          }}
        >
          {tier}
        </div>
        <p style={{ fontFamily: F.sans, fontSize: 14, color: C.ink2, lineHeight: 1.55, marginTop: 10, maxWidth: 500 }}>
          {summary}
        </p>

        <div style={{ marginTop: 26, paddingTop: 8, borderTop: `1px solid ${C.rule}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
            <Eyebrow>By dimension</Eyebrow>
            <HowWeCalculate label="How scored?" color={C.faint} withGlyph={false} />
          </div>
          {dimensions.map((d) => {
            const [tag, tagColor] = dimTag(d.value);
            return (
              <div
                key={d.label}
                style={{
                  display: "grid",
                  gridTemplateColumns: "130px 1fr 36px 64px",
                  gap: 12,
                  alignItems: "center",
                  padding: "9px 0",
                  borderBottom: `1px dashed ${C.ruleSoft}`,
                }}
              >
                <span style={{ fontFamily: F.sans, fontSize: 13, color: C.ink }}>{d.label}</span>
                <Bar value={d.value} />
                <span
                  style={{
                    fontFamily: F.mono,
                    fontSize: 12.5,
                    color: C.ink,
                    textAlign: "right",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {d.value}
                </span>
                <span
                  style={{
                    fontFamily: F.mono,
                    fontSize: 9,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: tagColor,
                    textAlign: "right",
                  }}
                >
                  {tag}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* right — tender peek + enter CTA */}
      <div>
        {peek.length > 0 && (
          <>
            <Eyebrow style={{ marginBottom: 10 }}>Peek · top matched tenders</Eyebrow>
            <div style={{ background: C.white, border: `1px solid ${C.rule}` }}>
              {peek.map((m, i) => (
                <div
                  key={m.code}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 36px 54px",
                    gap: 10,
                    padding: "11px 14px",
                    borderBottom: i < peek.length - 1 ? `1px solid ${C.ruleSoft}` : "none",
                    alignItems: "center",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontFamily: F.mono,
                        fontSize: 9.5,
                        color: C.faint,
                        letterSpacing: "0.04em",
                        marginBottom: 2,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {m.code} · {m.agency.split("—")[0].trim()}
                    </div>
                    <div
                      style={{
                        fontFamily: F.sans,
                        fontSize: 12.5,
                        color: C.ink,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {m.title}
                    </div>
                  </div>
                  <FitBadge score={m.fit} size={12.5} />
                  <span style={{ textAlign: "right" }}>
                    <DeadlinePill deadline={m.deadline} />
                  </span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 8 }}>
              <span style={{ fontFamily: F.mono, fontSize: 9.5, color: C.faint }}>
                {peek.length} of {matchedCount || peek.length} matched
              </span>
            </div>
          </>
        )}

        {/* CTA → workbench (signed-in) or sign-up (anonymous) */}
        <div style={{ marginTop: peek.length > 0 ? 22 : 0, padding: 22, background: C.ink, color: C.paper }}>
          <Eyebrow color={C.accent2}>Your report is ready</Eyebrow>
          <div
            style={{
              fontFamily: F.display,
              fontSize: 22,
              fontWeight: 400,
              lineHeight: 1.15,
              color: C.paper,
              margin: "10px 0 6px",
            }}
          >
            {viewerSignedIn ? "Open the Workbench to act on it." : "Open your Workbench to act on it."}
          </div>
          <p style={{ fontFamily: F.sans, fontSize: 12.5, color: "#cdc6b3", lineHeight: 1.5, margin: 0 }}>
            {viewerSignedIn
              ? `Your score, ${matchedCount || peek.length} live matches, and a guided path through every gap.`
              : `Your score, ${matchedCount || peek.length} live matches, and a guided path through every gap — your 30-day trial starts when you do, no card.`}
          </p>

          {viewerSignedIn ? (
            <Link href="/dashboard" style={ctaLinkStyle}>
              Enter your Workbench →
            </Link>
          ) : (
            <button type="button" onClick={() => setSignupOpen(true)} style={ctaLinkStyle}>
              Save report → sign up
            </button>
          )}

          {viewerSignedIn && activeCount > 0 && (
            <Link
              href="/dashboard/work-orders"
              style={{
                display: "block",
                marginTop: 12,
                fontFamily: F.mono,
                fontSize: 9.5,
                letterSpacing: "0.06em",
                color: "rgba(246,243,236,0.62)",
                textDecoration: "none",
              }}
            >
              {activeCount} {activeCount === 1 ? "service" : "services"} in flight ↗
            </Link>
          )}
        </div>
      </div>

      {!viewerSignedIn && <SignupSheet open={signupOpen} onClose={() => setSignupOpen(false)} />}
    </div>
  );
}
