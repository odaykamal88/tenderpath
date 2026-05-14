"use client";
import { useState } from "react";
import Link from "next/link";
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
        <span className={styles.title}>What&rsquo;s your website?</span>
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
        <Link href="/assessment/manual">No website yet</Link>
        <Link href="/assessment/ngo">I&rsquo;m an NGO</Link>
        <Link href="/assessment">Use public/self-reported details</Link>
      </div>
      <p className={styles.privacy}>
        We crawl public pages only. Read‑only. Nothing stored without your account.
      </p>
    </form>
  );
}
