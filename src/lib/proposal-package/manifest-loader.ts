/**
 * manifest-loader.ts — load a tender fixture into an IngestedDoc[] set.
 *
 * Reads `tests/fixtures/un-tenders/<tender>/manifest.json` (machine-readable
 * tender metadata), walks the per-notice subdirectories, runs extraction via
 * document-ingest.ts, infers document role from filename, and applies
 * filename-based supersession across notices.
 *
 * Public API:
 *   loadTender(tenderDir) -> LoadedTender { manifest, docs, qaEntries }
 *
 * Filename-collision handling: when the same filename appears in two notice
 * subdirs (e.g. UNICEF's "Annex C ... revised.docx" in both 135638 and
 * 146988), the newer notice's version supersedes the older — but ONLY when
 * the contentHashes differ. Identical hash = identical content = no
 * supersession. This is the DocManifestEntry.contentHash test case.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type {
  DocManifestEntry,
  IngestedDoc,
  Methodology,
} from "./scoring-engine";
import { ingestDocument } from "./document-ingest";
import { extractQA, type QAEntry } from "./qa-extractor";

export interface TenderManifest {
  tenderId: string;
  title: string;
  agency: string;
  lane: "procurement" | "grant";
  methodology: Methodology;
  lotMetadata: Array<{ lotId: string; label: string; scope?: string }>;
  notices: Array<{
    noticeId: string;
    subdir: string;
    published?: string;
    role?: "base" | "amendment";
  }>;
}

export interface LoadedTender {
  manifest: TenderManifest;
  docs: IngestedDoc[];
  qaEntries: QAEntry[];
}

export interface LoadTenderOptions {
  /**
   * Sprint 3: if set, only notices whose noticeId appears in this list are
   * loaded. Used to reconstruct a "pre-amendment" view of a tender for
   * rubric-diff acceptance: the same tenderDir produces a smaller doc set
   * when notice-146988 (the amendment) is excluded. Supersession still
   * applies within the filtered set.
   *
   * When omitted (the default), all notices in the manifest are loaded.
   */
  noticeFilter?: string[];
}

export async function loadTender(
  tenderDir: string,
  options: LoadTenderOptions = {},
): Promise<LoadedTender> {
  const manifestPath = join(tenderDir, "manifest.json");
  const raw = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(raw) as TenderManifest;

  const filter = options.noticeFilter
    ? new Set(options.noticeFilter)
    : null;

  const allDocs: IngestedDoc[] = [];

  for (const notice of manifest.notices) {
    if (filter && !filter.has(notice.noticeId)) continue;
    const noticeDir = join(tenderDir, notice.subdir);
    let entries: string[] = [];
    try {
      entries = await readdir(noticeDir);
    } catch (err) {
      console.error("[manifest-loader:readdir:failed]", {
        noticeDir,
        err: errMsg(err),
      });
      continue;
    }

    for (const entry of entries) {
      const filepath = join(noticeDir, entry);
      let s;
      try {
        s = await stat(filepath);
      } catch (err) {
        console.warn("[manifest-loader:stat:failed]", { filepath, err: errMsg(err) });
        continue;
      }
      if (!s.isFile()) continue;

      try {
        const extracted = await ingestDocument(filepath);
        if (extracted.format === "unknown") {
          console.warn("[manifest-loader:format:unknown]", { filepath });
          continue;
        }
        if (
          extracted.extraction.status === "failed" ||
          extracted.extraction.status === "unsupported"
        ) {
          console.warn("[manifest-loader:extract:non_ok]", {
            filepath,
            status: extracted.extraction.status,
            error: extracted.extraction.error,
          });
          continue;
        }

        const role = inferRole(entry, notice.role);
        const docId = `${notice.noticeId}/${entry}`;
        const manifestEntry: DocManifestEntry = {
          docId,
          filename: entry,
          contentHash: extracted.contentHash,
          role,
        };

        allDocs.push({
          manifest: manifestEntry,
          text: extracted.extraction.text,
        });
      } catch (err) {
        console.error("[manifest-loader:ingest:failed]", {
          filepath,
          err: errMsg(err),
        });
      }
    }
  }

  applySupersession(allDocs);

  const qaEntries = await extractQA(tenderDir);

  return { manifest, docs: allDocs, qaEntries };
}

function inferRole(
  filename: string,
  noticeRole?: "base" | "amendment",
): DocManifestEntry["role"] {
  const lower = filename.toLowerCase();
  if (lower.includes("amendment")) return "amendment";
  if (
    lower.includes("q & a") ||
    lower.includes("q&a") ||
    lower.includes("q-and-a") ||
    /\bqa\.(pdf|docx)$/.test(lower)
  ) {
    return "qa";
  }
  if (
    lower.includes("bid conference") ||
    lower.includes("webinar") ||
    lower.includes("prebid") ||
    lower.includes("pre-bid") ||
    lower.includes("pre bid")
  ) {
    return "info_session";
  }
  if (
    lower.includes("general_conditions") ||
    lower.includes("general conditions") ||
    /rfq[_ ]section\s*1/.test(lower)
  ) {
    return "guidelines";
  }
  if (
    lower.includes("schedule of requirements") ||
    /\bannex c\b/.test(lower) ||
    /\btor\b/.test(lower)
  ) {
    return "tor";
  }
  if (
    lower.includes("additional tech") ||
    /\bannex [de]\b/.test(lower) ||
    lower.includes("price quotation") ||
    lower.includes("po templet") ||
    lower.includes("submission form")
  ) {
    return "annex";
  }
  if (/rfps[\s_]\d/.test(lower) || lower.startsWith("rfp")) return "solicitation";

  // Fall back to noticeRole hint
  if (noticeRole === "amendment") return "amendment";
  if (noticeRole === "base") return "solicitation";
  return "supporting";
}

function applySupersession(docs: IngestedDoc[]): void {
  const byName = new Map<string, IngestedDoc[]>();
  for (const doc of docs) {
    const name = doc.manifest.filename;
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name)!.push(doc);
  }

  for (const [, group] of byName) {
    if (group.length < 2) continue;
    // Sort by docId; the notice-prefix encodes recency (higher noticeId is newer
    // in the UN portal's monotonic-counter convention).
    group.sort((a, b) => a.manifest.docId.localeCompare(b.manifest.docId));
    const newest = group[group.length - 1];
    for (let i = 0; i < group.length - 1; i += 1) {
      const older = group[i];
      // Same hash = same content = NOT a real supersession (just a dupe across notices).
      if (older.manifest.contentHash === newest.manifest.contentHash) continue;
      newest.manifest.supersedes = newest.manifest.supersedes ?? [];
      if (!newest.manifest.supersedes.includes(older.manifest.docId)) {
        newest.manifest.supersedes.push(older.manifest.docId);
      }
    }
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
