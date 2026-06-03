"use client";

import { useMemo, useState } from "react";
import styles from "../admin.module.css";
import { parseProspects, type ImportPayload } from "@/lib/network/importMap";

function authHeaders(): HeadersInit {
  const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
  return token ? { authorization: `Bearer ${token}` } : {};
}
function jsonHeaders(): HeadersInit {
  return { ...authHeaders(), "content-type": "application/json" };
}

interface Props {
  existingNames: string[];
  onClose: () => void;
  onImported: () => void;
}

interface Progress { done: number; ok: number; failed: number; total: number }

export default function ImportPanel({ existingNames, onClose, onImported }: Props) {
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<{ rows: ImportPayload[]; total: number; skippedNoName: number } | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress>({ done: 0, ok: 0, failed: 0, total: 0 });
  const [log, setLog] = useState<string[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);

  const existing = useMemo(
    () => new Set(existingNames.map((n) => n.trim().toLowerCase())),
    [existingNames],
  );
  const toImport = useMemo(
    () => (parsed?.rows ?? []).filter((r) => !existing.has(r.name.trim().toLowerCase())),
    [parsed, existing],
  );
  const dupes = (parsed?.rows.length ?? 0) - toImport.length;

  function doParse(t: string) {
    setAttempts((n) => n + 1);
    try {
      const result = parseProspects(t);
      setParsed(result);
      setParseError(null);
      setLog([]);
      setProgress({ done: 0, ok: 0, failed: 0, total: 0 });
    } catch (err) {
      setParsed(null);
      setParseError(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
      // eslint-disable-next-line no-console
      console.error("[network:import:parse_failed]", err);
    }
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const t = String(reader.result || "");
      setText(t);
      doParse(t);
    };
    reader.readAsText(f);
  }

  async function run() {
    if (!toImport.length) return;
    setRunning(true);
    setProgress({ done: 0, ok: 0, failed: 0, total: toImport.length });
    const newLog: string[] = [];
    let ok = 0;
    let failed = 0;
    // Sequential on purpose: each create crawls a site + runs AI, so we avoid
    // hammering targets / rate limits. Reuses the existing per-company endpoint.
    for (let i = 0; i < toImport.length; i++) {
      const row = toImport[i];
      try {
        const res = await fetch("/api/admin/network-companies", {
          method: "POST",
          headers: jsonHeaders(),
          body: JSON.stringify(row),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          failed++;
          newLog.unshift(`✗ ${row.name}: ${body.error ?? `${res.status}`}`);
        } else {
          ok++;
          const ps = body.profile?.status;
          const m = body.match?.newMatches ?? 0;
          newLog.unshift(ps === "ready" ? `✓ ${row.name} — ${m} match${m === 1 ? "" : "es"}` : `⚠ ${row.name} — profile ${ps ?? "failed"}`);
        }
      } catch (err) {
        failed++;
        newLog.unshift(`✗ ${row.name}: ${err instanceof Error ? err.message : "error"}`);
      }
      setProgress({ done: i + 1, ok, failed, total: toImport.length });
      setLog([...newLog]);
    }
    setRunning(false);
    onImported();
  }

  return (
    <section className={styles.panel}>
      <header className={styles.panelHead}>
        <div>
          <h2 className={styles.panelTitle}>Import prospects (CSV)</h2>
          <p className={styles.panelSub}>
            Paste or upload a CSV with headers like <code>Company Name, Website URL, Country, Sector, Contact Name, Contact Email, Contact LinkedIn, Notes</code>.
            Each row is crawled + profiled + matched. Already-loaded company names are skipped.
          </p>
        </div>
        <button type="button" className={styles.btnGhost} onClick={onClose} disabled={running} style={{ padding: "5px 10px", fontSize: 12 }}>Close</button>
      </header>

      <div style={{ display: "grid", gap: 10, padding: "12px 22px 18px" }}>
        <input type="file" accept=".csv,text/csv" onChange={onFile} disabled={running} style={{ fontSize: 12 }} />
        <textarea
          className={styles.adminSearchInput}
          placeholder="…or paste CSV here"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => text.trim() && doParse(text)}
          rows={4}
          disabled={running}
          style={{ width: "100%", padding: 8, fontFamily: "monospace", fontSize: 11 }}
        />

        {parseError && (
          <div className={styles.sessionSubtle} style={{ color: "#d04545", fontWeight: 600 }}>
            Parse error — {parseError}
          </div>
        )}

        {parsed && parsed.rows.length === 0 ? (
          <div className={styles.sessionSubtle} style={{ color: "var(--color-warn, #c8973e)" }}>
            Couldn&apos;t read any companies. Make sure the first row has column headers including <strong>Company Name</strong>.
            Pasting cells straight from Google Sheets (tab-separated) now works — or use the file picker above with <code>wave1_personal_37.csv</code>.
          </div>
        ) : parsed ? (
          <div className={styles.sessionSubtle}>
            Parsed <strong>{parsed.rows.length}</strong> companies
            {parsed.skippedNoName > 0 && <> · {parsed.skippedNoName} skipped (no name)</>}
            {dupes > 0 && <> · {dupes} already in your list (will skip)</>}
            {" · "}<strong>{toImport.length}</strong> new to import
          </div>
        ) : null}

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" className={styles.btnGhost} onClick={() => doParse(text)} disabled={running || !text.trim()} style={{ padding: "6px 12px", fontSize: 12 }}>
            Parse
          </button>
          <button type="button" className={styles.btnPrimary} onClick={run} disabled={running || toImport.length === 0} style={{ padding: "6px 12px", fontSize: 12 }}>
            {running ? `Importing ${progress.done}/${progress.total}…` : `Import ${toImport.length} companies`}
          </button>
          {running && <span className={styles.sessionSubtle}>Each company is crawled + matched — this can take a few minutes. Keep this tab open.</span>}
          {!running && progress.total > 0 && (
            <span className={styles.sessionSubtle}>Done — {progress.ok} added, {progress.failed} failed.</span>
          )}
          {attempts > 0 && <span className={styles.sessionSubtle}>checked {attempts}×</span>}
        </div>

        {log.length > 0 && (
          <div className={styles.tableWrap} style={{ maxHeight: 220, overflow: "auto", padding: "6px 10px" }}>
            {log.map((line, i) => (
              <div key={i} className={styles.sessionSubtle} style={{ fontFamily: "monospace", fontSize: 11 }}>{line}</div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
