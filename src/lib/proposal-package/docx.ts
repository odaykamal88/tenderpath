import {
  AlignmentType,
  Document,
  Footer,
  Header,
  HeadingLevel,
  Packer,
  PageNumber,
  Paragraph,
  TextRun,
  type ISectionOptions,
} from "docx";
import type { ProposalOutput, RosterOutput, ComplianceItem } from "./types";

const HEADING_FONT = "Calibri";
const BODY_FONT = "Calibri";
const RULE_COLOR = "B08530";

interface DocContext {
  companyName: string;
  tenderTitle: string | null;
  agency: string | null;
  generatedAt: string;
}

function masthead(ctx: DocContext, kind: string): Paragraph[] {
  return [
    new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { after: 80 },
      children: [
        new TextRun({
          text: kind.toUpperCase(),
          font: HEADING_FONT,
          color: RULE_COLOR,
          size: 16,
          bold: true,
          characterSpacing: 30,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { after: 80 },
      children: [
        new TextRun({
          text: ctx.tenderTitle ?? "Untitled opportunity",
          font: HEADING_FONT,
          bold: true,
          size: 36,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { after: 360 },
      children: [
        new TextRun({
          text: [
            ctx.agency ? `${ctx.agency}` : null,
            `Prepared for ${ctx.companyName}`,
            ctx.generatedAt,
          ].filter(Boolean).join(" · "),
          font: BODY_FONT,
          size: 18,
          color: "6B6B6B",
        }),
      ],
    }),
  ];
}

function pageHeader(ctx: DocContext): Header {
  return new Header({
    children: [
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [
          new TextRun({
            text: `TenderPath · ${ctx.companyName}`,
            font: BODY_FONT,
            size: 14,
            color: "9A9A9A",
          }),
        ],
      }),
    ],
  });
}

function pageFooter(): Footer {
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [
          new TextRun({ children: ["Page ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES], font: BODY_FONT, size: 14, color: "9A9A9A" }),
        ],
      }),
    ],
  });
}

function h2(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 360, after: 120 },
    children: [new TextRun({ text, font: HEADING_FONT, bold: true, size: 26 })],
  });
}

function body(text: string): Paragraph {
  return new Paragraph({
    spacing: { after: 160, line: 320 },
    children: [new TextRun({ text, font: BODY_FONT, size: 22 })],
  });
}

function bullet(text: string, level = 0): Paragraph {
  return new Paragraph({
    bullet: { level },
    spacing: { after: 80, line: 300 },
    children: [new TextRun({ text, font: BODY_FONT, size: 22 })],
  });
}

function numbered(text: string, number: number): Paragraph {
  return new Paragraph({
    spacing: { after: 80, line: 300 },
    children: [
      new TextRun({ text: `${String(number).padStart(2, "0")}.  `, font: BODY_FONT, bold: true, size: 22, color: RULE_COLOR }),
      new TextRun({ text, font: BODY_FONT, size: 22 }),
    ],
  });
}

function statusLabel(c: ComplianceItem): string {
  if (c.status === "compliant") return "✓ Compliant";
  if (c.status === "partial") return "△ Partial";
  return "✕ Needs action";
}

function sourceQualityLabel(output: ProposalOutput): string | null {
  const quality = output.source_quality;
  if (!quality) return null;
  return [
    `Status: ${quality.status}`,
    `Score: ${quality.score_0_10}/10`,
    quality.missing_inputs.length ? `Missing: ${quality.missing_inputs.join("; ")}` : null,
    quality.warnings.length ? `Warnings: ${quality.warnings.join("; ")}` : null,
  ].filter(Boolean).join(" | ");
}

/**
 * Sprint 14. Renders one agency_readiness_breakdown entry as a
 * three-line block: heading (label + score + tag + sub-scores),
 * rationale paragraph, missing-docs bullets, next-action bullets.
 * Compact enough that 8 agencies render on 1-2 pages.
 */
