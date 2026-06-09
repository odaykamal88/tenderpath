"use client";
import { useState } from "react";
import styles from "./firsttouch.module.css";

export function NgoVariant({ onSubmit }: { onSubmit: (data: { url?: string; regNo: string; thesis: string }) => void }) {
  const [url, setUrl] = useState("");
  const [regNo, setRegNo] = useState("");
  const [thesis, setThesis] = useState("");
  return (
    <form
      className={styles.form}
      onSubmit={(e) => { e.preventDefault(); onSubmit({ url: url || undefined, regNo, thesis }); }}
    >
      <span className={styles.eyebrow}>NGO assessment · ~3 min</span>
      <h1 className={styles.title}>Tell us about your organisation.</h1>

      <label className={styles.label}>
        Website (optional)
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="acme.org" className={styles.input} />
      </label>
      <label className={styles.label}>
        NGO registration number
        <input required value={regNo} onChange={(e) => setRegNo(e.target.value)} placeholder="e.g. KE/INGO/2014/0148" className={styles.input} />
      </label>
      <label className={styles.label}>
        Thesis / mission (one sentence)
        <textarea required value={thesis} onChange={(e) => setThesis(e.target.value)} rows={3} placeholder="We deliver last-mile vaccines in arid Kenya." className={styles.textarea} />
      </label>
      <button type="submit" className={styles.submit}>Assess →</button>
      <p className={styles.privacy}>We don&apos;t share your registration number. Used only to verify donor-eligibility flags.</p>
    </form>
  );
}
