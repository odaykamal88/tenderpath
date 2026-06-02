import styles from "./AssessmentTabs.module.css";
import { TenderOpenLink } from "@/components/telemetry/TenderOpenLink";

// PR-N (2026-05-23): YY/MM/DD deadline format. Sorts cleanly + unambiguous
// across locales (vs US MM/DD/YY or EU DD/MM/YY). Falls back to "TBA" /
// raw string when the source deadline is missing or unparseable so a
// crawler oddity doesn't render as "NaN/NaN/NaN".
function formatYYMMDD(deadline: string): string {
  if (!deadline || deadline === "TBA") return "TBA";
  const d = new Date(deadline);
  if (Number.isNaN(d.getTime())) return deadline;
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yy}/${mm}/${dd}`;
}

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
  // Supplier-portal registration the bidder must complete before submitting.
  // Resolved server-side in mapTendersForUI (keyed off `agency`) so the
  // deadline-risk flag is computed once at request time — no Date.now() in
  // render, no SSR/hydration drift. Null when the agency has no verified
  // portal mapping (we don't surface guesses in the dense feed).
  registration?: {
    portalName: string;
    url: string;
    leadLabel: string;
    risk: "none" | "tight" | "very-tight";
  } | null;
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

function describeCountries(countries: string[]): string {
  const cleaned = countries.filter(Boolean);
  if (cleaned.length === 0) return "your selected countries";
  if (cleaned.length === 1) return cleaned[0];
  if (cleaned.length === 2) return `${cleaned[0]} or ${cleaned[1]}`;
  return `${cleaned.slice(0, -1).join(", ")}, or ${cleaned[cleaned.length - 1]}`;
}

// Audit 2026-05-19 P1 #6: when the post-filter result list is empty or very
// thin, render an honest empty-state instead of silently showing zero rows
// (which previously would have been "filled" with off-country regional
// matches like Egypt/Iraq for a Jordan user — the exact bug the audit caught).
const THIN_RESULT_THRESHOLD = 3;

export function TendersTab({
  tenders,
  filter = "all",
  countsByFilter,
  selectedCountries = [],
}: {
  tenders: Tender[];
  filter?: "all" | "strong" | "closing";
  countsByFilter: { all: number; strong: number; closing: number };
  selectedCountries?: string[];
}) {
  const isThin = tenders.length <= THIN_RESULT_THRESHOLD;
  const geoCopy = describeCountries(selectedCountries);

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

      {isThin && (
        <div
          className="tp-mono"
          style={{
            margin: "12px 0",
            padding: "14px 16px",
            borderLeft: "2px solid var(--tp2-warn, #b08530)",
            background: "rgba(176, 133, 48, 0.06)",
            fontSize: 12,
            lineHeight: 1.55,
            color: "var(--tp2-ink-2, #4a443a)",
          }}
        >
          <div
            style={{
              fontSize: 10,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "var(--tp2-warn, #b08530)",
              marginBottom: 6,
              fontWeight: 600,
            }}
          >
            Thin country supply
          </div>
          {tenders.length === 0
            ? `No live tenders matching ${geoCopy} this week.`
            : `Only ${tenders.length} live tender${tenders.length === 1 ? "" : "s"} in ${geoCopy} this week.`}{" "}
          We hard-filter by country so you don&rsquo;t see off-country noise — try broadening your geography by running a new assessment with more countries.
        </div>
      )}

      <div className={`${styles.gridHead} ${styles.tendersGrid}`}>
        <span>Reference</span>
        <span>Title · why this matches</span>
        <span>Agency</span>
        <span style={{ textAlign: "right" }}>Fit</span>
        <span style={{ textAlign: "right" }}>Closes</span>
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
            <span
              className={`${styles.refCell} tp-mono`}
              title={`${t.code} — ${confidenceLabel(t.confidence)}`}
            >
              <span
                aria-label={confidenceLabel(t.confidence)}
                style={{
                  display: "inline-block",
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: confidenceDot(t.confidence),
                  marginRight: 6,
                  verticalAlign: "middle",
                  flexShrink: 0,
                }}
              />
              {t.code}
            </span>
            <span>
              <div>
                {t.sourceUrl ? (
                  <TenderOpenLink
                    href={t.sourceUrl}
                    className={styles.titleLink}
                    code={t.code}
                    sourceProvenance={t.sourceProvenance}
                    confidence={t.confidence}
                    fit={t.fit}
                  >
                    {t.title}
                  </TenderOpenLink>
                ) : (
                  t.title
                )}
              </div>
              <div
                className={`${styles.cellMeta} tp-mono`}
                style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}
              >
                {sectorChip && <span>{sectorChip}</span>}
                {countryChip && <span>· {countryChip}</span>}
                {t.value && t.value !== "—" && <span>· {t.value}</span>}
                {t.bucketLabel && <span>· {t.bucketLabel}</span>}
              </div>
              {t.registration && (
                <div
                  className="tp-mono"
                  style={{
                    display: "flex",
                    gap: 6,
                    flexWrap: "wrap",
                    alignItems: "baseline",
                    marginTop: 5,
                    fontSize: 11,
                    lineHeight: 1.45,
                  }}
                >
                  <span
                    style={{
                      fontSize: 9,
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                      fontWeight: 600,
                      color: "var(--tp2-ink-3, #8a826f)",
                    }}
                  >
                    Register first
                  </span>
                  <a
                    href={t.registration.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      color: "var(--tp2-ink-2, #4a443a)",
                      textDecoration: "underline",
                      textUnderlineOffset: 2,
                    }}
                  >
                    {t.registration.portalName}
                  </a>
                  <span style={{ color: "var(--tp2-ink-3, #8a826f)" }}>
                    · {t.registration.leadLabel}
                  </span>
                  {t.registration.risk !== "none" && (
                    <span
                      style={{
                        fontWeight: 600,
                        color:
                          t.registration.risk === "very-tight"
                            ? "var(--tp2-neg, #b03030)"
                            : "var(--tp2-warn, #b08530)",
                      }}
                    >
                      ⚑{" "}
                      {t.registration.risk === "very-tight"
                        ? "may not finish before the deadline"
                        : "register now — little time left"}
                    </span>
                  )}
                </div>
              )}
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
              {/* PR-N (2026-05-23): YY/MM/DD format per user spec — sorts
                  lexicographically and is unambiguous across locales. */}
              {formatYYMMDD(t.deadline)}
            </span>
          </div>
        );
      })}
    </>
  );
}