function renderAgencyBlock(
  paragraphs: Paragraph[],
  b: NonNullable<RosterOutput["agency_readiness_breakdown"]>[number],
  tag: string,
): void {
  paragraphs.push(
    new Paragraph({
      spacing: { before: 240, after: 80 },
      children: [
        new TextRun({ text: `${b.agency_label}`, font: BODY_FONT, bold: true, size: 24 }),
        new TextRun({ text: `   ${b.readiness_0_10}/10`, font: BODY_FONT, bold: true, size: 24, color: RULE_COLOR }),
        new TextRun({ text: `   [${tag}]`, font: BODY_FONT, bold: true, size: 18, color: RULE_COLOR }),
        new TextRun({ text: `   docs ${b.document_coverage_0_10}/10 · category ${b.category_fit_0_10}/10 · geo ${b.geographic_fit_0_10}/10`, font: BODY_FONT, size: 18 }),
      ],
    }),
  );
  if (b.rationale) paragraphs.push(body(b.rationale));
  if (b.missing_documents.length > 0) {
    paragraphs.push(
      new Paragraph({
        spacing: { before: 60, after: 40 },
        children: [new TextRun({ text: "Missing:", font: BODY_FONT, bold: true, size: 20 })],
      }),
    );
    b.missing_documents.forEach((d) => paragraphs.push(bullet(d)));
  }
  if (tag !== "BLOCKED" && b.next_actions.length > 0) {
    paragraphs.push(
      new Paragraph({
        spacing: { before: 60, after: 40 },
        children: [new TextRun({ text: "Next actions:", font: BODY_FONT, bold: true, size: 20 })],
      }),
    );
    b.next_actions.forEach((a) => paragraphs.push(bullet(a)));
  }
}

function buildSection(ctx: DocContext, paragraphs: Paragraph[], kind: string): ISectionOptions {
  return {
    properties: { page: { margin: { top: 1200, bottom: 1200, left: 1200, right: 1200 } } },
    headers: { default: pageHeader(ctx) },
    footers: { default: pageFooter() },
    children: [...masthead(ctx, kind), ...paragraphs],
  };
}

export async function renderProposalDocx(
  output: ProposalOutput,
  ctx: DocContext,
): Promise<Buffer> {
  const paragraphs: Paragraph[] = [];

  paragraphs.push(h2("Executive summary"));
  paragraphs.push(...output.executive_summary.split(/\n{2,}/).map((p) => body(p.trim())));

  const sourceQuality = sourceQualityLabel(output);
  if (sourceQuality) {
    paragraphs.push(h2("Source quality"));
    paragraphs.push(body(sourceQuality));
  }

  paragraphs.push(h2("Technical approach"));
  output.technical_approach.forEach((p) => paragraphs.push(body(p)));

  if (output.compliance_checklist.length > 0) {
    paragraphs.push(h2("Compliance checklist"));
    output.compliance_checklist.forEach((c) => {
      paragraphs.push(
        new Paragraph({
          spacing: { before: 120, after: 40 },
          children: [
            new TextRun({ text: c.requirement, font: BODY_FONT, bold: true, size: 22 }),
          ],
        }),
        new Paragraph({
          spacing: { after: 80 },
          children: [
            new TextRun({ text: statusLabel(c), font: BODY_FONT, size: 20, color: c.status === "compliant" ? "1F6A3C" : c.status === "partial" ? "B08530" : "B8463F", bold: true }),
            new TextRun({ text: "  ·  ", font: BODY_FONT, size: 20, color: "9A9A9A" }),
            new TextRun({ text: c.evidence_or_action, font: BODY_FONT, size: 20, color: "4A4A4A" }),
          ],
        }),
      );
    });
  }

  if (output.required_documents.length > 0) {
    paragraphs.push(h2("Required documents"));
    output.required_documents.forEach((d) => paragraphs.push(bullet(d)));
  }

  if (output.financial_template_notes.length > 0) {
    paragraphs.push(h2("Financial proposal — guidance"));
    paragraphs.push(body("See the accompanying Excel template (financial-template.xlsx) for the line-item structure. The notes below tell you what to expect when filling it in."));
    output.financial_template_notes.forEach((n) => paragraphs.push(bullet(n)));
  }

  if (output.missing_information.length > 0) {
    paragraphs.push(h2("Information still needed from you"));
    output.missing_information.forEach((m) => paragraphs.push(bullet(m)));
  }

  if (output.next_steps.length > 0) {
    paragraphs.push(h2("Next steps"));
    output.next_steps.forEach((s, i) => paragraphs.push(numbered(s, i + 1)));
  }

  const doc = new Document({
    creator: "TenderPath",
    title: `Technical Proposal — ${ctx.tenderTitle ?? ctx.companyName}`,
    description: "Technical proposal draft generated by TenderPath.",
    sections: [buildSection(ctx, paragraphs, "Technical proposal")],
  });

  return await Packer.toBuffer(doc);
}

