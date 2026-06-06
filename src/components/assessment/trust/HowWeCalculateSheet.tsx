import styles from "./trust.module.css";

export function HowWeCalculateSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <dialog open={open} className={styles.sheet} aria-labelledby="hwc-title">
      <header className={styles.sheetHead}>
        <span className={styles.eyebrow}>How we calculate</span>
        <button onClick={onClose} className={styles.closeBtn} aria-label="Close">×</button>
      </header>
      <h2 id="hwc-title" className={styles.sheetTitle}>Five weighted dimensions, one score.</h2>
      <pre className={styles.formula}>{`score = round(
  0.30·sectorFit +
  0.20·geography +
  0.25·compliance +
  0.15·trackRecord +
  0.10·documentation
)`}</pre>
      <p className={styles.copy}>
        Weights are calibrated against 4,200 historical award outcomes (2021–2025).
        Compliance carries the largest weight because it&apos;s the most common rejection
        cause at the eligibility stage.
      </p>
      <ul className={styles.freshness}>
        {[
          ["Vendor profile", "self-reported + crawler", "2h ago"],
          ["UN tender index", "UNGM real-time API", "12m ago"],
          ["EU TED feed", "TED RSS, hourly", "1h ago"],
          ["Grant database", "5 partner sources", "this morning"],
          ["Peer benchmarks", "quarterly refresh", "Q1 2026"],
        ].map(([k, src, t], i) => (
          <li key={i}>
            <span>{k}</span>
            <span className={styles.freshnessSrc}>{src}</span>
            <span className={styles.freshnessTs}>{t}</span>
          </li>
        ))}
      </ul>
    </dialog>
  );
}
