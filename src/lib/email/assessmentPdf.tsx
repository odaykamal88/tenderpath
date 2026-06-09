import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  pdf,
} from "@react-pdf/renderer";
import type { Gap, MatchedTender, MatchedGrant, ReadinessDimensions, TierSlug } from "@/lib/types";

const GOLD = "#b08530";
const INK = "#1a1a1a";
const INK2 = "#4a4a4a";
const INK3 = "#6b6b6b";
const RULE = "#d8d0bd";
const RED = "#b8463f";

const styles = StyleSheet.create({
  page: { backgroundColor: "#f5f1e8", padding: 48, fontFamily: "Helvetica", color: INK },
  mono: { fontFamily: "Courier" },
  label: { fontSize: 7, letterSpacing: 1.2, textTransform: "uppercase", color: INK3 },
  rule: { borderBottomWidth: 1, borderBottomColor: RULE, marginBottom: 12 },
  ruleInk: { borderBottomWidth: 1, borderBottomColor: INK, marginBottom: 12 },
  row: { flexDirection: "row", alignItems: "flex-end" },
  section: { marginBottom: 28 },
});

interface PdfArgs {
  id: number;
  companyName: string;
  email: string;
  sectors: string[];
  readinessScore: number;
  grantReadinessScore: number;
  summary: string;
  recommendedTier: TierSlug;
  readinessDimensions: ReadinessDimensions;
  gaps: Gap[];
  strengths: string[];
  matchedTenders: MatchedTender[];
  matchedGrants: MatchedGrant[];
}

const DimBar = ({ label, score }: { label: string; score: number }) => (
  <View style={{ marginBottom: 8 }}>
    <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 3 }}>
      <Text style={{ fontFamily: "Helvetica", fontSize: 9, color: INK2 }}>{label}</Text>
      <Text style={{ fontFamily: "Courier", fontSize: 9, color: INK3 }}>{score}</Text>
    </View>
    <View style={{ height: 3, backgroundColor: RULE }}>
      <View
        style={{
          height: 3,
          width: `${score}%`,
          backgroundColor: score < 50 ? RED : score < 75 ? GOLD : INK,
        }}
      />
    </View>
  </View>
);

