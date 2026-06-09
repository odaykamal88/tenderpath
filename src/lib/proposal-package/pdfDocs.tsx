import React from "react";
import { Document, Page, Text, View, StyleSheet, pdf } from "@react-pdf/renderer";
import type { ProposalOutput, RosterOutput, ComplianceItem } from "./types";
import type { AgencyPackage } from "./roster-packages";
import type {
  TenderRubric,
  ScoreResult,
  CriterionAssessment,
  DraftSection,
  Confidence,
  RoutedGap,
} from "./scoring-engine";
import { getLeafCriteria } from "./gap-routing";
import type { ApplicantContext } from "./applicant-context";
import type { RevisionAttemptSummary } from "./revision-loop";

const GOLD = "#b08530";
const INK = "#1a1a1a";
const INK2 = "#4a4a4a";
const INK3 = "#6b6b6b";
const RULE = "#d8d0bd";
const RED = "#b8463f";
const GREEN = "#1f6a3c";

const styles = StyleSheet.create({
  page: { backgroundColor: "#f5f1e8", padding: 48, fontFamily: "Helvetica", color: INK },
  mono: { fontFamily: "Courier" },
  label: { fontSize: 7, letterSpacing: 1.2, textTransform: "uppercase", color: INK3 },
  ruleInk: { borderBottomWidth: 1, borderBottomColor: INK, marginBottom: 12 },
  section: { marginBottom: 24 },
  h2: { fontSize: 15, fontFamily: "Helvetica-Bold", marginBottom: 8, color: INK },
  bullet: { fontSize: 10, lineHeight: 1.5, color: INK, marginBottom: 4 },
});

interface DocContext {
  companyName: string;
  tenderTitle: string | null;
  agency: string | null;
  generatedAt: string;
}

