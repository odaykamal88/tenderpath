"use client";

import { useMemo, useRef, useState } from "react";
import styles from "../admin.module.css";
import {
  FIELD_DEFS,
  analyzeTable,
  buildRows,
  parseDelimited,
  type ColumnMapping,
  type FieldKey,
  type ImportRow,
} from "@/lib/network/importMap";

function authHeaders(): HeadersInit {
  const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
  return token ? { authorization: `Bearer ${token}` } : {};
}

interface Props {
  existingNames: string[];
  onClose: () => void;
  onImported: () => void;
}

interface Loaded {
  table: string[][];
  headerRowIndex: number;
  headers: string[];
  sheets: string[];
  sheet: string | null;
}

interface ImportResult {
  inserted: number;
  skipped: number;
  failed: number;
  skippedNames: string[];
  failedNames: string[];
}

const PREVIEW_LIMIT = 8;
// The columns shown in the preview, in a sensible reading order.
const PREVIEW_COLS: Array<{ key: keyof ImportRow; label: string }> = [
  { key: "name", label: "Company" },
  { key: "contact_name", label: "Contact" },
  { key: "contact_title", label: "Title" },
  { key: "contact_email", label: "Email" },
  { key: "countries", label: "Country" },
  { key: "sectors", label: "Sector" },
  { key: "un_buyer", label: "UN buyer" },
];

