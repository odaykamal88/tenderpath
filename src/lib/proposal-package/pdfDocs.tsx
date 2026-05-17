import React from "react";
import { Document, Page, Text, View, StyleSheet, pdf } from "@react-pdf/renderer";
import type { ProposalOutput, RosterOutput, ComplianceItem } from "./types";
import type { AgencyPackage } from "./roster-packages";

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
              We scored {ctx.companyName} against {breakdown.length} UN procurement portals. Start with the highest-readiness agency — it's the one with the strongest document coverage, category fit, and geographic reach today.
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
