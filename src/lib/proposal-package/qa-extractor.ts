/**
 * qa-extractor.ts — parse classified Q&A markdown into typed entries.
 *
 * Each tender fixture carries either `qa-revisions.md` (UNOPS-style, captured
 * from a portal Revisions tab) or `qa-classifications.md` (UNICEF-style,
 * classifications laid over an official Q&A PDF). Both use the same per-entry
 * format inside an H2 section:
 *
 *   ## <entry header>
 *   classification: binding | informational | noise
 *   touches: <free text>
 *   supersedes: <optional entry id>
 *   content: |
 *     <Q&A body, indented 2 spaces>
 *
 * The rubric extractor consumes only `binding` entries; `informational` and
 * `noise` are dropped here so the LLM never sees them.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type QAClassification = "binding" | "informational" | "noise";

export interface QAEntry {
  entryId: string;
  classification: QAClassification;
  touches: string;
  content: string;
  supersedes?: string;
}

export async function extractQA(tenderDir: string): Promise<QAEntry[]> {
  for (const name of ["qa-classifications.md", "qa-revisions.md"]) {
    try {
      const content = await readFile(join(tenderDir, name), "utf8");
      return parseQAEntries(content);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error("[qa-extractor:read:failed]", {
          name,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
  return [];
}

export function filterBinding(entries: QAEntry[]): QAEntry[] {
  return entries.filter((e) => e.classification === "binding");
}

function parseQAEntries(markdown: string): QAEntry[] {
  const entries: QAEntry[] = [];
  // Split on H2 headers; skip the front-matter chunk before the first H2.
  const sections = markdown.split(/^##\s+/m).slice(1);

  for (const section of sections) {
    const lines = section.split("\n");
    const headerLine = lines[0] ?? "";
    // Header forms: "1 — Technical" or "Entry — 2026-04-14 09:47  (clarification)"
    const entryId = headerLine.split(/\s+\(/)[0].trim();

    let classification: QAClassification | null = null;
    let touches = "";
    let supersedes: string | undefined;
    const contentLines: string[] = [];
    let inContentBlock = false;

    for (let i = 1; i < lines.length; i += 1) {
      const line = lines[i];
      const trimmed = line.trim();

      if (!inContentBlock) {
        const classMatch = trimmed.match(/^classification:\s*(binding|informational|noise)\b/);
        if (classMatch) {
          classification = classMatch[1] as QAClassification;
          continue;
        }
        const touchesMatch = trimmed.match(/^touches:\s*(.*)$/);
        if (touchesMatch) {
          touches = touchesMatch[1].trim();
          continue;
        }
        const supersedesMatch = trimmed.match(/^supersedes:\s*(\S+)/);
        if (supersedesMatch) {
          supersedes = supersedesMatch[1];
          continue;
        }
        if (trimmed.startsWith("content:")) {
          inContentBlock = true;
          continue;
        }
        // Skip blank lines and other front-matter
        continue;
      }

      // We're inside a content block. Stop at the next "---" boundary.
      if (trimmed.startsWith("---")) break;
      // Strip the YAML literal-block indent (2 spaces).
      contentLines.push(line.replace(/^ {2}/, ""));
    }

    if (classification && entryId) {
      entries.push({
        entryId,
        classification,
        touches,
        content: contentLines.join("\n").trim(),
        supersedes,
      });
    }
  }

  return entries;
}
