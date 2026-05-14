import React from "react";
import { Document, Page, Text, View, StyleSheet, pdf } from "@react-pdf/renderer";
import type { BidNoBidOutput, BidRequirement, Severity } from "./types";

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
  rule: { borderBottomWidth: 1, borderBottomColor: RULE, marginBottom: 12 },
  ruleInk: { borderBottomWidth: 1, borderBottomColor: INK, marginBottom: 12 },
  section: { marginBottom: 24 },
  h2: { fontSize: 15, fontFamily: "Helvetica-Bold", marginBottom: 8, color: INK },
  bullet: { fontSize: 10, lineHeight: 1.5, color: INK, marginBottom: 4 },
});

export interface BidPdfArgs {
  workOrderId: number;
  companyName: string;
  tenderTitle: string | null;
  agency: string | null;
  output: BidNoBidOutput;
  generatedAt: string;
}

const recColor = (rec: BidNoBidOutput["recommendation"]): string => {
  if (rec === "bid") return GREEN;
  if (rec === "no-bid") return RED;
  return GOLD;
};

const sevColor = (sev: Severity): string => {
  if (sev === "high") return RED;
  if (sev === "medium") return GOLD;
  return INK3;
};

const orderRef = (id: number): string =>
  `BNB-${id.toString(16).toUpperCase().padStart(4, "0")}`;

const BulletList = ({ items, maxItems = 12 }: { items: string[]; maxItems?: number }) => (
  <View>
    {items.slice(0, maxItems).map((item, i) => (
      <View key={i} style={{ flexDirection: "row", marginBottom: 4 }}>
        <Text style={[styles.bullet, { width: 12, color: GOLD }]}>·</Text>
        <Text style={[styles.bullet, { flex: 1 }]}>{item}</Text>
      </View>
    ))}
  </View>
);

const mandatoryDocs = (output: BidNoBidOutput): BidRequirement[] =>
  output.document_checklist?.mandatory?.length ? output.document_checklist.mandatory : output.required_documents;

const recommendedDocs = (output: BidNoBidOutput): BidRequirement[] =>
  output.document_checklist?.recommended ?? [];

const DocumentRows = ({ docs }: { docs: BidRequirement[] }) => (
  <View>
    {docs.map((doc, i) => (
      <View
        key={i}
        style={{
          flexDirection: "row",
          paddingVertical: 6,
          borderBottomWidth: 1,
          borderBottomColor: RULE,
        }}
      >
        <Text style={[styles.mono, { fontSize: 8, color: INK3, width: 24 }]}>
          {String(i + 1).padStart(2, "0")}
        </Text>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 10, fontFamily: "Helvetica-Bold", color: INK }}>{doc.document}</Text>
          {doc.why_needed && (
            <Text style={{ fontSize: 9, color: INK2, marginTop: 2, lineHeight: 1.4 }}>{doc.why_needed}</Text>
          )}
        </View>
        <Text style={[styles.mono, { fontSize: 8, color: INK3, marginLeft: 8 }]}>
          {doc.estimated_effort_hours != null ? `${doc.estimated_effort_hours}h` : "—"}
        </Text>
      </View>
    ))}
  </View>
);