export default function ImportPanel({ existingNames, onClose, onImported }: Props) {
  const fileRef = useRef<File | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [headerRowIndex, setHeaderRowIndex] = useState(0);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pasteText, setPasteText] = useState("");

  const existing = useMemo(
    () => new Set(existingNames.map((n) => n.trim().toLowerCase())),
    [existingNames],
  );

  function ingest(analysis: { headerRowIndex: number; headers: string[] }, table: string[][], sheets: string[], sheet: string | null) {
    setLoaded({ table, headers: analysis.headers, headerRowIndex: analysis.headerRowIndex, sheets, sheet });
    setHeaderRowIndex(analysis.headerRowIndex);
    setMapping(analyzeTable(table).mapping);
    setResult(null);
    setParseError(null);
  }

  // XLSX is binary — parse it server-side (exceljs). Text formats parse locally.
  async function parseFile(file: File, sheet?: string) {
    setParsing(true);
    setParseError(null);
    try {
      const isText = /\.(csv|tsv|txt)$/i.test(file.name) || file.type.startsWith("text/");
      if (isText && !sheet) {
        const text = await file.text();
        const table = parseDelimited(text);
        ingest(analyzeTable(table), table, [], null);
      } else {
        const fd = new FormData();
        fd.append("file", file);
        const qs = sheet ? `?sheet=${encodeURIComponent(sheet)}` : "";
        const res = await fetch(`/api/admin/network-companies/parse${qs}`, { method: "POST", headers: authHeaders(), body: fd });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `${res.status}`);
        ingest({ headerRowIndex: body.headerRowIndex, headers: body.headers }, body.table, body.sheets ?? [], body.sheet ?? null);
      }
    } catch (err) {
      setLoaded(null);
      setParseError(err instanceof Error ? err.message : "Couldn't read that file.");
      console.error("[network:import:parse]", err);
    } finally {
      setParsing(false);
    }
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    fileRef.current = f;
    setPasteText("");
    parseFile(f);
  }

  function parsePaste() {
    if (!pasteText.trim()) return;
    fileRef.current = null;
    const table = parseDelimited(pasteText);
    ingest(analyzeTable(table), table, [], null);
  }

  function switchSheet(sheet: string) {
    if (fileRef.current) parseFile(fileRef.current, sheet);
  }

  // Header-row override re-runs auto-map against the newly chosen header row.
  function setHeaderRow(idx: number) {
    if (!loaded) return;
    const headers = (loaded.table[idx] ?? []).map((h) => (h ?? "").trim());
    setHeaderRowIndex(idx);
    setLoaded({ ...loaded, headers, headerRowIndex: idx });
    setMapping(analyzeTable([headers, ...loaded.table.slice(idx + 1)]).mapping);
  }

  function setField(key: FieldKey, col: number) {
    setMapping((m) => {
      const next = { ...m };
      if (col < 0) { delete next[key]; return next; }
      // A source column maps to at most one field — steal it from any other field.
      for (const k of Object.keys(next) as FieldKey[]) if (next[k] === col) delete next[k];
      next[key] = col;
      return next;
    });
  }

  const built = useMemo(
    () => (loaded ? buildRows(loaded.table, headerRowIndex, mapping) : null),
    [loaded, headerRowIndex, mapping],
  );

  // De-dupe against already-loaded companies AND within the file itself.
  const toImport = useMemo(() => {
    if (!built) return [];
    const seen = new Set(existing);
    const out: ImportRow[] = [];
    for (const r of built.rows) {
      const key = r.name.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(r);
    }
    return out;
  }, [built, existing]);

  const duplicateCount = (built?.rows.length ?? 0) - toImport.length;
  const companyMapped = mapping.name !== undefined;
  const headerRowOptions = useMemo(() => {
    if (!loaded) return [];
    const opts: Array<{ idx: number; label: string }> = [];
    for (let i = 0; i < Math.min(loaded.table.length, 12); i++) {
      const cells = (loaded.table[i] ?? []).filter((c) => (c ?? "").trim());
      if (cells.length === 0) continue;
      opts.push({ idx: i, label: `Row ${i + 1}: ${cells.slice(0, 4).join(" · ").slice(0, 60)}` });
    }
    return opts;
  }, [loaded]);

  async function run() {
    if (!toImport.length) return;
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/network-companies/bulk", {
        method: "POST",
        headers: { ...authHeaders(), "content-type": "application/json" },
        body: JSON.stringify({ rows: toImport }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `${res.status}`);
      setResult(body);
      onImported();
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setRunning(false);
    }
  }

  const columnOptions = (loaded?.headers ?? []).map((h, i) => ({
    value: i,
    label: h.trim() ? h.trim() : `Column ${i + 1}`,
  }));

  return (
    <section className={styles.panel}>
      <header className={styles.panelHead}>
        <div>
          <h2 className={styles.panelTitle}>Import contacts</h2>
          <p className={styles.panelSub}>
            Upload a <strong>.xlsx</strong>, <strong>.xls</strong> or <strong>.csv</strong> — or paste rows from a spreadsheet.
            We auto-map the columns; check the mapping, then import. Contacts land as CRM records instantly — then hit
            <strong> Build &amp; match pending</strong> on the list to profile them and score against live tenders.
          </p>
        </div>
        <button type="button" className={styles.btnGhost} onClick={onClose} disabled={running} style={{ padding: "5px 10px", fontSize: 12 }}>Close</button>
      </header>

      <div style={{ display: "grid", gap: 14, padding: "12px 22px 20px" }}>
        {/* Step 1 — source */}
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <input
              type="file"
              accept=".xlsx,.xls,.csv,.tsv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              onChange={onFile}
              disabled={running || parsing}
              aria-label="Choose a spreadsheet or CSV file to import"
              style={{ fontSize: 12 }}
            />
            {parsing && <span className={styles.sessionSubtle}>Reading file…</span>}
            {loaded && loaded.sheets.length > 1 && (
              <label className={styles.sessionSubtle} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                Sheet
                <select
                  className={styles.adminSearchInput}
                  value={loaded.sheet ?? ""}
                  onChange={(e) => switchSheet(e.target.value)}
                  disabled={running || parsing}
                  style={{ padding: "4px 8px", fontSize: 12 }}
                >
                  {loaded.sheets.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
            )}
          </div>
          {!loaded && (
            <details>
              <summary className={styles.sessionSubtle} style={{ cursor: "pointer", fontSize: 12 }}>…or paste rows (tab- or comma-separated)</summary>
              <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                <textarea
                  className={styles.adminSearchInput}
                  placeholder="Paste straight from Google Sheets / Excel — include the header row"
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  aria-label="Paste spreadsheet rows"
                  rows={4}
                  disabled={running}
                  style={{ width: "100%", padding: 8, fontFamily: "monospace", fontSize: 11 }}
                />
                <div>
                  <button type="button" className={styles.btnGhost} onClick={parsePaste} disabled={!pasteText.trim() || parsing || running} style={{ padding: "5px 11px", fontSize: 12 }}>Read pasted rows</button>
                </div>
              </div>
            </details>
          )}
        </div>

        {parseError && (
          <div className={styles.sessionSubtle} style={{ color: "var(--color-red, #d04545)", fontWeight: 600 }}>
            {parseError}
          </div>
        )}

        {loaded && (
          <>
            {/* Step 2 — mapping */}
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
                <strong style={{ fontSize: 13 }}>Match columns</strong>
                {headerRowOptions.length > 1 && (
                  <label className={styles.sessionSubtle} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                    Header row
                    <select
                      className={styles.adminSearchInput}
                      value={headerRowIndex}
                      onChange={(e) => setHeaderRow(Number(e.target.value))}
                      disabled={running}
                      style={{ padding: "4px 8px", fontSize: 12, maxWidth: 320 }}
                    >
                      {headerRowOptions.map((o) => <option key={o.idx} value={o.idx}>{o.label}</option>)}
                    </select>
                  </label>
                )}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
                {FIELD_DEFS.map((def) => {
                  const val = mapping[def.key];
                  const missingRequired = def.required && val === undefined;
                  return (
                    <label key={def.key} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      <span className={styles.sessionSubtle} style={{ fontSize: 11 }}>
                        {def.label}{def.required && <span style={{ color: "var(--color-red, #d04545)" }}> *</span>}
                      </span>
                      <select
                        className={styles.adminSearchInput}
                        value={val ?? -1}
                        onChange={(e) => setField(def.key, Number(e.target.value))}
                        disabled={running}
                        style={{ padding: "5px 7px", fontSize: 12, borderColor: missingRequired ? "var(--color-red, #d04545)" : undefined }}
                      >
                        <option value={-1}>— not mapped —</option>
                        {columnOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </label>
                  );
                })}
              </div>
              {!companyMapped && (
                <div className={styles.sessionSubtle} style={{ color: "var(--color-red, #d04545)", fontWeight: 600 }}>
                  Map the <strong>Company</strong> column — it&rsquo;s required. (Tip: your sheet&rsquo;s <em>Name</em> column is the person; <em>Company</em> is the organisation.)
                </div>
              )}
            </div>

            {/* Step 3 — preview + counts */}
            {built && companyMapped && (
              <div style={{ display: "grid", gap: 8 }}>
                <div className={styles.sessionSubtle}>
                  Parsed <strong>{built.total}</strong> rows
                  {built.skippedNoName > 0 && <> · {built.skippedNoName} skipped (no company)</>}
                  {duplicateCount > 0 && <> · {duplicateCount} already loaded / duplicate</>}
                  {" · "}<strong style={{ color: "var(--color-accent)" }}>{toImport.length}</strong> new to import
                </div>
                {toImport.length > 0 && (
                  <div className={styles.tableWrap} style={{ maxHeight: 280, overflow: "auto" }}>
                    <table className={styles.dossierTable}>
                      <thead>
                        <tr>{PREVIEW_COLS.map((c) => <th key={c.key}>{c.label}</th>)}</tr>
                      </thead>
                      <tbody>
                        {toImport.slice(0, PREVIEW_LIMIT).map((r, i) => (
                          <tr key={i}>
                            {PREVIEW_COLS.map((c) => (
                              <td key={c.key} className={c.key === "name" ? styles.cellName : styles.sessionSubtle} style={{ fontSize: 12 }}>
                                {String(r[c.key] ?? "").trim() || "—"}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {toImport.length > PREVIEW_LIMIT && (
                      <div className={styles.sessionSubtle} style={{ padding: "6px 10px", fontSize: 11 }}>
                        + {toImport.length - PREVIEW_LIMIT} more…
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Step 4 — import */}
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button
                type="button"
                className={styles.btnPrimary}
                onClick={run}
                disabled={running || !companyMapped || toImport.length === 0}
                style={{ padding: "7px 14px" }}
              >
                {running ? "Importing…" : `Import ${toImport.length} contact${toImport.length === 1 ? "" : "s"}`}
              </button>
              {result && (
                <span className={styles.sessionSubtle}>
                  Done — <strong style={{ color: "var(--color-green, #3a9e5c)" }}>{result.inserted} added</strong>
                  {result.skipped > 0 && <> · {result.skipped} skipped</>}
                  {result.failed > 0 && <> · <span style={{ color: "var(--color-red, #d04545)" }}>{result.failed} failed</span></>}
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
