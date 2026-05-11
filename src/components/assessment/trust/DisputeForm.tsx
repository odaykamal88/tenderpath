"use client";
import { useState } from "react";
import styles from "./trust.module.css";

export function DisputeForm({
  reportId,
  gapRef,
  onSubmitted,
}: {
  reportId: string;
  gapRef: string;
  onSubmitted: () => void;
}) {
  const [pending, setPending] = useState(false);
  return (
    <form
      className={styles.dispute}
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        const fd = new FormData(e.currentTarget);
        await fetch("/api/disputes", {
          method: "POST",
          body: JSON.stringify({
            reportId, gapRef,
            claim: fd.get("claim"),
            evidenceUrl: fd.get("evidenceUrl"),
          }),
        });
        setPending(false);
        onSubmitted();
      }}
    >
      <span className={styles.eyebrow}>Dispute · {gapRef}</span>
      <h3 className={styles.disputeTitle}>Submit evidence to update your score.</h3>
      <p className={styles.copy}>Disputes resolve within 2 business days. If upheld, your score recalculates and an updated PDF is issued.</p>
      <label className={styles.label}>
        Your claim
        <textarea name="claim" required rows={3} placeholder="We hold ISO 9001:2015, certificate # …" className={styles.textarea} />
      </label>
      <label className={styles.label}>
        Evidence URL or upload reference
        <input name="evidenceUrl" required placeholder="https://… or upload-ref" className={styles.input} />
      </label>
      <button type="submit" disabled={pending} className={styles.submit}>{pending ? "Submitting…" : "Submit dispute →"}</button>
      <p className={styles.privacy}>Report ID and gap reference auto-attached.</p>
    </form>
  );
}
