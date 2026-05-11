"use client";
import { useState } from "react";
import styles from "./firsttouch.module.css";

export function WebsitePasteForm({ onSubmit }: { onSubmit: (url: string) => void }) {
  const [url, setUrl] = useState("");
  return (
    <form
      className={styles.form}
      onSubmit={(e) => { e.preventDefault(); onSubmit(url); }}
    >
      <label htmlFor="ft-url" className={styles.label}>
        <span className={styles.eyebrow}>Step 1 of 1</span>
        <span className={styles.title}>What's your website?</span>
      </label>
      <div className={styles.inputRow}>
        <input
          id="ft-url"
          type="url"
          placeholder="acme.org"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className={styles.input}
          autoFocus
          required
        />
        <button type="submit" className={styles.submit}>Assess →</button>
      </div>
      <div className={styles.alternates}>
        <a href="/assessment/manual">No website yet</a>
        <a href="/assessment/ngo">I'm an NGO</a>
        <a href="/assessment/upload">Upload a brochure</a>
      </div>
      <p className={styles.privacy}>
        We crawl public pages only. Read‑only. Nothing stored without your account.
      </p>
    </form>
  );
}
