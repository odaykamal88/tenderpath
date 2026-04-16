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
    <div className="min-h-screen grid place-items-center bg-gray-50 px-4">
      <div className="w-full max-w-sm rounded-lg bg-white border border-gray-200 p-6">
        <h1 className="text-xl font-semibold text-gray-900 mb-1">
          Sign in to TenderPath
        </h1>
        <p className="text-sm text-gray-600 mb-6">
          14-day free trial. No credit card required.
        </p>

        {step === "request" ? (
          <form onSubmit={request} className="flex flex-col gap-3">
            <input
              type="email"
              className="border rounded px-3 py-2 text-sm"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <input
              type="text"
              className="border rounded px-3 py-2 text-sm"
              placeholder="Name (optional)"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button
              disabled={busy}
              className="px-4 py-2 bg-gray-900 text-white text-sm rounded disabled:opacity-50"
            >
              {busy ? "Sending…" : "Send magic link"}
            </button>
          </form>
        ) : (
          <form onSubmit={verify} className="flex flex-col gap-3">
            <p className="text-sm text-gray-600">
              Paste the token from the magic link emailed to {email}.
            </p>
            {devToken && (
              <p className="text-xs text-gray-500 break-all">
                Dev token: <code>{devToken}</code>
              </p>
            )}
            <input
              className="border rounded px-3 py-2 text-sm"
              placeholder="Paste token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              required
            />
            <button
              disabled={busy}
              className="px-4 py-2 bg-gray-900 text-white text-sm rounded disabled:opacity-50"
            >
              {busy ? "Verifying…" : "Sign in"}
            </button>
            <button
              type="button"
              onClick={() => setStep("request")}
              className="text-xs text-gray-500 hover:underline"
            >
              Use a different email
            </button>
          </form>
        )}

        {error && <div className="mt-3 text-xs text-red-600">{error}</div>}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <LoginForm />
    </Suspense>
  );
}
