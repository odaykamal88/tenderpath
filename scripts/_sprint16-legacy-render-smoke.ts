/**
 * Sprint 16 backwards-compat smoke test. Builds a "legacy" RosterOutput
 * (no agency_readiness_breakdown, no docs renaming hint) and pushes it
 * through both renderers to confirm the post-Sprint-14 code path
 * degrades cleanly to the pre-Sprint-14 layout.
 */
import * as fs from "node:fs";
import { renderCapabilityStatementDocx } from "../src/lib/proposal-package/docx";
import { renderSubmissionInstructionsPdf } from "../src/lib/proposal-package/pdfDocs";
import { findAgencyPackage } from "../src/lib/proposal-package/roster-packages";
import type { RosterOutput } from "../src/lib/proposal-package/types";

const legacyOutput: RosterOutput = {
  registration_checklist: [
    "Step 1: Create your UNGM account.",
    "Step 2: Complete the company-profile sections.",
    "Step 3: Submit for verification.",
  ],
  capability_statement_draft: "Legacy capability statement for ACME Corp. We deliver food-safety advisory services across MENA.",
  required_documents: ["Company profile.pdf", "Audited financials.pdf"],
  organization_profile_notes: ["Use English as primary language.", "Include UNSPSC codes."],
  cover_letter_draft: "Dear UNGM,\n\nWe wish to register as a vendor.\n\nKind regards,\nACME Corp",
  submission_guidance: ["File-size limit 5 MB.", "Use exact legal name throughout."],
  document_renaming_rules: [],
  missing_information: ["Tax registration certificate not on file."],
  next_steps: ["Obtain tax certificate within 2 weeks."],
  // Intentionally NO agency_readiness_breakdown — simulates a pre-Sprint-14 row.
};

(async () => {
  console.log("=== Sprint 16 legacy-render compat smoke test ===");
  const wfp = findAgencyPackage("wfp");
  if (!wfp) throw new Error("WFP not in catalogue");
  const ctx = {
    companyName: "ACME Corp",
    tenderTitle: "WFP roster registration",
    agency: "WFP",
    generatedAt: "17 May 2026",
  };

  console.log("rendering DOCX (legacy, no breakdown)...");
  const docx = await renderCapabilityStatementDocx(legacyOutput, ctx, "WFP");
  fs.writeFileSync("/tmp/sprint16-legacy-capability.docx", docx);
  console.log(`  ${docx.byteLength} bytes`);

  console.log("rendering PDF (legacy, no breakdown)...");
  const pdf = await renderSubmissionInstructionsPdf(legacyOutput, ctx, 8888, wfp);
  fs.writeFileSync("/tmp/sprint16-legacy-submission.pdf", pdf);
  console.log(`  ${pdf.byteLength} bytes`);

  // Verify DOCX doesn't contain "Agency readiness" header (would mean
  // the renderer leaked a breakdown section when none should exist)
  const { execSync } = await import("node:child_process");
  try {
    const text = execSync(`python3 -c "import zipfile, re; z=zipfile.ZipFile('/tmp/sprint16-legacy-capability.docx'); xml=z.read('word/document.xml').decode('utf-8'); print('\\n'.join(re.findall(r'<w:t[^>]*>([^<]+)</w:t>', xml)))"`).toString();
    const hasLeak = /Agency readiness/i.test(text);
    console.log(`  DOCX contains "Agency readiness" header: ${hasLeak ? "YES (regression)" : "no (clean)"}`);
    if (hasLeak) process.exitCode = 1;
  } catch (err) {
    console.warn(`  could not introspect DOCX text: ${err}`);
  }

  console.log("done.");
})().catch((err) => {
  console.error("FAILED:", err);
  process.exitCode = 1;
});