const BidPdf = ({
  workOrderId,
  companyName,
  tenderTitle,
  agency,
  output,
  generatedAt,
}: BidPdfArgs) => (
  <Document title={`TenderPath Bid/No-Bid · ${tenderTitle ?? companyName}`} author="TenderPath">
    <Page size="A4" style={styles.page}>
      {/* Masthead */}
      <View style={{ marginBottom: 20 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
          <Text style={[styles.mono, { fontSize: 7, letterSpacing: 1.5, color: GOLD, textTransform: "uppercase" }]}>
            Bid / No-Bid Analysis · {orderRef(workOrderId)}
          </Text>
          <Text style={[styles.mono, { fontSize: 7, color: INK3 }]}>TenderPath.me</Text>
        </View>
        <Text style={{ fontSize: 22, fontFamily: "Helvetica-Bold", letterSpacing: -0.4, color: INK, marginBottom: 2 }}>
          {tenderTitle ?? "Untitled tender"}
        </Text>
        <Text style={[styles.mono, { fontSize: 8, color: INK3, letterSpacing: 0.5 }]}>
          {agency ? `${agency} · ` : ""}For {companyName}
        </Text>
      </View>
      <View style={styles.ruleInk} />

      {/* Recommendation */}
      <View style={[styles.section, { flexDirection: "row", alignItems: "flex-start", gap: 24 }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.label, { marginBottom: 4 }]}>Recommendation</Text>
          <Text
            style={{
              fontSize: 34,
              fontFamily: "Helvetica-Bold",
              color: recColor(output.recommendation),
              letterSpacing: -1,
              lineHeight: 1,
              textTransform: "uppercase",
            }}
          >
            {output.recommendation}
          </Text>
          <Text style={[styles.mono, { fontSize: 8, color: INK3, marginTop: 6, letterSpacing: 0.6 }]}>
            Win probability · {output.win_probability_band}
          </Text>
        </View>
        <View style={{ flex: 1.3 }}>
          <Text style={[styles.label, { marginBottom: 4 }]}>Headline</Text>
          <Text style={{ fontSize: 12, lineHeight: 1.45, color: INK2 }}>{output.headline}</Text>
          <View style={{ marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: RULE }}>
            <Text style={[styles.label, { marginBottom: 2 }]}>Total effort</Text>
            <Text style={{ fontSize: 14, fontFamily: "Helvetica-Bold", color: INK }}>
              {output.effort_estimate_hours} hrs
              <Text style={{ fontSize: 9, color: INK3 }}> · decision to submit</Text>
            </Text>
          </View>
          <View style={{ marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: RULE }}>
            <Text style={[styles.label, { marginBottom: 2 }]}>Tender type</Text>
            <Text style={{ fontSize: 13, fontFamily: "Helvetica-Bold", color: INK }}>
              {output.tender_type.label}
              <Text style={{ fontSize: 9, color: INK3 }}> · {output.tender_type.effort_level} effort</Text>
            </Text>
            <Text style={{ fontSize: 8.5, color: INK2, lineHeight: 1.35, marginTop: 3 }}>
              {output.tender_type.guidance}
            </Text>
          </View>
        </View>
      </View>

      {/* Fit reasoning */}
      {output.fit_reasoning.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.h2}>Why this matches</Text>
          <BulletList items={output.fit_reasoning} maxItems={6} />
        </View>
      )}

      {/* Conditions for bid (only on conditional) */}
      {output.recommendation === "conditional" && output.conditions_for_bid.length > 0 && (
        <View style={[styles.section, { backgroundColor: "#f4ecd7", padding: 14, borderRadius: 2 }]}>
          <Text style={[styles.label, { color: GOLD, marginBottom: 6 }]}>Conditions to convert to a bid</Text>
          <BulletList items={output.conditions_for_bid} />
        </View>
      )}

      {/* Red flags (only when present) */}
      {output.red_flags.length > 0 && (
        <View style={[styles.section, { borderLeftWidth: 2, borderLeftColor: RED, paddingLeft: 12 }]}>
          <Text style={[styles.label, { color: RED, marginBottom: 6 }]}>Red flags</Text>
          {output.red_flags.map((f, i) => (
            <Text key={i} style={[styles.bullet, { color: RED, marginBottom: 3 }]}>· {f}</Text>
          ))}
        </View>
      )}

      {/* Commercial terms */}
      {output.commercial_terms.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.h2}>Commercial terms to check</Text>
          {output.commercial_terms.slice(0, 5).map((term, i) => (
            <View key={i} style={{ marginBottom: 8, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: RULE }}>
              <View style={{ flexDirection: "row", alignItems: "baseline", marginBottom: 2 }}>
                <Text style={[styles.mono, { fontSize: 7, color: term.risk === "high" ? RED : term.risk === "medium" ? GOLD : INK3, letterSpacing: 1, marginRight: 8, textTransform: "uppercase" }]}>
                  {term.risk}
                </Text>
                <Text style={{ fontSize: 10.5, fontFamily: "Helvetica-Bold", color: INK, flex: 1 }}>{term.label}</Text>
              </View>
              <Text style={{ fontSize: 9, lineHeight: 1.35, color: INK2, marginLeft: 44 }}>{term.value}</Text>
              {term.note && (
                <Text style={{ fontSize: 8.5, lineHeight: 1.3, color: INK3, marginLeft: 44, marginTop: 2 }}>{term.note}</Text>
              )}
            </View>
          ))}
        </View>
      )}

      {/* Eligibility actions */}
      {output.eligibility_actions.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.h2}>Eligibility action</Text>
          {output.eligibility_actions.slice(0, 4).map((action, i) => (
            <View key={i} style={{ marginBottom: 8 }}>
              <Text style={{ fontSize: 10.5, fontFamily: "Helvetica-Bold", color: sevColor(action.severity), marginBottom: 2 }}>
                {action.label}
              </Text>
              <Text style={{ fontSize: 9, color: INK, lineHeight: 1.35 }}>{action.requirement}</Text>
              {action.rationale && (
                <Text style={{ fontSize: 8.5, color: INK2, lineHeight: 1.3, marginTop: 2 }}>{action.rationale}</Text>
              )}
            </View>
          ))}
        </View>
      )}

      {/* Gap analysis */}
      {output.gap_analysis.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.h2}>Gaps to close</Text>
          {output.gap_analysis.map((g, i) => (
            <View key={i} style={{ marginBottom: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "baseline", marginBottom: 2 }}>
                <Text style={[styles.mono, { fontSize: 7, color: sevColor(g.severity), letterSpacing: 1, marginRight: 8, textTransform: "uppercase" }]}>
                  {g.severity}
                </Text>
                <Text style={{ fontSize: 11, fontFamily: "Helvetica-Bold", color: INK, flex: 1 }}>{g.gap}</Text>
              </View>
              <Text style={{ fontSize: 9.5, lineHeight: 1.45, color: INK2, marginLeft: 36 }}>{g.fix}</Text>
            </View>
          ))}
        </View>
      )}
    </Page>

    {/* Page 2 — required docs + next steps */}
    <Page size="A4" style={styles.page}>
      <View style={{ marginBottom: 14 }}>
        <Text style={[styles.mono, { fontSize: 7, letterSpacing: 1.5, color: GOLD, textTransform: "uppercase", marginBottom: 4 }]}>
          Bid / No-Bid Analysis · Page 2
        </Text>
        <Text style={{ fontSize: 18, fontFamily: "Helvetica-Bold", color: INK }}>
          What to prepare
        </Text>
      </View>
      <View style={styles.ruleInk} />

      {/* Required documents */}
      {(mandatoryDocs(output).length > 0 || recommendedDocs(output).length > 0) && (
        <View style={styles.section}>
          <Text style={styles.h2}>Mandatory documents</Text>
          <DocumentRows docs={mandatoryDocs(output)} />
          {recommendedDocs(output).length > 0 && (
            <View style={{ marginTop: 14 }}>
              <Text style={[styles.h2, { fontSize: 13 }]}>Recommended support</Text>
              <DocumentRows docs={recommendedDocs(output)} />
            </View>
          )}
        </View>
      )}

      {/* Next steps */}
      {output.next_steps.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.h2}>Next steps</Text>
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

      {/* Evidence */}
      {(output.evidence.tender_excerpt ||
        output.evidence.company_capabilities_matched.length > 0 ||
        output.evidence.company_capabilities_missing.length > 0) && (
        <View style={[styles.section, { paddingTop: 12, borderTopWidth: 1, borderTopColor: RULE }]}>
          <Text style={styles.h2}>Evidence</Text>
          {output.evidence.tender_excerpt && (
            <View style={{ marginBottom: 8 }}>
              <Text style={[styles.label, { marginBottom: 3 }]}>From the tender</Text>
              <Text style={{ fontSize: 9, fontStyle: "italic", color: INK2, lineHeight: 1.4 }}>
                &ldquo;{output.evidence.tender_excerpt}&rdquo;
              </Text>
            </View>
          )}
          {output.evidence.company_capabilities_matched.length > 0 && (
            <View style={{ marginBottom: 6 }}>
              <Text style={[styles.label, { marginBottom: 3, color: GREEN }]}>Matched capabilities</Text>
              <Text style={{ fontSize: 9, color: INK2, lineHeight: 1.4 }}>
                {output.evidence.company_capabilities_matched.join(" · ")}
              </Text>
            </View>
          )}
          {output.evidence.company_capabilities_missing.length > 0 && (
            <View>
              <Text style={[styles.label, { marginBottom: 3, color: RED }]}>Missing capabilities</Text>
              <Text style={{ fontSize: 9, color: INK2, lineHeight: 1.4 }}>
                {output.evidence.company_capabilities_missing.join(" · ")}
              </Text>
            </View>
          )}
        </View>
      )}

      {/* Footer */}
      <View style={{ position: "absolute", bottom: 28, left: 48, right: 48, flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={[styles.mono, { fontSize: 7, color: INK3 }]}>
          Generated {generatedAt}
        </Text>
        <Text style={[styles.mono, { fontSize: 7, color: INK3 }]}>
          tenderpath.me · {orderRef(workOrderId)}
        </Text>
      </View>
    </Page>
  </Document>
);

export async function renderBidNoBidPdf(args: BidPdfArgs): Promise<Buffer> {
  const blob = await pdf(<BidPdf {...args} />).toBlob();
  return Buffer.from(await blob.arrayBuffer());
}
