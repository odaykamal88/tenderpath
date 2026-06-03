"use client";

/**
 * SignupSheet — in-context sign-up that arrives OVER the assessment reveal.
 *
 * Borrowed from the esdaar review's "convenient sign-up" idea, rebuilt faithful
 * to TenderPath's existing value-first, no-password model. The point is the
 * *way it arrives*: instead of navigating away to /login (which loses the score
 * the user just earned), this overlays the report — the value stays on screen
 * behind a dimmed backdrop.
 *
 * It reuses the live auth contracts verbatim (shared-contract discipline):
 *   - magic link  → POST /api/auth/signup  { email }      (passwordless)
 *   - Google      → GET  /api/auth/google?next=...         (real branded mark)
 * No new password path is introduced.
 *
 * Desktop: centred sheet. Mobile: bottom sheet. Honours prefers-reduced-motion
 * (no transform animation). Rendered only while open, so each open is fresh —
 * no reset effect needed.
 */

import { useEffect, useRef, useState } from "react";

// Module-scope, client-only (this is a "use client" component and the sheet
// only mounts on user interaction, well after hydration). Mirrors the pattern
// used by the rollout prototypes and the login page.
const prefersReduced =
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function SignupSheet({
  open,
  onClose,
  defaultEmail = "",
  next = "/dashboard",
}: {
  open: boolean;
  onClose: () => void;
  defaultEmail?: string;
  next?: string;
}) {
  const [email, setEmail] = useState(defaultEmail);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  // Esc-to-close + body scroll lock while open. Pure external-system sync
  // (listeners + body style) — no setState in the effect.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    emailRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    if (!email.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }
    setBusy(true);
    setError(null);
    let res: Response;
    try {
      res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
    } catch {
      // Differentiate network failure from server/auth failure — never collapse
      // every error into one message (launch-discipline rule 4).
      console.warn("[signup-sheet:magic:network_error]");
      setBusy(false);
      setError("Couldn't reach the server. Check your connection and try again.");
      return;
    }
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      console.warn(`[signup-sheet:magic:fail:${res.status}]`);
      setError(
        res.status >= 500
          ? "Server error — please try again, or email info@tenderpath.me."
          : body.error || "Couldn't send the link. Try again."
      );
      return;
    }
    setSent(true);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="signup-sheet-title"
    >
      {/* keyframes are injected inline so the entrance works without a tailwind
          config dependency; reduced-motion users get no animation. */}
      <style>{`
        @keyframes tpSheetIn { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes tpFadeIn { from { opacity: 0; } to { opacity: 1; } }
      `}</style>

      {/* Dimmed backdrop — the score reveal stays visible behind it */}
      <button
        aria-label="Close sign-up"
        onClick={onClose}
        className="absolute inset-0 bg-ink/45 cursor-default"
        style={{ animation: prefersReduced ? undefined : "tpFadeIn 200ms ease-out" }}
      />

      {/* Sheet */}
      <div
        className="relative w-full sm:max-w-md bg-paper border-t sm:border border-ink sm:rounded-none shadow-xl max-h-[92vh] overflow-y-auto"
        style={{ animation: prefersReduced ? undefined : "tpSheetIn 280ms cubic-bezier(.16,1,.3,1)" }}
      >
        <div className="p-6 sm:p-8">
          {/* Close */}
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute top-4 right-4 font-mono text-[11px] tracking-[0.1em] uppercase text-ink-3 hover:text-ink"
          >
            Esc ✕
          </button>

          {sent ? (
            <div className="py-4">
              <p className="font-mono text-[10px] tracking-[0.16em] uppercase text-accent mb-3">
                Check your inbox
              </p>
              <h2 id="signup-sheet-title" className="font-serif text-[26px] sm:text-[30px] font-normal leading-[1.1] tracking-[-0.02em] text-ink mb-3">
                Your link is on the way.
              </h2>
              <p className="text-[13.5px] text-ink-2 leading-[1.6]">
                We sent a secure sign-in link to{" "}
                <span className="font-mono text-[12.5px] text-ink">{email}</span>. Click it to
                save your report and open your dashboard. Check spam if it&apos;s not there in a
                minute.
              </p>
              <button
                onClick={onClose}
                className="mt-6 font-mono text-[11px] tracking-[0.12em] uppercase text-ink-3 hover:text-ink border-b border-rule hover:border-ink pb-0.5"
              >
                ← Back to report
              </button>
            </div>
          ) : (
            <>
              <p className="font-mono text-[10px] tracking-[0.16em] uppercase text-accent mb-3">
                Save your readiness report
              </p>
              <h2 id="signup-sheet-title" className="font-serif text-[26px] sm:text-[30px] font-normal leading-[1.1] tracking-[-0.02em] text-ink mb-2">
                Keep your score — and we&apos;ll keep watching.
              </h2>
              <p className="text-[13px] text-ink-2 leading-[1.6] mb-6">
                Your score, matched tenders, grants and fixes — kept current, with an alert when
                new matches post.
              </p>

              <form onSubmit={sendMagicLink} className="space-y-3">
                <label className="block font-mono text-[10px] tracking-[0.16em] uppercase text-mute" htmlFor="signup-sheet-email">
                  Work email
                </label>
                <input
                  id="signup-sheet-email"
                  ref={emailRef}
                  type="email"
                  required
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(null); }}
                  placeholder="you@company.com"
                  className="w-full border border-rule bg-paper-2 px-3 py-2.5 text-[14px] text-ink placeholder-mute focus:border-ink focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full bg-ink text-paper font-mono text-[11px] tracking-[0.14em] uppercase px-4 py-3 hover:bg-accent transition-colors disabled:opacity-50"
                >
                  {busy ? "Sending…" : "Email me a sign-in link →"}
                </button>
              </form>

              {error && (
                <p className="mt-3 border-l-2 border-neg pl-3 py-1.5 text-[12px] text-ink-2">
                  {error}
                </p>
              )}

              {/* or — divider */}
              <div className="my-5 flex items-center gap-3">
                <span className="flex-1 h-px bg-rule" />
                <span className="font-mono text-[9px] tracking-[0.18em] uppercase text-mute">or</span>
                <span className="flex-1 h-px bg-rule" />
              </div>

              {/* Google — reuses the live branded mark + endpoint */}
              <a
                href={`/api/auth/google?next=${encodeURIComponent(next)}`}
                className="flex w-full items-center justify-center gap-2 border border-rule bg-paper px-4 py-2.5 text-[13px] text-ink hover:border-ink transition-colors"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                Continue with Google
              </a>

              {/* Reassurance row */}
              <p className="mt-5 font-mono text-[9.5px] tracking-[0.08em] uppercase text-mute text-center leading-relaxed">
                No card · No password · 30 sec, cancel anytime
              </p>

              {/* Quiet human option */}
              <p className="mt-3 text-center text-[12px] text-ink-3">
                Prefer to talk first?{" "}
                <a href="/contact" className="text-ink border-b border-rule hover:border-ink">
                  Talk to us
                </a>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
