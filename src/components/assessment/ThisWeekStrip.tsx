import dashStyles from "./dashboard.module.css";
import { safeUrl, withUtm } from "@/lib/url";

export type ThisWeekRow = { kind: string; title: string; due: string; url?: string | null; fit: number };

// Format a raw deadline string as DD/MM/YY. Returns "TBA" verbatim and falls
// through to the raw value when the date is unparseable, so a malformed source
// deadline degrades into something legible rather than "NaN/NaN/NaN".
function shortDeadline(due: string): string {
  if (due === "TBA") return "TBA";
  const d = new Date(due);
  if (Number.isNaN(d.getTime())) return due;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}/${mm}/${yy}`;
}

export function ThisWeekStrip({ rows }: { rows: ThisWeekRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section className={dashStyles.thisWeek} aria-label="This week">
      <span className={dashStyles.eyebrow}>This week</span>
      <ul className={dashStyles.weekList}>
        {rows.map((row, i) => {
          const cleanUrl = safeUrl(row.url);
          const externalUrl = cleanUrl ? withUtm(cleanUrl, "this_week") : null;
          const href = externalUrl || `/pay?plan=grants-tenders-matching`;
          return (
            <li key={i} className={dashStyles.weekRow}>
              <a
                href={href}
                target={externalUrl ? "_blank" : undefined}
                rel={externalUrl ? "noopener noreferrer" : undefined}
                className={dashStyles.weekRowLink}
              >
                <span className={dashStyles.weekKind}>{row.kind}</span>
                <span className={dashStyles.weekTitle}>{row.title}</span>
                <span className={dashStyles.weekFit}>{row.fit || "—"}</span>
                <span className={dashStyles.weekDue}>{shortDeadline(row.due)} ↗</span>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
