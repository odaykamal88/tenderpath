import React from "react";
import { Document, Page, Text, View, StyleSheet, pdf } from "@react-pdf/renderer";
import {
  type BidNoBidOutput,
  type BidEligibilityFinding,
  type BidRequirement,
  type CommercialTerms,
  type EvidenceLabel,
  type Severity,
  ELIGIBILITY_ACTION_LABEL,
  EVIDENCE_LABEL_TEXT,
  TENDER_TYPE_LABEL,
  hasCommercialTerms,
} from "./types";

const GOLD = "#b08530";
const INK = "#1a1a1a";
const INK2 = "#4a4a4a";
const INK3 = "#6b6b6b";
const RULE = "#d8d0bd";
const RED = "#b8463f";
const GREEN = "#1f6a3c";
const BLUE = "#1c3a5f";

const styles = StyleSheet.create({
  page: { backgroundColor: "#f5f1e8", padding: 48, fontFamily: "Helvetica", color: INK },
  mono: { fontFamily: "Courier" },
  label: { fontSize: 7, letterSpacing: 1.2, textTransform: "uppercase", color: INK3 },
  rule: { borderBottomWidth: 1, borderBottomColor: RULE, marginBottom: 12 },
  ruleInk: { borderBottomWidth: 1, borderBottomColor: INK, marginBottom: 12 },
  section: { marginBottom: 20 },
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

const evidenceColor = (label: EvidenceLabel | undefined): string => {
  if (label === "evidence") return GREEN;
  if (label === "gap") return RED;
  if (label === "unverified") return GOLD;
  return INK3; // inference and default
};

const eligibilityStatusColor = (status: BidEligibilityFinding["status"]): string => {
  if (status === "met") return GREEN;
  if (status === "gap") return RED;
  return GOLD;
};

const orderRef = (id: number): string =>
  `BNB-${id.toString(16).toUpperCase().padStart(4, "0")}`;

/* Small uppercase pill — reused for evidence labels, eligibility actions, tender type. */
const Pill = ({
  text,
  color,
  bg,
}: {
  text: string;
  color: string;
  bg?: string;
}) => (
  <Text
    style={{
      fontSize: 6.5,
      letterSpacing: 0.9,
      fontFamily: "Helvetica-Bold",
      color,
      backgroundColor: bg ?? "transparent",
      borderWidth: bg ? 0 : 0.5,
      borderColor: color,
      paddingHorizontal: 4,
      paddingVertical: 1.5,
      textTransform: "uppercase",
    }}
  >
    {text}
  </Text>
);

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

/* ── Commercial terms block ─────────────────────────────────────────────── */
const CommercialTermsBlock = ({ terms }: { terms: CommercialTerms }) => {
  const fmtPct = (n: number | null) => (n == null ? null : `${n}%`);
  const rows: Array<[string, string | null]> = [
    ["Payment terms", terms.payment_terms],
    ["Performance bond", fmtPct(terms.performance_bond_pct)],
    ["Bid security", fmtPct(terms.bid_security_pct)],
    ["Advance payment", fmtPct(terms.advance_payment_pct)],
    ["Retention", fmtPct(terms.retention_pct)],
    ["Bid validity", terms.bid_validity_days != null ? `${terms.bid_validity_days} days` : null],
    ["Completion period", terms.completion_period],
    ["Currency", terms.currency],
  ];
  const rendered = rows.filter(([, v]) => v != null);
  if (rendered.length === 0 && terms.notes.length === 0) return null;

  return (
    <View style={[styles.section, { borderLeftWidth: 2, borderLeftColor: BLUE, paddingLeft: 12 }]}>
      <Text style={[styles.label, { color: BLUE, marginBottom: 6 }]}>Commercial terms</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
        {rendered.map(([k, v], i) => (
          <View
            key={i}
            style={{
              width: "50%",
              marginBottom: 6,
              paddingRight: 8,
            }}
          >
            <Text style={[styles.label, { marginBottom: 1 }]}>{k}</Text>
            <Text style={{ fontSize: 10, color: INK, fontFamily: "Helvetica-Bold" }}>{v}</Text>
          </View>
        ))}
      </View>
      {terms.notes.length > 0 && (
        <View style={{ marginTop: 4 }}>
          <Text style={[styles.label, { marginBottom: 3 }]}>Notes</Text>
          {terms.notes.map((n, i) => (
            <Text key={i} style={{ fontSize: 9, color: INK2, lineHeight: 1.4, marginBottom: 2 }}>
              · {n}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
};

/* ── Eligibility findings block ─────────────────────────────────────────── */
const EligibilityFindings = ({ items }: { items: BidEligibilityFinding[] }) => {
  if (items.length === 0) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.h2}>Eligibility findings</Text>
      {items.map((f, i) => (
        <View key={i} style={{ marginBottom: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "flex-start", marginBottom: 3, gap: 6 }}>
            <View style={{ marginRight: 4 }}>
              <Pill text={f.status} color={eligibilityStatusColor(f.status)} />
            </View>
            <Text style={{ fontSize: 11, fontFamily: "Helvetica-Bold", color: INK, flex: 1, lineHeight: 1.35 }}>
              {f.requirement}
            </Text>
          </View>
          <View style={{ flexDirection: "row", marginLeft: 0, marginBottom: 2, gap: 6 }}>
            <Pill text={ELIGIBILITY_ACTION_LABEL[f.recommended_action]} color={GOLD} />
            <Pill text={EVIDENCE_LABEL_TEXT[f.evidence_label]} color={evidenceColor(f.evidence_label)} />
          </View>
          {f.rationale && (
            <Text style={{ fontSize: 9.5, color: INK2, lineHeight: 1.45, marginTop: 2 }}>{f.rationale}</Text>
          )}
        </View>
      ))}
    </View>
  );
};

/* ── Document list, grouped by priority ─────────────────────────────────── */
const DocumentList = ({ docs }: { docs: BidRequirement[] }) => {
  const mandatory = docs.filter((d) => (d.priority ?? "mandatory") === "mandatory");
  const recommended = docs.filter((d) => d.priority === "recommended");
  if (mandatory.length === 0 && recommended.length === 0) return null;

  const Row = ({ doc, idx, prefix }: { doc: BidRequirement; idx: number; prefix: string }) => (
    <View
      style={{
        flexDirection: "row",
        paddingVertical: 6,
        borderBottomWidth: 1,
        borderBottomColor: RULE,
      }}
    >
      <Text style={[styles.mono, { fontSize: 8, color: INK3, width: 28 }]}>
        {prefix}{String(idx + 1).padStart(2, "0")}
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
  );

  return (
    <View style={styles.section}>
      {mandatory.length > 0 && (
        <View style={{ marginBottom: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 4, gap: 6 }}>
            <Text style={styles.h2}>Mandatory documents</Text>
            <Pill text={`${mandatory.length}`} color={RED} />
          </View>
          {mandatory.map((doc, i) => (
            <Row key={`m-${i}`} doc={doc} idx={i} prefix="M-" />
          ))}
        </View>
      )}
      {recommended.length > 0 && (
        <View>
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 4, gap: 6 }}>
            <Text style={styles.h2}>Recommended documents</Text>
            <Pill text={`${recommended.length}`} color={GOLD} />
          </View>
          {recommended.map((doc, i) => (
            <Row key={`r-${i}`} doc={doc} idx={i} prefix="R-" />
          ))}
        </View>
      )}
    </View>
  );
};

const BidPdf = ({
  workOrderId,
  companyName,
  tenderTitle,
  agency,
  output,
  generatedAt,
}: BidPdfArgs) => {
  const tenderTypeLabel = output.tender_type ? TENDER_TYPE_LABEL[output.tender_type] : null;
  const terms = output.commercial_terms;
  const showCommercialTerms = hasCommercialTerms(terms);
  const eligibilityFindings = output.eligibility_findings ?? [];

  return (
  <Document title={`TenderPath Bid/No-Bid · ${tenderTitle ?? companyName}`} author="TenderPath">
    <Page size="A4" style={styles.page}>
      {/* Masthead */}
      <View style={{ marginBottom: 16 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
          <Text style={[styles.mono, { fontSize: 7, letterSpacing: 1.5, color: GOLD, textTransform: "uppercase" }]}>
            Bid / No-Bid Analysis · {orderRef(workOrderId)}
          </Text>
          <Text style={[styles.mono, { fontSize: 7, color: INK3 }]}>TenderPath.me</Text>
        </View>
        <Text style={{ fontSize: 22, fontFamily: "Helvetica-Bold", letterSpacing: -0.4, color: INK, marginBottom: 4 }}>
          {tenderTitle ?? "Untitled tender"}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <Text style={[styles.mono, { fontSize: 8, color: INK3, letterSpacing: 0.5 }]}>
            {agency ? `${agency} · ` : ""}For {companyName}
          </Text>
          {tenderTypeLabel && tenderTypeLabel !== "Unknown" && (
            <Pill text={tenderTypeLabel} color={BLUE} bg="#e6ecf3" />
          )}
        </View>
        {output.tender_type_note && (
          <Text style={{ fontSize: 9, color: INK2, marginTop: 4, lineHeight: 1.4 }}>
            {output.tender_type_note}
          </Text>
        )}
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
        </View>
      </View>

      {/* Fit reasoning */}
      {output.fit_reasoning.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.h2}>Why this matches</Text>
          <BulletList items={output.fit_reasoning} maxItems={6} />
        </View>
      )}

      {/* Eligibility findings */}
      <EligibilityFindings items={eligibilityFindings} />

      {/* Conditions for bid (only on conditional) */}
      {output.recommendation === "conditional" && output.conditions_for_bid.length > 0 && (
        <View style={[styles.section, { backgroundColor: "#f4ecd7", padding: 14, borderRadius: 2 }]}>
          <Text style={[styles.label, { color: GOLD, marginBottom: 6 }]}>Conditions to convert to a bid</Text>
          <BulletList items={output.conditions_for_bid} />
        </View>
      )}

      {/* Red flags */}
      {output.red_flags.length > 0 && (
        <View style={[styles.section, { borderLeftWidth: 2, borderLeftColor: RED, paddingLeft: 12 }]}>
          <Text style={[styles.label, { color: RED, marginBottom: 6 }]}>Red flags</Text>
          {output.red_flags.map((f, i) => (
            <Text key={i} style={[styles.bullet, { color: RED, marginBottom: 3 }]}>· {f}</Text>
          ))}
        </View>
      )}

      {/* Gap analysis with evidence labels */}
      {output.gap_analysis.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.h2}>Gaps to close</Text>
          {output.gap_analysis.map((g, i) => (
            <View key={i} style={{ marginBottom: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "baseline", marginBottom: 2, gap: 6 }}>
                <Text style={[styles.mono, { fontSize: 7, color: sevColor(g.severity), letterSpacing: 1, textTransform: "uppercase" }]}>
                  {g.severity}
                </Text>
                {g.evidence_label && (
                  <Pill text={EVIDENCE_LABEL_TEXT[g.evidence_label]} color={evidenceColor(g.evidence_label)} />
                )}
                <Text style={{ fontSize: 11, fontFamily: "Helvetica-Bold", color: INK, flex: 1 }}>{g.gap}</Text>
              </View>
              <Text style={{ fontSize: 9.5, lineHeight: 1.45, color: INK2, marginLeft: 0 }}>{g.fix}</Text>
            </View>
          ))}
        </View>
      )}
    </Page>

    {/* Page 2 — required docs + commercial terms + next steps */}
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

      {/* Commercial terms */}
      {showCommercialTerms && terms && <CommercialTermsBlock terms={terms} />}

      {/* Documents (split mandatory vs recommended) */}
      <DocumentList docs={output.required_documents} />

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
};

export async function renderBidNoBidPdf(args: BidPdfArgs): Promise<Buffer> {
  const blob = await pdf(<BidPdf {...args} />).toBlob();
  return Buffer.from(await blob.arrayBuffer());
}
