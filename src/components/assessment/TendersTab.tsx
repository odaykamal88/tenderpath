import styles from "./AssessmentTabs.module.css";
import { TenderOpenLink } from "@/components/telemetry/TenderOpenLink";

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
  matchReasons?: string[];
  caveats?: string[];
  decisionHeadline?: string | null;
};

function confidenceDot(confidence: Tender["confidence"]): string {
  if (confidence === "high") return "var(--tp2-pos, #1f7a4d)";
  if (confidence === "medium") return "var(--tp2-warn, #c08400)";
  if (confidence === "low") return "var(--tp2-neg, #b03030)";
  return "var(--tp2-line, #c8c0b3)";
}

function confidenceLabel(confidence: Tender["confidence"]): string {
  if (confidence === "high") return "high confidence";
  if (confidence === "medium") return "medium confidence";
  if (confidence === "low") return "low confidence";
  return "confidence unknown";
}

export function TendersTab({
  tenders,
  filter = "all",
  countsByFilter,
}: {
  tenders: Tender[];
  filter?: "all" | "strong" | "closing";
  countsByFilter: { all: number; strong: number; closing: number };
}) {
  return (
    <>
      <div className={styles.tableHead}>
        <div>
          <div className={styles.eyebrow}>
            {countsByFilter.all} matches · {countsByFilter.strong} strong fit
          </div>
          <h2 className={styles.sectionTitleSmall}>
            Open opportunities matched to your profile
          </h2>
        </div>
        <div className={styles.filterBar}>
          {[
            { key: "all", label: `All ${countsByFilter.all}` },
            { key: "strong", label: `Strong ${countsByFilter.strong}` },
            { key: "closing", label: "Closing soon" },
          ].map((f) => (
            <button
              key={f.key}
              data-active={filter === f.key ? "true" : undefined}
              className={`${styles.filterChip} tp-mono`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className={`${styles.gridHead} ${styles.tendersGrid}`}>
        <span>Reference</span>
        <span>Title · why this matches</span>
        <span>Agency</span>
        <span style={{ textAlign: "right" }}>Fit</span>
        <span style={{ textAlign: "right" }}>Closes</span>
        <span style={{ textAlign: "right" }}>Action</span>
      </div>
      {tenders.map((t) => {
        const reasons = (t.matchReasons ?? []).filter(Boolean).slice(0, 3);
        const sectorChip = t.sector || null;
        const countryChip = t.country || null;
        const aggregatorWarn = t.sourceProvenance === "aggregator";
        const headline = t.decisionHeadline?.trim() || null;
        const caveats = (t.caveats ?? []).filter(Boolean);
        const hasDetail = reasons.length > 0 || headline || caveats.length > 0 || aggregatorWarn;

        return (
          <div key={t.code} className={`${styles.gridRow} ${styles.tendersGrid}`}>
            <span className={`${styles.refCell} tp-mono`}>
              <span
                title={confidenceLabel(t.confidence)}
                aria-label={confidenceLabel(t.confidence)}
                style={{
                  display: "inline-block",
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: confidenceDot(t.confidence),
                  marginRight: 6,
                  verticalAlign: "middle",
                }}
              />
              {t.code}
            </span>
            <span>
              <div>{t.title}</div>
              <div
                className={`${styles.cellMeta} tp-mono`}
                style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}
              >
                {sectorChip && <span>{sectorChip}</span>}
                {countryChip && <span>· {countryChip}</span>}
                {t.value && t.value !== "—" && <span>· {t.value}</span>}
                {t.bucketLabel && <span>· {t.bucketLabel}</span>}
              </div>
              {hasDetail && (
                <details
                  style={{
                    marginTop: 6,
                    fontFamily: "var(--tp2-serif, ui-serif), serif",
                    fontSize: 13,
                    color: "var(--tp2-ink-2, #4a443a)",
                  }}
                >
                  <summary
                    className="tp-mono"
                    style={{
                      cursor: "pointer",
                      fontSize: 10,
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      color: "var(--tp2-ink-3, #8a826f)",
                      listStyle: "none",
                    }}
                  >
                    {reasons[0] ?? headline ?? "Why this matched"}
                  </summary>
                  <div style={{ marginTop: 6, lineHeight: 1.5 }}>
                    {headline && (
                      <p style={{ fontWeight: 500, margin: "0 0 6px" }}>{headline}</p>
                    )}
                    {reasons.length > 0 && (
                      <ul style={{ paddingLeft: 16, margin: "0 0 6px" }}>
                        {reasons.map((r, i) => (
                          <li key={i}>{r}</li>
                        ))}
                      </ul>
                    )}
                    {aggregatorWarn && (
                      <p
                        style={{
                          margin: "0 0 4px",
                          color: "var(--tp2-warn, #8a6a00)",
                          fontSize: 12,
                        }}
                      >
                        Aggregator copy — verify with the primary source before bidding.
                      </p>
                    )}
                    {caveats.length > 0 && (
                      <ul
                        style={{
                          paddingLeft: 16,
                          margin: "4px 0 0",
                          color: "var(--tp2-ink-3, #8a826f)",
                          fontStyle: "italic",
                          fontSize: 12,
                        }}
                      >
                        {caveats.slice(0, 3).map((c, i) => (
                          <li key={i}>{c}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </details>
              )}
            </span>
            <span className={styles.cellSecondary}>{t.agency}</span>
            <span
              className={`${styles.fitCell} tp-mono tp-tabular`}
              data-strength={
                t.fit >= 75 ? "strong" : t.fit >= 65 ? "ok" : "weak"
              }
            >
              {t.fit}
            </span>
            <span
              className={`${styles.dlCell} tp-mono`}
              data-urgent={t.urgent ? "true" : undefined}
            >
              {t.deadline}
            </span>
            {t.sourceUrl ? (
              <TenderOpenLink
                href={t.sourceUrl}
                className={styles.rowCta}
                code={t.code}
                sourceProvenance={t.sourceProvenance}
                confidence={t.confidence}
                fit={t.fit}
              >
                Open ↗
              </TenderOpenLink>
            ) : (
              <span
                className={styles.rowCta}
                style={{ opacity: 0.4, cursor: "not-allowed" }}
                title="Source link unavailable for this match"
              >
                Open →
              </span>
            )}
          </div>
        );
      })}
    </>
  );
}
