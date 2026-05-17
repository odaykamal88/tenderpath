/**
 * CLI driver — Sprint 13a output-quality grader.
 *
 * Takes a stored proposal generation JSON (the {requirements, output}
 * pair our live-prompt drivers persist to outputs/paid-services-validation/)
 * and produces a graded JSON at outputs/paid-services-validation/grades/<panel_id>.json
 * that the harness can pick up.
 *
 * Usage:
 *   npx tsx scripts/_grade-proposal.ts \
 *     --input outputs/paid-services-validation/sprint11-full-cim.json \
 *     --panel-id VP-04 \
 *     [--tender-text /tmp/eu-cim-guidelines.txt] \
 *     [--company-context "<inline string>"] \
 *     [--force]
 *
 * If a grade file already exists at the destination and --force is not
 * passed, the existing grade is reused.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { gradeProposalOutput, type ProposalGrade } from "../src/lib/proposal-package/grade";
import type { ProposalOutput, TenderRequirements } from "../src/lib/proposal-package/types";

function loadEnv(envPath: string) {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const i = line.indexOf("=");
    if (i <= 0 || line.trim().startsWith("#")) continue;
    const k = line.slice(0, i).trim();
    if (process.env[k]) continue;
    process.env[k] = line.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
  }
}
loadEnv("/Users/odaykamal/Desktop/TENDERPATH/.env.local");
loadEnv(".env.local");

function arg(flag: string): string | null {
  const raw = process.argv.slice(2);
  const equals = raw.find((a) => a.startsWith(`${flag}=`));
  if (equals) return equals.slice(flag.length + 1);
  const idx = raw.indexOf(flag);
  if (idx >= 0 && raw[idx + 1] && !raw[idx + 1].startsWith("--")) return raw[idx + 1];
  return null;
}

const inputPath = arg("--input");
const panelId = arg("--panel-id");
const tenderTextPath = arg("--tender-text");
const companyContextArg = arg("--company-context");
const force = process.argv.includes("--force");

if (!inputPath || !panelId) {
  console.error("Usage: npx tsx scripts/_grade-proposal.ts --input <path.json> --panel-id <VP-XX> [--tender-text <path>] [--company-context <str>] [--force]");
  process.exit(1);
}

const outDir = "outputs/paid-services-validation/grades";
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, `${panelId}.json`);
if (fs.existsSync(outPath) && !force) {
  const existing = JSON.parse(fs.readFileSync(outPath, "utf-8")) as { grade: ProposalGrade };
  console.log(`Reusing existing grade for ${panelId}: score_0_10=${existing.grade.score_0_10}`);
  console.log(`  Pass --force to re-run.`);
  process.exit(0);
}

const payload = JSON.parse(fs.readFileSync(inputPath, "utf-8")) as {
  requirements: TenderRequirements;
  output: ProposalOutput;
};
if (!payload.requirements || !payload.output) {
  console.error(`Input ${inputPath} must contain {requirements, output} keys.`);
  process.exit(1);
}

const tenderTextExcerpt = tenderTextPath && fs.existsSync(tenderTextPath)
  ? fs.readFileSync(tenderTextPath, "utf-8").slice(0, 6000)
  : "";
const companyContext = companyContextArg
  ?? `Company profile excerpt not supplied — grader will rely on requirements + output JSON for specificity scoring.`;

(async () => {
  console.log(`Grading ${panelId} from ${inputPath} ...`);
  const t0 = Date.now();
  const grade = await gradeProposalOutput({
    output: payload.output,
    requirements: payload.requirements,
    companyContext,
    tenderTextExcerpt,
  });
  console.log(`  done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  fs.writeFileSync(outPath, JSON.stringify({ panel_id: panelId, source: inputPath, grade }, null, 2));
  console.log(`Wrote: ${outPath}`);
  console.log(`Grade: ${grade.score_0_10}/10`);
  console.log(`  breakdown: specificity=${grade.breakdown.specificity} evidence=${grade.breakdown.evidence_anchoring} complete=${grade.breakdown.completeness} consistent=${grade.breakdown.internal_consistency} usable=${grade.breakdown.submission_usability}`);
  for (const r of grade.rationale) console.log(`  - ${r}`);
})().catch((err) => {
  console.error("FAILED:", err);
  process.exitCode = 1;
});