export async function renderCoverLetterDocx(
  text: string,
  ctx: DocContext,
): Promise<Buffer> {
  const paragraphs: Paragraph[] = [];

  paragraphs.push(
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      spacing: { after: 360 },
      children: [
        new TextRun({ text: ctx.generatedAt, font: BODY_FONT, size: 22, color: "6B6B6B" }),
      ],
    }),
  );

  text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .forEach((p) => paragraphs.push(body(p)));

  const doc = new Document({
    creator: "TenderPath",
    title: `Cover letter — ${ctx.tenderTitle ?? ctx.companyName}`,
    description: "Cover letter draft generated by TenderPath.",
    sections: [buildSection(ctx, paragraphs, "Cover letter")],
  });

  return await Packer.toBuffer(doc);
}

export async function renderCapabilityStatementDocx(
  output: RosterOutput,
  ctx: DocContext,
  agencyLabel: string,
): Promise<Buffer> {
  const paragraphs: Paragraph[] = [];

  // Sprint 14. Lead with the agency_readiness_breakdown so the user
  // sees "where to start" before the agency-specific narrative. The
  // breakdown is what makes the bundle credible — if the dashboard
  // says UNGM is start_here but the downloaded DOCX only talks about
  // WFP, the package contradicts itself.
  const breakdown = output.agency_readiness_breakdown ?? [];
  if (breakdown.length > 0) {
    paragraphs.push(h2("Agency readiness — where to start"));
    paragraphs.push(body(`We scored ${ctx.companyName} against ${breakdown.length} UN procurement portals. The highest-readiness agency is shown first; alternates and blocked agencies follow.`));
    const startHere = breakdown.find((b) => b.recommendation === "start_here");
    const viable = breakdown.filter((b) => b.recommendation === "viable");
    const blocked = breakdown.filter((b) => b.recommendation === "blocked");
    if (startHere) renderAgencyBlock(paragraphs, startHere, "START HERE");
    if (viable.length > 0) {
      paragraphs.push(body(""));
      viable.forEach((b) => renderAgencyBlock(paragraphs, b, "VIABLE"));
    }
    if (blocked.length > 0) {
      paragraphs.push(body(""));
      paragraphs.push(body("Skip for now (capability or evidence does not match):"));
      blocked.forEach((b) => {
        paragraphs.push(bullet(`${b.agency_label} ${b.readiness_0_10}/10 — ${b.rationale}`));
      });
    }
  }

  paragraphs.push(h2(`Capability statement — ${agencyLabel}`));
  output.capability_statement_draft
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .forEach((p) => paragraphs.push(body(p)));

  if (output.organization_profile_notes.length > 0) {
    paragraphs.push(h2("Profile notes"));
    output.organization_profile_notes.forEach((n) => paragraphs.push(bullet(n)));
  }

  if (output.required_documents.length > 0) {
    paragraphs.push(h2("Required documents"));
    output.required_documents.forEach((d) => paragraphs.push(bullet(d)));
  }

  const doc = new Document({
    creator: "TenderPath",
    title: `Capability statement — ${agencyLabel} · ${ctx.companyName}`,
    description: "Capability statement generated by TenderPath.",
    sections: [buildSection(ctx, paragraphs, `Capability statement · ${agencyLabel}`)],
  });

  return await Packer.toBuffer(doc);
}
