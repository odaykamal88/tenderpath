"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

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
  const [error, setError] = useState<string | null>(null);
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

  // Auto-verify when magic link token is in the URL (?token=...)
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

  async function request(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(body.error || "Failed to send link");
      return;
    }
    setDevToken(body._devToken ?? null);
    setStep("verify");
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
    const res = await fetch("/api/auth/password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(body.error || "Invalid email or password");
      return;
    }
    localStorage.setItem("tp_token", body.token);
    router.replace(next);
  }

  // Show spinner while auto-verifying from URL token
  if (busy && !email && search.get("token")) {
    return (
      <div className="min-h-screen bg-navy flex flex-col items-center justify-center gap-4">
        <svg className="w-8 h-8 animate-spin text-gold" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <p className="text-sm text-slate-400">Signing you in…</p>
        {error && <p className="text-sm text-red-400 max-w-sm text-center">{error}</p>}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-navy flex flex-col items-center justify-center px-4">
      {/* Back link */}
      <Link
        href="/"
        className="self-start max-w-sm w-full mx-auto mb-6 text-xs text-gray-400 hover:text-gold transition-colors flex items-center gap-1"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Back to TenderPath
      </Link>

      <div className="w-full max-w-sm rounded-xl bg-navy-light border border-white/10 p-8">
        {/* Logo */}
        <div className="mb-6 text-center">
          <span className="text-2xl font-semibold text-white">
            Tender<span className="text-gold">Path</span>
          </span>
        </div>

        <h1 className="text-xl font-semibold text-white mb-1">
          Save your assessment results
        </h1>
        <p className="text-sm text-gray-400 mb-1">
          Free for 14 days — no credit card required.
        </p>
        <p className="text-xs text-gray-500 mb-6 flex items-center gap-1.5">
          <svg className="h-3 w-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          We'll email you a secure sign-in link, or sign into a demo workspace with a password.
        </p>

        <div className="mb-4 grid grid-cols-2 rounded-lg border border-white/10 bg-navy p-1">
          <button
            type="button"
            onClick={() => {
              setLoginMode("magic");
              setStep("request");
              setError(null);
            }}
            className={`rounded-md px-3 py-2 text-xs font-semibold transition-colors ${
              loginMode === "magic"
                ? "bg-white/10 text-white"
                : "text-gray-500 hover:text-gray-300"
            }`}
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
            className={`rounded-md px-3 py-2 text-xs font-semibold transition-colors ${
              loginMode === "password"
                ? "bg-white/10 text-white"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            Password
          </button>
        </div>

        <div className="mb-4 flex items-start gap-2 rounded-lg bg-navy border border-white/10 px-3 py-2.5">
          <svg className="w-4 h-4 text-gold flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" /></svg>
          <p className="text-xs text-gray-400 leading-relaxed">
            {loginMode === "magic"
              ? "No password needed. We'll email you a secure sign-in link."
              : "Password sign-in is available for prepared demo and internal accounts."}
          </p>
        </div>

        {loginMode === "password" ? (
          <form onSubmit={passwordLogin} className="flex flex-col gap-3">
            <input
              type="email"
              className="rounded-lg bg-navy border border-white/10 px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:border-gold focus:outline-none"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <input
              type="password"
              className="rounded-lg bg-navy border border-white/10 px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:border-gold focus:outline-none"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button
              disabled={busy}
              className="rounded-lg bg-gold px-4 py-2.5 text-sm font-semibold text-white hover:bg-gold-dark transition-colors disabled:opacity-50"
            >
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>
        ) : step === "request" ? (
          <form onSubmit={request} className="flex flex-col gap-3">
            <input
              type="email"
              className="rounded-lg bg-navy border border-white/10 px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:border-gold focus:outline-none"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <button
              disabled={busy}
              className="rounded-lg bg-gold px-4 py-2.5 text-sm font-semibold text-white hover:bg-gold-dark transition-colors disabled:opacity-50"
            >
              {busy ? "Sending…" : "Send magic link"}
            </button>
          </form>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="rounded-lg bg-navy border border-white/10 px-4 py-4 text-center">
              <svg className="mx-auto mb-3 h-8 w-8 text-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              <p className="text-sm text-white font-medium mb-1">Check your inbox</p>
              <p className="text-xs text-gray-400 leading-relaxed">
                We've sent a sign-in link to <span className="text-white">{email}</span>. Click the link in your email to continue. Also check your spam folder.
              </p>
            </div>
            {process.env.NODE_ENV === "development" && devToken && (
              <p className="text-xs text-gray-500 break-all rounded bg-navy border border-white/10 px-3 py-2">
                Dev token: <code className="text-gold">{devToken}</code>
              </p>
            )}
            <button
              type="button"
              onClick={() => setStep("request")}
              className="text-xs text-gray-500 hover:text-gold transition-colors hover:underline"
            >
              Use a different email
            </button>
          </div>
        )}

        {error && <div className="mt-3 text-xs text-red">{error}</div>}
        {loginMode === "magic" && step === "request" && (
          <>
            <div className="mt-5 flex items-center gap-3">
              <div className="flex-1 border-t border-white/10" />
              <span className="text-xs text-gray-600">or</span>
              <div className="flex-1 border-t border-white/10" />
            </div>
            <button
              disabled
              title="Coming soon"
              className="mt-3 w-full flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-navy px-4 py-2.5 text-sm text-gray-500 cursor-not-allowed opacity-60"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Continue with Google
              <span className="text-[10px] bg-white/10 rounded px-1.5 py-0.5">Soon</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-navy" />}>
      <LoginForm />
    </Suspense>
  );
}
