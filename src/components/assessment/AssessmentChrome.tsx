"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { C, F } from "@/components/workbench/tokens";
import { useMedia } from "@/components/workbench/useMedia";
import { Eyebrow } from "@/components/workbench/ui";
import { AssessmentActions } from "./AssessmentActions";
import { HowWeCalculate } from "./trust/HowWeCalculateSheet";

type TabKey = "score" | "gaps" | "tenders" | "grants" | "next";

const TABS: { key: TabKey; label: string }[] = [
  { key: "score", label: "Score" },
  { key: "gaps", label: "Gaps" },
  { key: "tenders", label: "Tenders" },
  { key: "grants", label: "Grants" },
  { key: "next", label: "Next steps" },
];

function ReportHeader({
  companyName,
  displayNumber,
  reportId,
  mobile,
}: {
  companyName: string;
  displayNumber: string;
  reportId: string;
  mobile: boolean;
}) {
  return (
    <div
      className="report-masthead"
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-end",
        paddingBottom: 14,
        borderBottom: `1px solid ${C.ink}`,
        gap: 16,
        flexWrap: "wrap",
      }}
    >
      <div>
        <Eyebrow color={C.accent}>Vendor readiness · No. {displayNumber}</Eyebrow>
        <div
          style={{
            fontFamily: F.display,
            fontSize: mobile ? 22 : 28,
            fontWeight: 400,
            letterSpacing: "-0.015em",
            color: C.ink,
            marginTop: 4,
          }}
        >
          {companyName}
        </div>
      </div>
      <div style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
        <HowWeCalculate />
        <AssessmentActions reportId={reportId} />
      </div>
    </div>
  );
}

function TabBar({
  active,
  basePath,
  counts,
  preparedAt,
  mobile,
}: {
  active: TabKey;
  basePath: string;
  counts?: Partial<Record<TabKey, number>>;
  preparedAt: string;
  mobile: boolean;
}) {
  if (mobile) {
    return (
      <div
        role="tablist"
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${TABS.length}, 1fr)`,
          border: `1px solid ${C.rule}`,
          background: C.white,
          margin: "16px 0 18px",
        }}
      >
        {TABS.map((t, i) => {
          const on = active === t.key;
          const count = counts?.[t.key];
          return (
            <Link
              key={t.key}
              href={`${basePath}?tab=${t.key}`}
              role="tab"
              aria-selected={on}
              style={{
                padding: "9px 2px",
                textAlign: "center",
                borderRight: i < TABS.length - 1 ? `1px solid ${C.rule}` : "none",
                background: on ? C.ink : "transparent",
                color: on ? C.paper : C.ink2,
                fontFamily: F.mono,
                fontSize: 9.5,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                textDecoration: "none",
                lineHeight: 1.3,
              }}
            >
              {t.label === "Next steps" ? "Next" : t.label}
              {count != null && (
                <div style={{ fontSize: 8.5, color: on ? C.accent : C.mute, marginTop: 1 }}>{count}</div>
              )}
            </Link>
          );
        })}
      </div>
    );
  }

  const tabStyle = (on: boolean): CSSProperties => ({
    padding: "11px 22px 13px",
    marginBottom: -1,
    display: "flex",
    gap: 8,
    alignItems: "baseline",
    borderBottom: on ? `2px solid ${C.ink}` : "2px solid transparent",
    color: on ? C.ink : C.mute,
    fontWeight: on ? 600 : 400,
    fontFamily: F.sans,
    fontSize: 13.5,
    textDecoration: "none",
    transition: "color .12s",
  });

  return (
    <div
      role="tablist"
      style={{ display: "flex", borderBottom: `1px solid ${C.rule}`, margin: "16px 0 26px", alignItems: "flex-end" }}
    >
      {TABS.map((t) => {
        const on = active === t.key;
        const count = counts?.[t.key];
        return (
          <Link key={t.key} href={`${basePath}?tab=${t.key}`} role="tab" aria-selected={on} style={tabStyle(on)}>
            {t.label}
            {count != null && (
              <span
                style={{
                  fontFamily: F.mono,
                  fontSize: 10.5,
                  color: on ? C.accent : C.faint,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {count}
              </span>
            )}
          </Link>
        );
      })}
      <span
        style={{
          marginLeft: "auto",
          alignSelf: "center",
          fontFamily: F.mono,
          fontSize: 10,
          color: C.faint,
          letterSpacing: "0.06em",
        }}
      >
        Filed {preparedAt}
      </span>
    </div>
  );
}

export function AssessmentChrome({
  activeTab,
  reportId,
  displayNumber,
  companyName,
  preparedAt,
  counts,
  basePath,
  children,
}: {
  activeTab: TabKey;
  reportId: string;
  displayNumber: string;
  companyName: string;
  // Human-readable "DD Month YYYY" prepared date for the tab-bar filing note.
  preparedAt: string;
  counts?: Partial<Record<TabKey, number>>;
  // Tab-link base. `/dashboard` keeps the signed-in sidebar layout; the
  // standalone /assessment/[id] page passes `/assessment/{uuid}`.
  basePath: string;
  children: React.ReactNode;
}) {
  const mobile = useMedia("(max-width: 860px)");
  return (
    <main
      style={{
        maxWidth: 1200,
        margin: "0 auto",
        padding: mobile ? "26px 18px 64px" : "34px 56px 80px",
        color: C.ink,
        background: C.paper,
        minHeight: "100vh",
        boxSizing: "border-box",
      }}
    >
      <ReportHeader companyName={companyName} displayNumber={displayNumber} reportId={reportId} mobile={mobile} />
      <TabBar active={activeTab} basePath={basePath} counts={counts} preparedAt={preparedAt} mobile={mobile} />
      <div className="tp2-tab-panel">{children}</div>
    </main>
  );
}

export type { TabKey };
