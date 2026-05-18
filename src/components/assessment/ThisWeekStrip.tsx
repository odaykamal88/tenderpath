import dashStyles from "./dashboard.module.css";
import { safeUrl, withUtm } from "@/lib/url";

export type ThisWeekRow = { kind: string; title: string; due: string; url?: string | null };

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
                <span className={dashStyles.weekDue}>{row.due} ↗</span>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
