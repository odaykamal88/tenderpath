/* Submissions is paused during the invite-only beta — pricing/payment surfaces
 * are hidden, so the paid done-for-you drafting workflow isn't offered for now.
 * The full SubmissionsPage component still lives in the repo; restore it here
 * (and re-add the nav item in Shell.tsx) when COMMERCE_ENABLED is flipped on. */

const MONO = "var(--font-jetbrains), ui-monospace, monospace";
const SERIF = "var(--font-fraunces), Georgia, serif";
const SANS = "var(--font-inter), system-ui, sans-serif";

export default function Page() {
  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: "#9c6b1f" }}>
        Submissions
      </div>
      <h1 style={{ fontFamily: SERIF, fontSize: 26, fontWeight: 400, color: "#0f1620", margin: "8px 0 0", letterSpacing: "-0.01em" }}>
        Done-for-you drafting opens soon.
      </h1>
      <p style={{ fontFamily: SANS, fontSize: 14, lineHeight: 1.6, color: "#2b3543", marginTop: 12 }}>
        EOI, RFQ, ITB and RFP drafting is being finalised for the invite-only beta. In the meantime, paste any
        tender from your dashboard for an instant bid/no-bid verdict, and close your readiness gaps with the
        Navigator — we&apos;ll let you know the moment drafting is available.
      </p>
      <a
        href="/dashboard"
        style={{ display: "inline-block", marginTop: 18, fontFamily: MONO, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "#0f1620", borderBottom: "1px solid #0f1620", textDecoration: "none", paddingBottom: 3 }}
      >
        ← Back to overview
      </a>
    </div>
  );
}