const AssessmentDocument = ({
  id,
  companyName,
  email,
  sectors,
  readinessScore,
  grantReadinessScore,
  summary,
  readinessDimensions: dims,
  gaps,
  strengths,
  matchedTenders,
  matchedGrants,
}: PdfArgs) => (
  <Document title={`TenderPath Report — ${companyName}`} author="TenderPath">
    <Page size="A4" style={styles.page}>

      {/* Masthead */}
      <View style={{ marginBottom: 28 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 8 }}>
          <Text style={[styles.mono, { fontSize: 7, letterSpacing: 1.5, color: GOLD, textTransform: "uppercase" }]}>
            Vendor Readiness Report · No. {String(id).padStart(4, "0")}
          </Text>
          <Text style={[styles.mono, { fontSize: 7, color: INK3 }]}>TenderPath.me</Text>
        </View>
        <Text style={{ fontSize: 28, fontFamily: "Helvetica-Bold", letterSpacing: -0.5, color: INK, marginBottom: 4 }}>
          {companyName}
        </Text>
        <Text style={[styles.mono, { fontSize: 8, color: INK3, letterSpacing: 0.5 }]}>
          {sectors.slice(0, 4).join(" · ")}
          {sectors.length > 4 ? ` · +${sectors.length - 4}` : ""}
        </Text>
      </View>
      <View style={styles.ruleInk} />

      {/* Hero Score + Dimensions */}
      <View style={{ flexDirection: "row", marginBottom: 28, gap: 32 }}>
        <View style={{ flex: 0.8 }}>
          <Text style={[styles.label, { marginBottom: 6 }]}>Overall readiness</Text>
          <View style={{ flexDirection: "row", alignItems: "flex-end", marginBottom: 4 }}>
            <Text style={{ fontSize: 64, fontFamily: "Helvetica-Bold", lineHeight: 0.9, color: INK, letterSpacing: -2 }}>
              {readinessScore}
            </Text>
            <Text style={{ fontSize: 22, color: INK3, marginBottom: 4 }}>/100</Text>
          </View>
          <Text style={[styles.mono, { fontSize: 8, color: GOLD, letterSpacing: 1, textTransform: "uppercase" }]}>
            {readinessScore >= 80 ? "Strong fit" : readinessScore >= 60 ? "Workable fit" : readinessScore >= 40 ? "Foundational gaps" : "Major gaps"}
          </Text>
          {grantReadinessScore > 0 && (
            <View style={{ marginTop: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: RULE }}>
              <Text style={[styles.label, { marginBottom: 4 }]}>Grant readiness</Text>
              <Text style={{ fontSize: 24, fontFamily: "Helvetica-Bold", color: INK }}>
                {grantReadinessScore}<Text style={{ fontSize: 14, color: INK3 }}>/100</Text>
              </Text>
            </View>
          )}
        </View>

        <View style={{ flex: 1 }}>
          <Text style={[styles.label, { marginBottom: 10 }]}>By dimension</Text>
          <DimBar label="Sector fit" score={dims.technical_capability ?? 0} />
          <DimBar label="Geography" score={dims.geographic_reach ?? 0} />
          <DimBar label="Compliance" score={dims.compliance_readiness ?? 0} />
          <DimBar label="Track record" score={dims.experience_relevance ?? 0} />
        </View>
      </View>

      {/* Summary */}
      <View style={{ marginBottom: 28 }}>
        <Text style={{ fontSize: 11, color: INK2, lineHeight: 1.6, fontStyle: "italic" }}>
          {`"${summary}"`}
        </Text>
      </View>

      {/* Gaps */}
      {gaps.length > 0 && (
        <View style={styles.section}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 8 }}>
            <Text style={{ fontSize: 16, fontFamily: "Helvetica-Bold", color: INK }}>
              Compliance gaps to fix
            </Text>
            <Text style={[styles.mono, { fontSize: 8, color: INK3 }]}>{gaps.length} gaps</Text>
          </View>
          <View style={styles.ruleInk} />
          {gaps.slice(0, 6).map((gap, i) => (
            <View key={i} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: RULE }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
                <Text style={[styles.mono, { fontSize: 8, color: GOLD }]}>{String(i + 1).padStart(2, "0")}</Text>
                <Text style={[styles.mono, { fontSize: 7, color: gap.severity === "high" ? RED : GOLD, letterSpacing: 1, textTransform: "uppercase", borderWidth: 0.5, borderColor: gap.severity === "high" ? RED : GOLD, paddingHorizontal: 4, paddingVertical: 1 }]}>
                  {gap.severity}
                </Text>
              </View>
              <Text style={{ fontSize: 10, fontFamily: "Helvetica-Bold", color: INK, marginBottom: 3 }}>{gap.gap}</Text>
              <Text style={{ fontSize: 9, color: INK2, lineHeight: 1.5 }}>{gap.fix}</Text>
              {gap.action_steps[0] && (
                <Text style={[styles.mono, { fontSize: 8, color: INK3, marginTop: 3 }]}>→ {gap.action_steps[0]}</Text>
              )}
            </View>
          ))}
        </View>
      )}
    </Page>

    {/* Page 2: Tenders + Grants + Strengths */}
    <Page size="A4" style={styles.page}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 20 }}>
        <Text style={[styles.mono, { fontSize: 7, color: GOLD, letterSpacing: 1, textTransform: "uppercase" }]}>TenderPath · {companyName}</Text>
        <Text style={[styles.mono, { fontSize: 7, color: INK3 }]}>Page 2</Text>
      </View>

      {/* Tenders */}
      {matchedTenders.length > 0 && (
        <View style={styles.section}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 8 }}>
            <Text style={{ fontSize: 16, fontFamily: "Helvetica-Bold", color: INK }}>Matched tenders</Text>
            <Text style={[styles.mono, { fontSize: 8, color: INK3 }]}>{matchedTenders.length} live</Text>
          </View>
          <View style={styles.ruleInk} />
          {matchedTenders.slice(0, 8).map((t, i) => (
            <View key={i} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: RULE }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text style={[styles.mono, { fontSize: 7, color: INK3, marginBottom: 2 }]}>{String(i + 1).padStart(2, "0")}</Text>
                  <Text style={{ fontSize: 10, color: INK, fontFamily: "Helvetica-Bold", marginBottom: 2 }}>{t.title}</Text>
                  <Text style={[styles.mono, { fontSize: 8, color: INK3 }]}>
                    {t.agency}{t.country ? ` · ${t.country}` : ""}
                    {t.deadline ? ` · Due ${new Date(t.deadline).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}` : ""}
                  </Text>
                  {t.match_reasons?.slice(0, 2).map((r, ri) => (
                    <Text key={ri} style={[styles.mono, { fontSize: 7, color: INK3, marginTop: 1 }]}>· {r}</Text>
                  ))}
                </View>
                <Text style={{ fontSize: 20, fontFamily: "Helvetica-Bold", color: INK }}>{t.score}</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Grants */}
      {matchedGrants.length > 0 && (
        <View style={styles.section}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 8 }}>
            <Text style={{ fontSize: 16, fontFamily: "Helvetica-Bold", color: INK }}>Matched grants</Text>
            <Text style={[styles.mono, { fontSize: 8, color: INK3 }]}>{matchedGrants.length} open</Text>
          </View>
          <View style={styles.ruleInk} />
          {matchedGrants.slice(0, 5).map((g, i) => (
            <View key={i} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: RULE }}>
              <Text style={[styles.mono, { fontSize: 7, color: INK3, marginBottom: 2 }]}>{String(i + 1).padStart(2, "0")}</Text>
              <Text style={{ fontSize: 10, color: INK, fontFamily: "Helvetica-Bold", marginBottom: 2 }}>{g.title}</Text>
              <Text style={[styles.mono, { fontSize: 8, color: INK3 }]}>
                {g.agency}{g.sector ? ` · ${g.sector}` : ""}
                {g.deadline ? ` · Due ${new Date(g.deadline).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}` : ""}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* Strengths */}
      {strengths.length > 0 && (
        <View style={styles.section}>
          <Text style={{ fontSize: 16, fontFamily: "Helvetica-Bold", color: INK, marginBottom: 8 }}>
            What you have going for you
          </Text>
          <View style={styles.ruleInk} />
          {strengths.map((s, i) => (
            <View key={i} style={{ flexDirection: "row", paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: RULE }}>
              <Text style={[styles.mono, { fontSize: 8, color: GOLD, width: 24 }]}>{String(i + 1).padStart(2, "0")}</Text>
              <Text style={{ fontSize: 9, color: INK2, lineHeight: 1.5, flex: 1 }}>{s}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Footer */}
      <View style={{ marginTop: "auto", paddingTop: 20, borderTopWidth: 1, borderTopColor: RULE }}>
        <Text style={[styles.mono, { fontSize: 7, color: INK3, textAlign: "center" }]}>
          Generated by TenderPath.me · {email} · Report #{String(id).padStart(4, "0")}
        </Text>
      </View>
    </Page>
  </Document>
);

export async function generateAssessmentPdf(args: PdfArgs): Promise<Buffer> {
  const blob = await pdf(<AssessmentDocument {...args} />).toBlob();
  return Buffer.from(await blob.arrayBuffer());
}
