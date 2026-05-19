"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

const MONO = "'IBM Plex Mono', 'SF Mono', ui-monospace, monospace";
const SERIF = "'Fraunces', 'Times New Roman', serif";

function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const next = search.get("next") || "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [step, setStep] = useState<"request" | "verify">("request");
  const [loginMode, setLoginMode] = useState<"magic" | "password">("magic");
  const [token, setToken] = useState("");
  const [devToken, setDevToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(
    search.get("error") === "google_denied"
      ? null
      : search.get("error")
      ? "Google sign-in failed. Please try again or use a magic link."
      : null
  );
  // Captures the email of a magic-link-only account whose password attempt
  // just failed. When set, the shared error area renders a one-click switch
  // to magic-link sign-in instead of "Invalid email or password". Audit P1 #9.
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
          localStorage.setItem("tp_token", body.token);
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

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(body.error || "Invalid token");
      return;
    }
    localStorage.setItem("tp_token", body.token);
    router.replace(next);
  }

  async function passwordLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    // Differentiate 4xx (real auth fail) from 5xx (server problem) and from
    // network errors. Without this split, a misconfigured backend or transient
    // 500 surfaces to the user as "Invalid email or password" — the exact
    // silent-failure pattern that hid the audit's P0 #3 from triage.
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
        // Surface the switch nudge instead of the generic bad-creds copy.
        setMagicNudge(email);
        setError(null);
      } else {
        setError(body.error || "Invalid email or password");
      }
      return;
    }
    localStorage.setItem("tp_token", body.token);
    router.replace(next);
  }

  // Auto-verify spinner
  if (busy && !email && search.get("token")) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center gap-4"
        style={{ backgroundColor: "#fafaf7" }}
      >
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-stone-300 border-t-stone-900" />
        <p
          className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-700"
          style={{ fontFamily: MONO }}
        >
          Signing you in
        </p>
        {error && (
          <p className="max-w-sm rounded-sm border-l-2 border-red-600 bg-red-50/40 px-3 py-2 text-[12px] text-red-700">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4 py-10"
      style={{ backgroundColor: "#fafaf7" }}
    >
      {/* Back link */}
      <div className="w-full max-w-sm mb-5">
        <Link
          href="/"
          className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500 hover:text-stone-900 transition-colors"
          style={{ fontFamily: MONO }}
        >
          ← Tender·Path
        </Link>
      </div>

      <div className="w-full max-w-sm rounded-md border border-stone-200/70 bg-white p-7">
        {/* Header */}
        <div className="mb-6">
          <div
            className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400"
            style={{ fontFamily: MONO }}
          >
            Sign in · workspace
          </div>
          <h1
            className="mt-1 text-[28px] leading-[1.1] font-medium text-stone-900 tracking-tight"
            style={{ fontFamily: SERIF }}
          >
            Save your assessment
          </h1>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-stone-600">
            Free for 14 days — no credit card required. We&apos;ll email you a secure sign-in link, or sign in to a demo workspace with a password.
          </p>
        </div>

        {/* Mode toggle — segmented */}
        <div className="mb-5 grid grid-cols-2 rounded-sm border border-stone-200/70 p-0.5 bg-stone-50/40">
          <button
            type="button"
            onClick={() => {
              setLoginMode("magic");
              setStep("request");
              setError(null);
              setMagicNudge(null);
            }}
            className={`rounded-sm px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.15em] transition-colors ${
              loginMode === "magic"
                ? "bg-white text-stone-900 shadow-sm"
                : "text-stone-500 hover:text-stone-700"
            }`}
            style={{ fontFamily: MONO }}
          >
            Magic link
          </button>
          <button
            type="button"
            onClick={() => {
              setLoginMode("password");
              setStep("request");
              setError(null);
            }}
            className={`rounded-sm px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.15em] transition-colors ${
              loginMode === "password"
                ? "bg-white text-stone-900 shadow-sm"
                : "text-stone-500 hover:text-stone-700"
            }`}
            style={{ fontFamily: MONO }}
          >
            Password
          </button>
        </div>

        {loginMode === "password" ? (
          <form onSubmit={passwordLogin} className="space-y-3">
            {/* Demo account hint */}
            <div className="rounded-sm border-l-2 border-orange-600 bg-orange-50/40 px-3.5 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div
                    className="text-[10px] font-semibold uppercase tracking-[0.18em] text-orange-700"
                    style={{ fontFamily: MONO }}
                  >
                    Demo account
                  </div>
                  <p
                    className="mt-1 text-[11px] text-stone-700 leading-relaxed"
                    style={{ fontFamily: MONO }}
                  >
                    demo@tenderpath.me<br />
                    TenderDemo2026!
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setEmail("demo@tenderpath.me");
                    setPassword("TenderDemo2026!");
                  }}
                  className="shrink-0 rounded-sm border border-orange-300 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-orange-700 hover:bg-orange-100/60 transition-colors"
                  style={{ fontFamily: MONO }}
                >
                  Fill
                </button>
              </div>
            </div>
            <div>
              <label
                className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500"
                style={{ fontFamily: MONO }}
              >
                Email
              </label>
              <input
                type="email"
                className="mt-1 w-full rounded-sm border border-stone-300 bg-white px-3 py-2.5 text-[13px] text-stone-900 placeholder-stone-400 focus:border-stone-700 focus:outline-none"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setMagicNudge(null); }}
                required
              />
            </div>
            <div>
              <label
                className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500"
                style={{ fontFamily: MONO }}
              >
                Password
              </label>
              <input
                type="password"
                className="mt-1 w-full rounded-sm border border-stone-300 bg-white px-3 py-2.5 text-[13px] text-stone-900 placeholder-stone-400 focus:border-stone-700 focus:outline-none"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <button
              disabled={busy}
              className="w-full rounded-sm bg-stone-900 px-4 py-2.5 text-[12.5px] font-semibold text-white hover:bg-stone-800 transition-colors disabled:opacity-50"
            >
              {busy ? "Signing in…" : "Sign in →"}
            </button>
          </form>
        ) : step === "request" ? (
          <form onSubmit={request} className="space-y-3">
            <div>
              <label
                className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500"
                style={{ fontFamily: MONO }}
              >
                Work email
              </label>
              <input
                type="email"
                className="mt-1 w-full rounded-sm border border-stone-300 bg-white px-3 py-2.5 text-[13px] text-stone-900 placeholder-stone-400 focus:border-stone-700 focus:outline-none"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setMagicNudge(null); }}
                required
              />
            </div>
            <button
              disabled={busy}
              className="w-full rounded-sm bg-stone-900 px-4 py-3 sm:py-2.5 text-[12.5px] font-semibold text-white hover:bg-stone-800 transition-colors disabled:opacity-50"
            >
              {busy ? "Sending…" : "Send magic link →"}
            </button>
          </form>
        ) : (
          <div className="space-y-3">
            <div className="rounded-md border border-stone-200/70 bg-stone-50/40 p-5 text-center">
              <svg
                className="mx-auto mb-3 h-7 w-7 text-stone-700"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                />
              </svg>
              <div
                className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500 mb-1"
                style={{ fontFamily: MONO }}
              >
                Check your inbox
              </div>
              <p className="text-[12.5px] leading-relaxed text-stone-700">
                We sent a sign-in link to{" "}
                <span className="font-medium text-stone-900" style={{ fontFamily: MONO }}>
                  {email}
                </span>
                .
              </p>
              <p className="mt-1 text-[11px] text-stone-500">Click the link to continue. Also check your spam folder.</p>
            </div>
            {process.env.NODE_ENV === "development" && devToken && (
              <p
                className="break-all rounded-sm border-l-2 border-orange-600 bg-orange-50/40 px-3 py-2 text-[11px] text-stone-700"
                style={{ fontFamily: MONO }}
              >
                Dev token: <span className="text-orange-700">{devToken}</span>
              </p>
            )}
            <button
              type="button"
              onClick={() => setStep("request")}
              className="text-[11px] font-semibold uppercase tracking-[0.15em] text-stone-500 hover:text-stone-900 transition-colors underline-offset-2 hover:underline"
              style={{ fontFamily: MONO }}
            >
              Use a different email
            </button>
          </div>
        )}

        {magicNudge && (
          <div className="mt-3 rounded-sm border-l-2 border-blue-600 bg-blue-50/50 px-3.5 py-3 space-y-2">
            <div
              className="text-[10px] font-semibold uppercase tracking-[0.18em] text-blue-700"
              style={{ fontFamily: MONO }}
            >
              Magic-link sign-in
            </div>
            <p className="text-[12px] text-stone-700 leading-relaxed">
              This account uses magic-link sign-in. No password is set.
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => sendMagicLink(magicNudge)}
              className="w-full rounded-sm bg-stone-900 px-3 py-2 text-[11.5px] font-semibold text-white hover:bg-stone-800 transition-colors disabled:opacity-50"
            >
              {busy ? "Sending…" : `Send sign-in link to ${magicNudge} →`}
            </button>
          </div>
        )}

        {error && (
          <p className="mt-3 rounded-sm border-l-2 border-red-600 bg-red-50/40 px-3 py-2 text-[11.5px] text-red-700">
            {error}
          </p>
        )}

        {loginMode === "magic" && step === "request" && (
          <>
            <div className="mt-5 flex items-center gap-3">
              <div className="flex-1 border-t border-stone-200" />
              <span
                className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400"
                style={{ fontFamily: MONO }}
              >
                or
              </span>
              <div className="flex-1 border-t border-stone-200" />
            </div>
            <a
              href={`/api/auth/google?next=${encodeURIComponent(next)}`}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-sm border border-stone-300 bg-white px-4 py-2.5 text-[12.5px] font-semibold text-stone-700 hover:border-stone-700 hover:text-stone-900 transition-colors"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              Continue with Google
            </a>
          </>
        )}
      </div>

      <p
        className="mt-5 text-[10.5px] text-stone-400"
        style={{ fontFamily: MONO }}
      >
        Tender·Path · UN procurement intelligence
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" style={{ backgroundColor: "#fafaf7" }} />}>
      <LoginForm />
    </Suspense>
  );
}
