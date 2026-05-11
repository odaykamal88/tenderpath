import styles from "./trust.module.css";

export type Citation = {
  source: string;
  url: string;
  extractedAt: string;
  excerpt?: string;
};

export function EvidenceCitation({ cite }: { cite: Citation }) {
  return (
    <a
      href={cite.url}
      target="_blank"
      rel="noopener"
      className={styles.cite}
      aria-label={`Source: ${cite.source}, extracted ${cite.extractedAt}`}
    >
      <span className={styles.citeMark}>cite</span>
      <span className={styles.citeSource}>{cite.source}</span>
      <span className={styles.citeDate}>{cite.extractedAt}</span>
    </a>
  );
}
