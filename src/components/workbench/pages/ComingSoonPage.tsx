"use client";

/* Honest placeholder for the Workbench surfaces still being built in the next
 * pass (Browse search, Account & settings). Links to the working equivalent so
 * nothing dead-ends. */

import { useRouter } from "next/navigation";
import { C, F } from "../tokens";
import { Eyebrow, Btn, SectionHead } from "../ui";

export function ComingSoonPage({
  n,
  title,
  eyebrow,
  body,
  cta,
}: {
  n?: string;
  title: string;
  eyebrow: string;
  body: string;
  cta?: { label: string; href: string };
}) {
  const router = useRouter();
  return (
    <div>
      <SectionHead n={n} title={title} hint="In the next pass" />
      <div style={{ background: C.white, border: `1px solid ${C.rule}`, padding: "40px 32px", maxWidth: 640 }}>
        <Eyebrow color={C.accent}>{eyebrow}</Eyebrow>
        <p style={{ fontFamily: F.sans, fontSize: 15, lineHeight: 1.6, color: C.ink2, margin: "12px 0 0" }}>{body}</p>
        {cta && (
          <div style={{ marginTop: 22 }}>
            <Btn kind="primary" size="sm" onClick={() => router.push(cta.href)}>{cta.label} →</Btn>
          </div>
        )}
      </div>
    </div>
  );
}