function masthead(ctx: DocContext, kind: string, refTag: string) {
  return (
    <View style={{ marginBottom: 20 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
        <Text style={[styles.mono, { fontSize: 7, letterSpacing: 1.5, color: GOLD, textTransform: "uppercase" }]}>
          {kind} · {refTag}
        </Text>
        <Text style={[styles.mono, { fontSize: 7, color: INK3 }]}>TenderPath.me</Text>
      </View>
      <Text style={{ fontSize: 22, fontFamily: "Helvetica-Bold", letterSpacing: -0.4, color: INK, marginBottom: 2 }}>
        {ctx.tenderTitle ?? "Untitled opportunity"}
      </Text>
      <Text style={[styles.mono, { fontSize: 8, color: INK3, letterSpacing: 0.5 }]}>
        {ctx.agency ? `${ctx.agency} · ` : ""}For {ctx.companyName}
      </Text>
    </View>
  );
}

/**
 * Sprint 14. One agency_readiness_breakdown entry rendered as a
 * compact block: heading row (label + score + tag + sub-scores),
 * rationale paragraph, missing-docs bullets, next-action bullets.
 */
function AgencyBlockPdf({
  agency,
  tag,
}: {
  agency: NonNullable<RosterOutput["agency_readiness_breakdown"]>[number];
  tag: string;
}) {
  const accent = tag === "START HERE" ? GREEN : tag === "VIABLE" ? GOLD : INK3;
  return (
    <View style={{ marginBottom: 14, borderLeftWidth: 2, borderLeftColor: accent, paddingLeft: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", marginBottom: 4, flexWrap: "wrap" }}>
        <Text style={{ fontSize: 13, fontFamily: "Helvetica-Bold", color: INK }}>{agency.agency_label}</Text>
        <Text style={{ fontSize: 13, fontFamily: "Helvetica-Bold", color: accent, marginLeft: 8 }}>
          {agency.readiness_0_10}/10
        </Text>
        <Text style={[styles.mono, { fontSize: 8, color: accent, marginLeft: 8, letterSpacing: 1 }]}>[{tag}]</Text>
        <Text style={[styles.mono, { fontSize: 8, color: INK3, marginLeft: 10 }]}>
          docs {agency.document_coverage_0_10}/10 · category {agency.category_fit_0_10}/10 · geo {agency.geographic_fit_0_10}/10
        </Text>
      </View>
      {agency.rationale && (
        <Text style={{ fontSize: 9.5, color: INK, lineHeight: 1.4, marginBottom: 6 }}>{agency.rationale}</Text>
      )}
      {agency.missing_documents.length > 0 && (
        <View style={{ marginTop: 2 }}>
          <Text style={[styles.label, { marginBottom: 2 }]}>Missing</Text>
          {agency.missing_documents.map((d, i) => (
            <Text key={i} style={[styles.bullet, { fontSize: 9, color: INK2, marginBottom: 2 }]}>· {d}</Text>
          ))}
        </View>
      )}
      {tag !== "BLOCKED" && agency.next_actions.length > 0 && (
        <View style={{ marginTop: 4 }}>
          <Text style={[styles.label, { marginBottom: 2 }]}>Next actions</Text>
          {agency.next_actions.map((a, i) => (
            <Text key={i} style={[styles.bullet, { fontSize: 9, color: INK, marginBottom: 2 }]}>→ {a}</Text>
          ))}
        </View>
      )}
    </View>
  );
}

function refTag(prefix: string, id: number): string {
  return `${prefix}-${id.toString(16).toUpperCase().padStart(4, "0")}`;
}

function statusColor(s: ComplianceItem["status"]): string {
  if (s === "compliant") return GREEN;
  if (s === "partial") return GOLD;
  return RED;
}

function statusLabel(s: ComplianceItem["status"]): string {
  if (s === "compliant") return "Compliant";
  if (s === "partial") return "Partial";
  return "Needs action";
}

/**
 * Compliance matrix — companion to the technical proposal .docx.
 * Maps each tender requirement to a status + evidence/action.
 */
export async function renderComplianceMatrixPdf(
  output: ProposalOutput,
  ctx: DocContext,
  workOrderId: number,
): Promise<Buffer> {
  const tag = refTag("PROP", workOrderId);
  const Doc = (
    <Document title={`Compliance matrix · ${ctx.tenderTitle ?? ctx.companyName}`} author="TenderPath">
      <Page size="A4" style={styles.page}>
        {masthead(ctx, "Compliance matrix", tag)}
        <View style={styles.ruleInk} />

        {output.source_quality && (
          <View style={[styles.section, { borderLeftWidth: 2, borderLeftColor: output.source_quality.status === "ready" ? GREEN : GOLD, paddingLeft: 12 }]}>
            <Text style={[styles.label, { color: output.source_quality.status === "ready" ? GREEN : GOLD, marginBottom: 6 }]}>
              Source quality · {output.source_quality.status} · {output.source_quality.score_0_10}/10
            </Text>
            {output.source_quality.missing_inputs.slice(0, 5).map((m, i) => (
              <Text key={i} style={[styles.bullet, { color: INK2 }]}>· Missing: {m}</Text>
            ))}
            {output.source_quality.warnings.slice(0, 3).map((w, i) => (
              <Text key={`w-${i}`} style={[styles.bullet, { color: INK2 }]}>· {w}</Text>
            ))}
          </View>
        )}

        {output.compliance_checklist.length === 0 ? (
          <View>
            <Text style={[styles.label, { marginBottom: 6 }]}>No compliance items returned</Text>
            <Text style={{ fontSize: 11, color: INK2 }}>
              The LLM did not produce a compliance checklist. Open the technical proposal&apos;s &ldquo;Required documents&rdquo;
              section and build the matrix manually before submission.
            </Text>
          </View>
        ) : (
          <View>
            <View style={{ flexDirection: "row", paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: INK }}>
              <Text style={[styles.label, { width: 240 }]}>Requirement</Text>
              <Text style={[styles.label, { width: 80 }]}>Status</Text>
              <Text style={[styles.label, { flex: 1 }]}>Evidence or action</Text>
            </View>
            {output.compliance_checklist.map((c, i) => (
              <View
                key={i}
                style={{
                  flexDirection: "row",
                  paddingVertical: 8,
                  borderBottomWidth: 1,
                  borderBottomColor: RULE,
                }}
              >
                <Text style={{ fontSize: 10, color: INK, width: 240, paddingRight: 8, lineHeight: 1.4 }}>
                  {c.requirement}
                </Text>
                <Text style={{ fontSize: 9, color: statusColor(c.status), width: 80, fontFamily: "Helvetica-Bold" }}>
                  {statusLabel(c.status)}
                </Text>
                <Text style={{ fontSize: 9.5, color: INK2, flex: 1, lineHeight: 1.4 }}>
                  {c.evidence_or_action}
                </Text>
              </View>
            ))}
          </View>
        )}

        {output.missing_information.length > 0 && (
          <View style={[styles.section, { marginTop: 28, borderLeftWidth: 2, borderLeftColor: RED, paddingLeft: 12 }]}>
            <Text style={[styles.label, { color: RED, marginBottom: 6 }]}>Information still needed before submission</Text>
            {output.missing_information.map((m, i) => (
              <Text key={i} style={[styles.bullet, { color: RED }]}>· {m}</Text>
            ))}
          </View>
        )}

        <View style={{ position: "absolute", bottom: 28, left: 48, right: 48, flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={[styles.mono, { fontSize: 7, color: INK3 }]}>Generated {ctx.generatedAt}</Text>
          <Text style={[styles.mono, { fontSize: 7, color: INK3 }]}>tenderpath.me · {tag}</Text>
        </View>
      </Page>
    </Document>
  );
  const blob = await pdf(Doc).toBlob();
  return Buffer.from(await blob.arrayBuffer());
}

/**
 * Sprint 2: render a SCORED draft (DraftSection[] + ScoreResult) as a PDF.
 *
 * Produces a 1-3 page document:
 *   - Page 1: scorecard summary (per-lot estimated vs achievable totals,
 *     gating state, triggered disqualifiers, revision history)
 *   - Page 2: per-criterion scoring detail (one row per scored criterion)
 *   - Page 3: weak-section detail (criteria with weaknesses + missing evidence)
 *
 * Follows the same masthead + footer + colour-token conventions as the
 * existing ProposalOutput / RosterOutput renderers, per the AGENTS.md
 * Golden Rule (rendering exits only through pdfDocs.tsx).
 */
function confidenceColor(c: Confidence): string {
  if (c === "evidenced") return GREEN;
  if (c === "inferred") return GOLD;
  if (c === "gap") return RED;
  return INK3; // unverified
}

function ScoreBar({
  score,
  max,
  width = 120,
}: {
  score: number;
  max: number;
  width?: number;
}) {
  const fillRatio = max > 0 ? Math.max(0, Math.min(1, score / max)) : 0;
  const fill = Math.round(width * fillRatio);
  const colour = fillRatio >= 0.7 ? GREEN : fillRatio >= 0.4 ? GOLD : RED;
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      <View
        style={{
          width,
          height: 6,
          backgroundColor: "#e6dfca",
          borderRadius: 2,
          marginRight: 8,
        }}
      >
        <View style={{ width: fill, height: 6, backgroundColor: colour, borderRadius: 2 }} />
      </View>
      <Text style={[styles.mono, { fontSize: 8, color: INK }]}>
        {score.toFixed(1)} / {max}
      </Text>
    </View>
  );
}

export async function renderScoredDraftPdf(
  args: {
    rubric: TenderRubric;
    draft: DraftSection[];
    score: ScoreResult;
    applicant: ApplicantContext;
    history: RevisionAttemptSummary[];
    workOrderId: number;
    tenderTitle: string | null;
    agency: string | null;
    generatedAt: string;
  },
): Promise<Buffer> {
  const ctx: DocContext = {
    companyName: args.applicant.companyName,
    tenderTitle: args.tenderTitle,
    agency: args.agency,
    generatedAt: args.generatedAt,
  };
  const tag = refTag("DRAFT", args.workOrderId);

  // Aggregate totals across lots — leaf-only (Sprint 4.5: parent rubric
  // entries like "1 — Profile of institution (max 50)" are structural
  // rollups of their children (1.1, 1.2…); summing both double-counts).
  const achievableTotal = args.rubric.lots.reduce(
    (s, lot) => s + getLeafCriteria(lot.criteria).reduce((ss, c) => ss + c.maxScore, 0),
    0,
  );
  const estimatedTotal = args.score.lotResults.reduce((s, lr) => s + lr.estimatedTotal, 0);
  const allPassGating = args.score.lotResults.every((lr) => lr.passesGating);
  const noticeWideTriggered = args.score.noticeWideDisqualifiersTriggered;

  const weakCriteriaForRender: Array<{
    lotId: string;
    assessment: CriterionAssessment;
    criterionLabel: string;
  }> = [];
  for (const lot of args.rubric.lots) {
    const lr = args.score.lotResults.find((x) => x.lotId === lot.lotId);
    if (!lr) continue;
    for (const c of lot.criteria) {
      const a = lr.perCriterion.find((x) => x.criterionId === c.id);
      if (!a) continue;
      const isWeak =
        a.confidence === "gap" ||
        a.estimatedScore < a.maxScore * 0.5 ||
        a.weaknesses.length > 0 ||
        a.missingEvidence.length > 0;
      if (isWeak) {
        weakCriteriaForRender.push({ lotId: lot.lotId, assessment: a, criterionLabel: c.label });
      }
    }
  }

  const Doc = (
    <Document title={`Scored draft · ${ctx.tenderTitle ?? ctx.companyName}`} author="TenderPath">
      {/* PAGE 1: SCORECARD */}
      <Page size="A4" style={styles.page}>
        {masthead(ctx, "Scored draft", tag)}
        <View style={styles.ruleInk} />

        {/* Headline totals */}
        <View style={[styles.section, { borderLeftWidth: 2, borderLeftColor: allPassGating ? GREEN : RED, paddingLeft: 12 }]}>
          <Text style={[styles.label, { color: allPassGating ? GREEN : RED, marginBottom: 4 }]}>
            {allPassGating ? "Passes gating" : "Fails gating"}
            {noticeWideTriggered.length > 0
              ? ` · ${noticeWideTriggered.length} notice-wide disqualifier${noticeWideTriggered.length === 1 ? "" : "s"} triggered`
              : ""}
          </Text>
          {achievableTotal > 0 && (
            <View style={{ flexDirection: "row", alignItems: "center", marginTop: 4 }}>
              <Text style={{ fontSize: 22, fontFamily: "Helvetica-Bold", color: INK }}>
                {estimatedTotal.toFixed(0)}
              </Text>
              <Text style={{ fontSize: 14, color: INK3, marginLeft: 4, marginRight: 14 }}>
                / {achievableTotal}
              </Text>
              <ScoreBar score={estimatedTotal} max={achievableTotal} width={180} />
            </View>
          )}
          {achievableTotal === 0 && (
            <Text style={{ fontSize: 10, color: INK2, marginTop: 6 }}>
              No scored criteria (lowest-priced technically-compliant methodology). Result is pass/fail on disqualifiers only.
            </Text>
          )}
        </View>

        {/* Notice-wide disqualifiers triggered */}
        {noticeWideTriggered.length > 0 && (
          <View style={[styles.section, { borderLeftWidth: 2, borderLeftColor: RED, paddingLeft: 12 }]}>
            <Text style={[styles.label, { color: RED, marginBottom: 6 }]}>
              Notice-wide disqualifiers triggered (fail every lot quoted)
            </Text>
            {noticeWideTriggered.slice(0, 8).map((d, i) => (
              <Text key={i} style={[styles.bullet, { color: INK, marginBottom: 4 }]}>
                · [{d.kind}] {d.rule.slice(0, 220)}
              </Text>
            ))}
          </View>
        )}

        {/* Per-lot summary */}
        <View style={styles.section}>
          <Text style={styles.h2}>Per-lot summary</Text>
          {args.score.lotResults.map((lr) => {
            const lot = args.rubric.lots.find((l) => l.lotId === lr.lotId);
            const lotMax = lot ? getLeafCriteria(lot.criteria).reduce((s, c) => s + c.maxScore, 0) : 0;
            return (
              <View
                key={lr.lotId}
                style={{
                  paddingVertical: 8,
                  borderBottomWidth: 1,
                  borderBottomColor: RULE,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 4 }}>
                  <Text style={{ fontSize: 12, fontFamily: "Helvetica-Bold", color: INK, flex: 1 }}>
                    {lot?.label ?? lr.lotId}
                  </Text>
                  <Text
                    style={[
                      styles.mono,
                      { fontSize: 9, color: lr.passesGating ? GREEN : RED, marginRight: 12 },
                    ]}
                  >
                    {lr.passesGating ? "PASS" : "FAIL"}
                  </Text>
                  {lotMax > 0 && <ScoreBar score={lr.estimatedTotal} max={lotMax} />}
                </View>
                {lr.lotDisqualifiersTriggered.length > 0 && (
                  <Text style={{ fontSize: 9, color: RED, marginTop: 2 }}>
                    Disqualifiers triggered: {lr.lotDisqualifiersTriggered.length} (e.g. {lr.lotDisqualifiersTriggered[0]?.rule.slice(0, 80)}…)
                  </Text>
                )}
              </View>
            );
          })}
        </View>

        {/* Revision history */}
        {args.history.length > 1 && (
          <View style={[styles.section, { marginTop: 14 }]}>
            <Text style={styles.h2}>Revision history</Text>
            {args.history.map((h) => (
              <View key={h.attempt} style={{ flexDirection: "row", marginBottom: 3 }}>
                <Text style={[styles.mono, { fontSize: 9, color: INK3, width: 70 }]}>
                  Attempt {h.attempt}
                </Text>
                <Text style={{ fontSize: 9, color: INK2 }}>
                  {h.estimatedTotal.toFixed(0)} / {h.achievableTotal} · {h.passesGating ? "passes gating" : "fails gating"} · {h.weakCriteriaIds.length} weak · {h.triggeredDisqualifierIds.length} triggered
                </Text>
              </View>
            ))}
          </View>
        )}

        <View style={{ position: "absolute", bottom: 28, left: 48, right: 48, flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={[styles.mono, { fontSize: 7, color: INK3 }]}>Generated {ctx.generatedAt}</Text>
          <Text style={[styles.mono, { fontSize: 7, color: INK3 }]}>tenderpath.me · {tag}</Text>
        </View>
      </Page>

      {/* PAGE 2: PER-CRITERION DETAIL (cumulative-style; skipped if no scored criteria) */}
      {achievableTotal > 0 && (
        <Page size="A4" style={styles.page}>
          <View style={{ marginBottom: 14 }}>
            <Text style={[styles.mono, { fontSize: 7, letterSpacing: 1.5, color: GOLD, textTransform: "uppercase", marginBottom: 4 }]}>
              Scored draft · per-criterion · {tag}
            </Text>
            <Text style={{ fontSize: 18, fontFamily: "Helvetica-Bold", color: INK }}>
              Per-criterion scoring
            </Text>
          </View>
          <View style={styles.ruleInk} />

          {args.rubric.lots.map((lot) => {
            const lr = args.score.lotResults.find((x) => x.lotId === lot.lotId);
            if (!lr || lot.criteria.length === 0) return null;
            return (
              <View key={lot.lotId} style={{ marginBottom: 14 }}>
                <Text style={[styles.label, { marginBottom: 6 }]}>{lot.label}</Text>
                {lot.criteria.map((c) => {
                  const a = lr.perCriterion.find((x) => x.criterionId === c.id);
                  if (!a) return null;
                  return (
                    <View
                      key={c.id}
                      style={{
                        flexDirection: "row",
                        paddingVertical: 5,
                        borderBottomWidth: 1,
                        borderBottomColor: RULE,
                      }}
                    >
                      <Text style={[styles.mono, { fontSize: 9, color: INK3, width: 36 }]}>{c.id}</Text>
                      <Text style={{ fontSize: 9.5, color: INK, flex: 1, paddingRight: 8 }}>
                        {c.label.slice(0, 80)}
                        {c.doubleWeighted ? "  [2x]" : ""}
                      </Text>
                      <View style={{ width: 150, marginRight: 8 }}>
                        <ScoreBar score={a.estimatedScore} max={a.maxScore} width={100} />
                      </View>
                      <Text
                        style={[
                          styles.mono,
                          { fontSize: 8, color: confidenceColor(a.confidence), width: 60, textAlign: "right" },
                        ]}
                      >
                        {a.confidence}
                      </Text>
                    </View>
                  );
                })}
              </View>
            );
          })}

          <View style={{ position: "absolute", bottom: 28, left: 48, right: 48, flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={[styles.mono, { fontSize: 7, color: INK3 }]}>Generated {ctx.generatedAt}</Text>
            <Text style={[styles.mono, { fontSize: 7, color: INK3 }]}>tenderpath.me · {tag}</Text>
          </View>
        </Page>
      )}

      {/* PAGE 3: WEAK CRITERIA DETAIL */}
      {weakCriteriaForRender.length > 0 && (
        <Page size="A4" style={styles.page}>
          <View style={{ marginBottom: 14 }}>
            <Text style={[styles.mono, { fontSize: 7, letterSpacing: 1.5, color: GOLD, textTransform: "uppercase", marginBottom: 4 }]}>
              Scored draft · weak sections · {tag}
            </Text>
            <Text style={{ fontSize: 18, fontFamily: "Helvetica-Bold", color: INK }}>
              Where the draft needs more
            </Text>
          </View>
          <View style={styles.ruleInk} />

          {weakCriteriaForRender.slice(0, 12).map((w, i) => (
            <View
              key={i}
              style={{
                marginBottom: 12,
                borderLeftWidth: 2,
                borderLeftColor: confidenceColor(w.assessment.confidence),
                paddingLeft: 10,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "baseline", marginBottom: 4 }}>
                <Text style={[styles.mono, { fontSize: 9, color: INK3, marginRight: 6 }]}>
                  {w.lotId} / {w.assessment.criterionId}
                </Text>
                <Text style={{ fontSize: 11, fontFamily: "Helvetica-Bold", color: INK, flex: 1 }}>
                  {w.criterionLabel.slice(0, 100)}
                </Text>
                <Text style={[styles.mono, { fontSize: 9, color: INK2 }]}>
                  {w.assessment.estimatedScore.toFixed(1)} / {w.assessment.maxScore}
                </Text>
              </View>
              {w.assessment.weaknesses.length > 0 && (
                <View style={{ marginTop: 2 }}>
                  <Text style={[styles.label, { marginBottom: 2 }]}>Weaknesses</Text>
                  {w.assessment.weaknesses.slice(0, 4).map((ws, j) => (
                    <Text key={j} style={[styles.bullet, { color: INK2, fontSize: 9 }]}>· {ws}</Text>
                  ))}
                </View>
              )}
              {w.assessment.missingEvidence.length > 0 && (
                <View style={{ marginTop: 4 }}>
                  <Text style={[styles.label, { marginBottom: 2, color: RED }]}>Missing evidence</Text>
                  {w.assessment.missingEvidence.slice(0, 4).map((m, j) => (
                    <Text key={j} style={[styles.bullet, { color: RED, fontSize: 9 }]}>· {m}</Text>
                  ))}
                </View>
              )}
            </View>
          ))}

          <View style={{ position: "absolute", bottom: 28, left: 48, right: 48, flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={[styles.mono, { fontSize: 7, color: INK3 }]}>Generated {ctx.generatedAt}</Text>
            <Text style={[styles.mono, { fontSize: 7, color: INK3 }]}>tenderpath.me · {tag}</Text>
          </View>
        </Page>
      )}

      {/* PAGE 4: ROUTED GAPS & NEXT ACTIONS (Sprint 4 — proposal-output-ux.md A3) */}
      {args.score.routedGaps.length > 0 && (
        <Page size="A4" style={styles.page}>
          <View style={{ marginBottom: 14 }}>
            <Text style={[styles.mono, { fontSize: 7, letterSpacing: 1.5, color: GOLD, textTransform: "uppercase", marginBottom: 4 }]}>
              Scored draft · routed actions · {tag}
            </Text>
            <Text style={{ fontSize: 18, fontFamily: "Helvetica-Bold", color: INK }}>
              Next actions, by gap
            </Text>
            <Text style={{ fontSize: 9, color: INK2, marginTop: 4, lineHeight: 1.4 }}>
              Every gap surfaced above is routed to the TenderPath service that closes it. This is the moat: a generic LLM doesn&apos;t tell you which {"$"}39 / {"$"}49 / {"$"}749 step closes the gap it just listed.
            </Text>
          </View>
          <View style={styles.ruleInk} />

          {/* Group by routedTo for scannability */}
          {(() => {
            const grouped = new Map<string, RoutedGap[]>();
            for (const g of args.score.routedGaps) {
              if (!grouped.has(g.routedTo)) grouped.set(g.routedTo, []);
              grouped.get(g.routedTo)!.push(g);
            }
            // Stable ordering of SKUs in the PDF: most-urgent first
            const order = ["bid_no_bid", "matching", "roster", "proposal_draft"];
            const ordered = Array.from(grouped.entries()).sort(
              (a, b) => order.indexOf(a[0]) - order.indexOf(b[0]),
            );
            return ordered.map(([, gaps], i) => (
              <View key={i} style={{ marginBottom: 14, borderLeftWidth: 2, borderLeftColor: GOLD, paddingLeft: 10 }}>
                <View style={{ flexDirection: "row", alignItems: "baseline", marginBottom: 4 }}>
                  <Text style={{ fontSize: 11, fontFamily: "Helvetica-Bold", color: INK, flex: 1 }}>
                    {gaps[0].ctaCopy}
                  </Text>
                  <Text style={[styles.mono, { fontSize: 8, color: INK3 }]}>{gaps.length} gap{gaps.length === 1 ? "" : "s"}</Text>
                </View>
                <Text style={{ fontSize: 9, color: INK2, marginBottom: 4, fontStyle: "italic", lineHeight: 1.4 }}>
                  {gaps[0].rationale}
                </Text>
                {gaps.slice(0, 4).map((g: RoutedGap, j: number) => (
                  <View key={j} style={{ marginTop: 3 }}>
                    <Text style={[styles.bullet, { color: INK2, fontSize: 8.5, lineHeight: 1.35 }]}>
                      · {g.lotId ? `[${g.lotId}${g.criterionId ? `/${g.criterionId}` : ""}] ` : "[notice-wide] "}
                      {g.kind === "disqualifier" ? "✗ " : ""}
                      {g.text.slice(0, 180)}
                    </Text>
                  </View>
                ))}
                {gaps.length > 4 && (
                  <Text style={[styles.mono, { fontSize: 8, color: INK3, marginTop: 2 }]}>… +{gaps.length - 4} more</Text>
                )}
              </View>
            ));
          })()}

          <View style={{ position: "absolute", bottom: 28, left: 48, right: 48, flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={[styles.mono, { fontSize: 7, color: INK3 }]}>Generated {ctx.generatedAt}</Text>
            <Text style={[styles.mono, { fontSize: 7, color: INK3 }]}>tenderpath.me · {tag}</Text>
          </View>
        </Page>
      )}
    </Document>
  );

  const blob = await pdf(Doc).toBlob();
  return Buffer.from(await blob.arrayBuffer());
}

/**
 * Submission instructions PDF — the user's step-by-step guide for completing
 * the roster registration with the target agency, themselves.
 */
export async function renderSubmissionInstructionsPdf(
  output: RosterOutput,
  ctx: DocContext,
  workOrderId: number,
  agency: AgencyPackage,
): Promise<Buffer> {
  const tag = refTag("ROST", workOrderId);
  // Sprint 14. Breakdown leads the PDF so the user sees "start_here"
  // before any agency-specific narrative — mirrors the dashboard
  // ordering. Legacy packages without the breakdown skip page 1
  // cleanly and the PDF stays at 2 pages.
  const breakdown = output.agency_readiness_breakdown ?? [];
  const hasBreakdown = breakdown.length > 0;
  const startHere = breakdown.find((b) => b.recommendation === "start_here");
  const viable = breakdown.filter((b) => b.recommendation === "viable");
  const blocked = breakdown.filter((b) => b.recommendation === "blocked");
  const Doc = (
    <Document title={`Submission instructions · ${agency.label}`} author="TenderPath">
      {hasBreakdown && (
        <Page size="A4" style={styles.page}>
          {masthead(ctx, `Agency readiness · ${agency.label}`, tag)}
          <View style={styles.ruleInk} />
          <View style={styles.section}>
            <Text style={styles.h2}>Where to start</Text>
            <Text style={{ fontSize: 10, color: INK2, marginBottom: 10, lineHeight: 1.4 }}>
              We scored {ctx.companyName} against {breakdown.length} UN procurement portals. Start with the highest-readiness agency — it is the one with the strongest document coverage, category fit, and geographic reach today.
            </Text>
            {startHere && <AgencyBlockPdf agency={startHere} tag="START HERE" />}
            {viable.length > 0 && (
              <View style={{ marginTop: 14 }}>
                <Text style={[styles.label, { marginBottom: 6 }]}>Also viable</Text>
                {viable.map((b) => <AgencyBlockPdf key={b.agency_slug} agency={b} tag="VIABLE" />)}
              </View>
            )}
            {blocked.length > 0 && (
              <View style={{ marginTop: 14 }}>
                <Text style={[styles.label, { marginBottom: 6 }]}>Skip for now</Text>
                {blocked.map((b) => (
                  <Text key={b.agency_slug} style={[styles.bullet, { color: INK2 }]}>
                    · <Text style={{ fontFamily: "Helvetica-Bold", color: INK }}>{b.agency_label} {b.readiness_0_10}/10</Text> — {b.rationale}
                  </Text>
                ))}
              </View>
            )}
          </View>
          <View style={{ position: "absolute", bottom: 28, left: 48, right: 48, flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={[styles.mono, { fontSize: 7, color: INK3 }]}>Generated {ctx.generatedAt}</Text>
            <Text style={[styles.mono, { fontSize: 7, color: INK3 }]}>tenderpath.me · {tag}</Text>
          </View>
        </Page>
      )}
      <Page size="A4" style={styles.page}>
        {masthead(ctx, `Submission · ${agency.label}`, tag)}
        <View style={styles.ruleInk} />

        <View style={styles.section}>
          <Text style={styles.h2}>Where you submit</Text>
          <Text style={{ fontSize: 11, color: INK, marginBottom: 4 }}>{agency.portalLabel}</Text>
          <Text style={[styles.mono, { fontSize: 9, color: GOLD }]}>{agency.portalUrl}</Text>
          {agency.notes.length > 0 && (
            <View style={{ marginTop: 8 }}>
              {agency.notes.map((n, i) => (
                <Text key={i} style={[styles.bullet, { color: INK2 }]}>· {n}</Text>
              ))}
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.h2}>Registration steps</Text>
          {agency.submissionSteps.map((step, i) => (
            <View key={i} style={{ flexDirection: "row", marginBottom: 8 }}>
              <Text style={[styles.mono, { fontSize: 10, color: GOLD, width: 28 }]}>{String(i + 1).padStart(2, "0")}</Text>
              <Text style={[styles.bullet, { flex: 1 }]}>{step}</Text>
            </View>
          ))}
        </View>

        {output.submission_guidance.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.h2}>Tips and common rejections</Text>
            {output.submission_guidance.map((g, i) => (
              <Text key={i} style={[styles.bullet, { color: INK2 }]}>· {g}</Text>
            ))}
          </View>
        )}
      </Page>

      <Page size="A4" style={styles.page}>
        <View style={{ marginBottom: 14 }}>
          <Text style={[styles.mono, { fontSize: 7, letterSpacing: 1.5, color: GOLD, textTransform: "uppercase", marginBottom: 4 }]}>
            Submission · {agency.label} · File-naming
          </Text>
          <Text style={{ fontSize: 18, fontFamily: "Helvetica-Bold", color: INK }}>
            File-naming rules
          </Text>
        </View>
        <View style={styles.ruleInk} />

        {output.document_renaming_rules.length > 0 ? (
          <View>
            <Text style={{ fontSize: 10, color: INK2, marginBottom: 10, lineHeight: 1.4 }}>
              {agency.label} expects specific filenames. Rename each uploaded file before submission.
            </Text>
            <View style={{ flexDirection: "row", paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: INK }}>
              <Text style={[styles.label, { width: 160 }]}>Document type</Text>
              <Text style={[styles.label, { width: 180 }]}>Required filename</Text>
              <Text style={[styles.label, { flex: 1 }]}>Note</Text>
            </View>
            {output.document_renaming_rules.map((r, i) => (
              <View
                key={i}
                style={{ flexDirection: "row", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: RULE }}
              >
                <Text style={{ fontSize: 10, color: INK, width: 160 }}>{r.document_type}</Text>
                <Text style={[styles.mono, { fontSize: 9.5, color: INK, width: 180 }]}>{r.required_filename}</Text>
                <Text style={{ fontSize: 9, color: INK2, flex: 1, lineHeight: 1.4 }}>{r.note ?? "—"}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={{ fontSize: 11, color: INK2 }}>
            {agency.label} does not enforce strict filename conventions. Use descriptive lowercase filenames
            (e.g. <Text style={styles.mono}>company-profile.pdf</Text>, <Text style={styles.mono}>audited-financials-2025.pdf</Text>).
          </Text>
        )}

        {output.missing_information.length > 0 && (
          <View style={[styles.section, { marginTop: 28, borderLeftWidth: 2, borderLeftColor: RED, paddingLeft: 12 }]}>
            <Text style={[styles.label, { color: RED, marginBottom: 6 }]}>Information still needed before submission</Text>
            {output.missing_information.map((m, i) => (
              <Text key={i} style={[styles.bullet, { color: RED }]}>· {m}</Text>
            ))}
          </View>
        )}

        {output.next_steps.length > 0 && (
          <View style={{ marginTop: 20 }}>
            <Text style={styles.h2}>Your next steps</Text>
            {output.next_steps.map((s, i) => (
              <View key={i} style={{ flexDirection: "row", marginBottom: 6 }}>
                <Text style={[styles.mono, { fontSize: 9, color: GOLD, width: 24 }]}>
                  {String(i + 1).padStart(2, "0")}
                </Text>
                <Text style={[styles.bullet, { flex: 1 }]}>{s}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={{ position: "absolute", bottom: 28, left: 48, right: 48, flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={[styles.mono, { fontSize: 7, color: INK3 }]}>Generated {ctx.generatedAt}</Text>
          <Text style={[styles.mono, { fontSize: 7, color: INK3 }]}>tenderpath.me · {tag}</Text>
        </View>
      </Page>
    </Document>
  );
  const blob = await pdf(Doc).toBlob();
  return Buffer.from(await blob.arrayBuffer());
}
