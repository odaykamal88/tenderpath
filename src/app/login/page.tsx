"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const next = search.get("next") || "/dashboard";

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [step, setStep] = useState<"request" | "verify">("request");
  const [token, setToken] = useState("");
  const [devToken, setDevToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function request(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, name: name || null }),
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

  return (
    <div className="min-h-screen bg-navy flex flex-col items-center justify-center px-4">
      {/* Back link */}
      <a
        href="/"
        className="self-start max-w-sm w-full mx-auto mb-6 text-xs text-gray-400 hover:text-gold transition-colors flex items-center gap-1"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Back to TenderPath
      </a>

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
          We&apos;ll email you a secure code — no password needed.
        </p>

        <div className="mb-4 flex items-start gap-2 rounded-lg bg-navy border border-white/10 px-3 py-2.5">
          <svg className="w-4 h-4 text-gold flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" /></svg>
          <p className="text-xs text-gray-400 leading-relaxed">No password needed. We&apos;ll email you a secure verification code.</p>
        </div>

        {step === "request" ? (
          <form onSubmit={request} className="flex flex-col gap-3">
            <input
              type="email"
              className="rounded-lg bg-navy border border-white/10 px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:border-gold focus:outline-none"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <input
              type="text"
              className="rounded-lg bg-navy border border-white/10 px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:border-gold focus:outline-none"
              placeholder="Your name (new accounts only)"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button
              disabled={busy}
              className="rounded-lg bg-gold px-4 py-2.5 text-sm font-semibold text-white hover:bg-gold-dark transition-colors disabled:opacity-50"
            >
              {busy ? "Sending…" : "Send magic link"}
            </button>
          </form>
        ) : (
          <form onSubmit={verify} className="flex flex-col gap-3">
            <p className="text-sm text-gray-400">
              Enter the verification code we emailed to <span className="text-white">{email}</span>. Check your inbox (and spam folder).
            </p>
            {process.env.NODE_ENV === "development" && devToken && (
              <p className="text-xs text-gray-500 break-all rounded bg-navy border border-white/10 px-3 py-2">
                Dev token: <code className="text-gold">{devToken}</code>
              </p>
            )}
            <input
              className="rounded-lg bg-navy border border-white/10 px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:border-gold focus:outline-none"
              placeholder="Paste verification code"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              required
            />
            <button
              disabled={busy}
              className="rounded-lg bg-gold px-4 py-2.5 text-sm font-semibold text-white hover:bg-gold-dark transition-colors disabled:opacity-50"
            >
              {busy ? "Verifying…" : "Sign in"}
            </button>
            <button
              type="button"
              onClick={() => setStep("request")}
              className="text-xs text-gray-500 hover:text-gold transition-colors hover:underline"
            >
              Use a different email
            </button>
          </form>
        )}

        {error && <div className="mt-3 text-xs text-red">{error}</div>}
        {step === "request" && (
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
