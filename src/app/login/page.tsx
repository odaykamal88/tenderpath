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
        <p className="text-sm text-gray-400 mb-6">
          Free for 14 days — no credit card required.
        </p>

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
              placeholder="Name (optional)"
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
              Paste the token from the magic link emailed to <span className="text-white">{email}</span>.
            </p>
            {process.env.NODE_ENV === "development" && devToken && (
              <p className="text-xs text-gray-500 break-all rounded bg-navy border border-white/10 px-3 py-2">
                Dev token: <code className="text-gold">{devToken}</code>
              </p>
            )}
            <input
              className="rounded-lg bg-navy border border-white/10 px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:border-gold focus:outline-none"
              placeholder="Paste token"
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
