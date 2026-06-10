"use client";

/* Login — reskinned into the Workbench "dossier" system (dark spine + form).
 * ALL auth logic is preserved verbatim from the prior version: magic link via
 * /api/auth/signup, password via /api/auth/password (with 5xx vs 4xx vs
 * magic_link_only handling), Google via /api/auth/google, URL-token verify via
 * /api/auth/verify, the tp_bridge email prefill, devToken, and the `next`
 * redirect. Only the presentation changed. */

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { C, F } from "@/components/workbench/tokens";
import { useMedia } from "@/components/workbench/useMedia";

function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const next = search.get("next") || "/dashboard";
  const mobile = useMedia("(max-width: 859px)");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [step, setStep] = useState<"request" | "verify">("request");
  const [loginMode, setLoginMode] = useState<"magic" | "password">("magic");
  const [devToken, setDevToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(
    search.get("error") === "google_denied"
      ? null
      : search.get("error")
      ? "Google sign-in failed. Please try again or use a magic link."
      : null,
  );
  const [magicNudge, setMagicNudge] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("tp_bridge");
      if (!raw) return;
      const bridge = JSON.parse(raw) as { email?: unknown };
      if (typeof bridge.email === "string" && bridge.email.includes("@")) {
        setEmail(bridge.email);
      }
    } catch {
      console.warn("[tp:bridge:login_prefill_failed]");
    }
  }, []);

  useEffect(() => {
    const urlToken = search.get("token");
    if (!urlToken) return;
    setBusy(true);
    fetch("/api/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: urlToken }),
    })
      .then((r) => r.json())
      .then((body) => {
        if (body.token) {
          localStorage.removeItem("tp_token");
          router.replace(next);
        } else {
          setError(body.error || "This link is invalid or has expired. Please request a new one.");
          setBusy(false);
        }
      })
      .catch(() => {
        setError("Something went wrong. Please request a new magic link.");
        setBusy(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function sendMagicLink(emailValue: string) {
    setBusy(true);
    setError(null);
    setMagicNudge(null);
    let res: Response;
    try {
      res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: emailValue }),
      });
    } catch {
      setBusy(false);
      setError("Couldn't reach the server. Check your connection and try again.");
      return;
    }
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(body.error || "Failed to send link");
      return;
    }
    setDevToken(body._devToken ?? null);
    setLoginMode("magic");
    setStep("verify");
  }

  async function request(e: React.FormEvent) {
    e.preventDefault();
    await sendMagicLink(email);
  }

  async function passwordLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    let res: Response;
    try {
      res = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
    } catch {
      setBusy(false);
      setError("Couldn't reach the server. Check your connection and try again.");
      return;
    }
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      if (res.status >= 500) {
        setError(body.error || "Server error — please try the magic link option below, or email info@tenderpath.me.");
      } else if (body.code === "magic_link_only") {
        setMagicNudge(email);
        setError(null);
      } else {
        setError(body.error || "Invalid email or password");
      }
      return;
    }
    localStorage.removeItem("tp_token");
    router.replace(next);
  }

  // ── auto-verify spinner ──────────────────────────────────────
  if (busy && !email && search.get("token")) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, background: C.paper }}>
        <div style={{ width: 30, height: 30, borderRadius: 999, border: `2px solid ${C.paper2}`, borderTopColor: C.accent, animation: "tpSpin .8s linear infinite" }} />
        <p style={{ fontFamily: F.mono, fontSize: 11, fontWeight: 600, letterSpacing: "0.18em", textTransform: "uppercase", color: C.ink2 }}>Signing you in</p>
        {error && <p style={{ maxWidth: 360, borderLeft: `2px solid ${C.neg}`, background: "#fbeceb", padding: "8px 12px", fontFamily: F.sans, fontSize: 12, color: C.neg }}>{error}</p>}
      </div>
    );
  }

  const labelStyle: React.CSSProperties = { display: "block", fontFamily: F.mono, fontSize: 10, fontWeight: 600, letterSpacing: "0.18em", textTransform: "uppercase", color: C.mute };
  const inputStyle: React.CSSProperties = { marginTop: 5, width: "100%", border: `1px solid ${C.rule}`, background: C.white, padding: "10px 12px", fontFamily: F.sans, fontSize: 13, color: C.ink, outline: "none" };
  const toggleBtn = (active: boolean): React.CSSProperties => ({ padding: "9px 12px", fontFamily: F.mono, fontSize: 11, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", background: active ? C.ink : "transparent", color: active ? C.paper : C.mute, border: 0, cursor: "pointer" });

  const formCard = (
    <div style={{ width: "100%", maxWidth: 372 }}>
      <div style={{ fontFamily: F.mono, fontSize: 10, fontWeight: 600, letterSpacing: "0.18em", textTransform: "uppercase", color: C.accent, textAlign: mobile ? "center" : undefined }}>Sign in · workspace</div>
      <h1 style={{ fontFamily: F.display, fontSize: 33, fontWeight: 400, letterSpacing: "-0.02em", color: C.ink, lineHeight: 1.08, margin: "6px 0 0", textAlign: mobile ? "center" : undefined }}>Open your Workbench</h1>
      <p style={{ fontFamily: F.sans, fontSize: 13.5, lineHeight: 1.55, color: C.ink2, margin: "10px 0 0", textAlign: mobile ? "center" : undefined }}>
        30-day free trial — no card required. We&apos;ll email a secure sign-in link, or use a password for the demo workspace.
      </p>

      {/* mode toggle */}
      <div style={{ display: mobile ? "flex" : "inline-flex", width: mobile ? "fit-content" : undefined, margin: mobile ? "20px auto 18px" : "20px 0 18px", border: `1px solid ${C.rule}` }}>
        <button type="button" onClick={() => { setLoginMode("magic"); setStep("request"); setError(null); setMagicNudge(null); }} style={toggleBtn(loginMode === "magic")}>Magic link</button>
        <button type="button" onClick={() => { setLoginMode("password"); setStep("request"); setError(null); }} style={toggleBtn(loginMode === "password")}>Password</button>
      </div>

      {loginMode === "password" ? (
        <form onSubmit={passwordLogin} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ borderLeft: `2px solid ${C.accent}`, background: "#f8f2e2", padding: "12px 14px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div style={{ fontFamily: F.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.18em", textTransform: "uppercase", color: C.accent }}>Demo account</div>
              <p style={{ fontFamily: F.mono, fontSize: 11, color: C.ink2, margin: "5px 0 0", lineHeight: 1.5 }}>demo@tenderpath.me<br />TenderDemo2026!</p>
            </div>
            <button type="button" onClick={() => { setEmail("demo@tenderpath.me"); setPassword("TenderDemo2026!"); }} style={{ flexShrink: 0, border: `1px solid ${C.rule}`, background: C.white, padding: "5px 9px", fontFamily: F.mono, fontSize: 9.5, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: C.accent, cursor: "pointer" }}>Fill</button>
          </div>
          <div>
            <label style={labelStyle}>Email</label>
            <input type="email" style={inputStyle} placeholder="you@company.com" value={email} onChange={(e) => { setEmail(e.target.value); setMagicNudge(null); }} required />
          </div>
          <div>
            <label style={labelStyle}>Password</label>
            <input type="password" style={inputStyle} placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <button disabled={busy} style={{ width: "100%", background: C.ink, color: C.paper, border: 0, padding: "12px 0", fontFamily: F.mono, fontSize: 11.5, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer", opacity: busy ? 0.5 : 1 }}>
            {busy ? "Signing in…" : "Sign in →"}
          </button>
        </form>
      ) : step === "request" ? (
        <form onSubmit={request} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={labelStyle}>Work email</label>
            <input type="email" style={inputStyle} placeholder="you@company.com" value={email} onChange={(e) => { setEmail(e.target.value); setMagicNudge(null); }} required />
          </div>
          <button disabled={busy} style={{ width: "100%", background: C.accent, color: C.white, border: 0, padding: "13px 0", fontFamily: F.mono, fontSize: 11.5, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer", opacity: busy ? 0.5 : 1 }}>
            {busy ? "Sending…" : "Send magic link →"}
          </button>
        </form>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ border: `1px solid ${C.rule}`, background: C.white, padding: "22px 20px", textAlign: "center" }}>
            <div style={{ width: 46, height: 46, margin: "0 auto 12px", borderRadius: 999, background: C.ink, color: C.paper, display: "grid", placeItems: "center" }}>
              <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <div style={{ fontFamily: F.mono, fontSize: 10, fontWeight: 600, letterSpacing: "0.18em", textTransform: "uppercase", color: C.mute, marginBottom: 4 }}>Check your inbox</div>
            <p style={{ fontFamily: F.sans, fontSize: 13, lineHeight: 1.55, color: C.ink2, margin: 0 }}>
              We sent a sign-in link to <span style={{ fontFamily: F.mono, color: C.ink }}>{email}</span>. Click it to land in your Workbench — check spam if it&apos;s not there in a minute.
            </p>
          </div>
          {process.env.NODE_ENV === "development" && devToken && (
            <p style={{ wordBreak: "break-all", borderLeft: `2px solid ${C.accent}`, background: "#f8f2e2", padding: "8px 12px", fontFamily: F.mono, fontSize: 11, color: C.ink2 }}>
              Dev token: <span style={{ color: C.accent }}>{devToken}</span>
            </p>
          )}
          <button type="button" onClick={() => setStep("request")} style={{ alignSelf: "flex-start", fontFamily: F.mono, fontSize: 10.5, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: C.mute, background: "none", border: 0, borderBottom: `1px solid ${C.rule}`, cursor: "pointer", padding: "0 0 2px" }}>
            Use a different email →
          </button>
        </div>
      )}

      {magicNudge && (
        <div style={{ marginTop: 14, borderLeft: `2px solid ${C.blue}`, background: "#eef2f7", padding: "12px 14px" }}>
          <div style={{ fontFamily: F.mono, fontSize: 9.5, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: C.blue }}>Magic-link sign-in</div>
          <p style={{ fontFamily: F.sans, fontSize: 12.5, color: C.ink2, margin: "6px 0 10px", lineHeight: 1.5 }}>This account uses magic-link sign-in. No password is set.</p>
          <button type="button" disabled={busy} onClick={() => sendMagicLink(magicNudge)} style={{ width: "100%", background: C.ink, color: C.paper, border: 0, padding: "10px 0", fontFamily: F.mono, fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer", opacity: busy ? 0.5 : 1 }}>
            {busy ? "Sending…" : `Send sign-in link to ${magicNudge} →`}
          </button>
        </div>
      )}

      {error && (
        <p style={{ marginTop: 14, borderLeft: `2px solid ${C.neg}`, background: "#fbeceb", padding: "9px 12px", fontFamily: F.sans, fontSize: 12, color: C.neg }}>{error}</p>
      )}

      {loginMode === "magic" && step === "request" && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "20px 0 14px" }}>
            <div style={{ flex: 1, borderTop: `1px solid ${C.rule}` }} />
            <span style={{ fontFamily: F.mono, fontSize: 10, fontWeight: 600, letterSpacing: "0.18em", textTransform: "uppercase", color: C.faint }}>or</span>
            <div style={{ flex: 1, borderTop: `1px solid ${C.rule}` }} />
          </div>
          <a href={`/api/auth/google?next=${encodeURIComponent(next)}`} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 9, width: "100%", border: `1px solid ${C.rule}`, background: C.white, padding: "11px 0", fontFamily: F.mono, fontSize: 11.5, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: C.ink2, textDecoration: "none" }}>
            <svg width="16" height="16" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Continue with Google
          </a>
        </>
      )}

      <p style={{ marginTop: 18, fontFamily: F.sans, fontSize: 11.5, color: C.faint, textAlign: "center" }}>
        By continuing you agree to our <Link href="/terms" style={{ color: C.mute }}>Terms</Link> &amp; <Link href="/privacy" style={{ color: C.mute }}>Privacy Policy</Link>.
      </p>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", display: "grid", gridTemplateColumns: mobile ? "1fr" : "minmax(0, 1fr) minmax(0, 1fr)", background: C.paper }}>
      {/* left spine */}
      {!mobile && (
        <div style={{ background: C.spine, color: C.paper, padding: "42px 52px", position: "relative", overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <div style={{ position: "absolute", top: -60, right: -30, fontFamily: F.display, fontSize: 340, color: "rgba(255,255,255,0.05)", lineHeight: 1, userSelect: "none" }}>§</div>
          <div style={{ position: "relative" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span style={{ fontFamily: F.display, fontSize: 24, fontWeight: 500, color: C.white }}>TenderPath</span>
              <span style={{ fontFamily: F.display, fontSize: 24, color: C.accent }}>·</span>
            </div>
            <div style={{ fontFamily: F.mono, fontSize: 9.5, letterSpacing: "0.18em", textTransform: "uppercase", color: C.spineDim, marginTop: 4 }}>The Workbench · UN &amp; donor procurement</div>
          </div>
          <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", maxWidth: 440 }}>
            <h2 style={{ fontFamily: F.display, fontSize: 38, fontWeight: 400, letterSpacing: "-0.02em", lineHeight: 1.06, color: C.white, margin: 0 }}>Your bid desk for <em style={{ fontStyle: "italic", color: C.accent2 }}>UN &amp; donor</em> tenders.</h2>
            <p style={{ fontFamily: F.sans, fontSize: 14.5, lineHeight: 1.6, color: "#cdc6b3", margin: "18px 0 24px" }}>
              One operating surface that scores your readiness, ranks live tenders by fit, walks you through every gap, and turns a bid decision into a submission.
            </p>
            <div style={{ borderTop: `1px solid ${C.spineLine}` }}>
              {[
                ["01", "Readiness score & the gap Navigator", " — close every blocker with your hand held."],
                ["02", "Live tender matches", " ranked by fit, refreshed daily."],
                ["03", "Paste any tender", " for an instant bid / no-bid call."],
                ["04", "Submission-ready proposals", " — EOI, RFQ, RFP, mapped to the matrix."],
              ].map(([n, lead, tail]) => (
                <div key={n} style={{ display: "flex", gap: 14, alignItems: "baseline", padding: "13px 0", borderBottom: `1px solid ${C.spineLine}` }}>
                  <span style={{ fontFamily: F.mono, fontSize: 10, color: C.accent2, letterSpacing: "0.1em", flexShrink: 0 }}>{n}</span>
                  <span style={{ fontFamily: F.sans, fontSize: 13.5, lineHeight: 1.45, color: "#e4ddcb" }}><b style={{ color: C.white, fontWeight: 500 }}>{lead}</b>{tail}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ position: "relative", fontFamily: F.mono, fontSize: 10, letterSpacing: "0.08em", color: C.spineDim }}>30+ UN agencies · EU &amp; donor feeds · est. 2024</div>
        </div>
      )}

      {/* right form panel */}
      <div style={{ display: "flex", flexDirection: "column", padding: mobile ? "0 22px 24px" : "36px 48px" }}>
        {mobile ? (
          <Link href="/" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5, padding: "34px 0 0", textDecoration: "none" }}>
            <span style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span style={{ fontFamily: F.display, fontSize: 24, fontWeight: 500, color: C.ink }}>TenderPath</span>
              <span style={{ fontFamily: F.display, fontSize: 24, color: C.accent }}>·</span>
            </span>
            <span style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.2em", textTransform: "uppercase", color: C.faint }}>The Workbench</span>
          </Link>
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <Link href="/" style={{ fontFamily: F.mono, fontSize: 11, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: C.mute, textDecoration: "none" }}>← TenderPath</Link>
            <a href="mailto:info@tenderpath.me" style={{ fontFamily: F.mono, fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase", color: C.faint, textDecoration: "none" }}>Need help?</a>
          </div>
        )}
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: mobile ? "22px 0 10px" : "32px 0" }}>{formCard}</div>
        <div style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: C.faint, textAlign: "center" }}>TenderPath · UN procurement intelligence</div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "#f6f3ec" }} />}>
      <LoginForm />
    </Suspense>
  );
}
