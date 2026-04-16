"use client";

import { useEffect, useMemo, useState } from "react";

type DocType = "certification" | "financial" | "cv" | "past_performance" | "other";

interface VaultDoc {
  id: number;
  name: string;
  type: DocType;
  expiry_date: string | null;
  file_url: string;
  created_at: string;
}

const TYPES: { value: DocType; label: string }[] = [
  { value: "certification", label: "Certification" },
  { value: "financial", label: "Financial" },
  { value: "cv", label: "CV" },
  { value: "past_performance", label: "Past performance" },
  { value: "other", label: "Other" },
];

const EXPIRY_WARN_DAYS = 60;

function authHeaders(): HeadersInit {
  const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
  return token
    ? { "content-type": "application/json", authorization: `Bearer ${token}` }
    : { "content-type": "application/json" };
}

function daysUntil(date: string | null): number | null {
  if (!date) return null;
  const diff = new Date(date).getTime() - Date.now();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

export default function VaultPage() {
  const [docs, setDocs] = useState<VaultDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    type: "certification" as DocType,
    expiry_date: "",
    file_url: "",
  });

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/dashboard/vault", { headers: authHeaders() });
      if (res.ok) {
        const body = await res.json();
        setDocs(body.documents);
      }
      setLoading(false);
    })();
  }, []);

  const expiring = useMemo(
    () =>
      docs.filter((d) => {
        const days = daysUntil(d.expiry_date);
        return days !== null && days <= EXPIRY_WARN_DAYS;
      }),
    [docs]
  );

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/dashboard/vault", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        name: form.name,
        type: form.type,
        expiry_date: form.expiry_date || null,
        file_url: form.file_url,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error || "Upload failed");
      return;
    }
    const body = await res.json();
    setDocs((prev) => [body.document, ...prev]);
    setForm({ name: "", type: "certification", expiry_date: "", file_url: "" });
  }

  async function remove(id: number) {
    await fetch(`/api/dashboard/vault/${id}`, { method: "DELETE", headers: authHeaders() });
    setDocs((prev) => prev.filter((d) => d.id !== id));
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900">Document Vault</h1>
      <p className="text-sm text-gray-600 mb-6">
        Store the compliance docs you reuse across tender submissions.
      </p>

      {expiring.length > 0 && (
        <div className="mb-6 rounded-md bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900">
          <strong>{expiring.length}</strong> document
          {expiring.length === 1 ? "" : "s"} expire within {EXPIRY_WARN_DAYS} days:{" "}
          {expiring.map((d) => d.name).join(", ")}
        </div>
      )}

      <form
        onSubmit={upload}
        className="mb-6 rounded-lg border border-gray-200 bg-white p-4 grid grid-cols-1 md:grid-cols-5 gap-3"
      >
        <input
          className="border rounded px-2 py-1 text-sm md:col-span-2"
          placeholder="Document name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          required
        />
        <select
          className="border rounded px-2 py-1 text-sm"
          value={form.type}
          onChange={(e) => setForm({ ...form, type: e.target.value as DocType })}
        >
          {TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <input
          type="date"
          className="border rounded px-2 py-1 text-sm"
          value={form.expiry_date}
          onChange={(e) => setForm({ ...form, expiry_date: e.target.value })}
        />
        <input
          type="url"
          className="border rounded px-2 py-1 text-sm"
          placeholder="https://… file URL"
          value={form.file_url}
          onChange={(e) => setForm({ ...form, file_url: e.target.value })}
          required
        />
        <button
          type="submit"
          className="md:col-span-5 px-4 py-2 bg-gray-900 text-white text-sm rounded"
        >
          Save document
        </button>
        {error && (
          <div className="md:col-span-5 text-xs text-red-600">{error}</div>
        )}
      </form>

      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
        {loading ? (
          <div className="p-4 text-sm text-gray-500">Loading…</div>
        ) : docs.length === 0 ? (
          <div className="p-4 text-sm text-gray-500">No documents yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-left">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">Expires</th>
                <th className="px-4 py-2 font-medium">File</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => {
                const days = daysUntil(d.expiry_date);
                const warning = days !== null && days <= EXPIRY_WARN_DAYS;
                return (
                  <tr key={d.id} className="border-t border-gray-100">
                    <td className="px-4 py-2 text-gray-900">{d.name}</td>
                    <td className="px-4 py-2 text-gray-600 capitalize">
                      {d.type.replace("_", " ")}
                    </td>
                    <td className={`px-4 py-2 ${warning ? "text-amber-700 font-medium" : "text-gray-600"}`}>
                      {d.expiry_date
                        ? `${new Date(d.expiry_date).toLocaleDateString()}${
                            warning && days! >= 0 ? ` (${days}d)` : ""
                          }${days !== null && days < 0 ? " (expired)" : ""}`
                        : "—"}
                    </td>
                    <td className="px-4 py-2">
                      <a
                        href={d.file_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-gray-900 underline hover:no-underline"
                      >
                        Open
                      </a>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => remove(d.id)}
                        className="text-xs text-red-600 hover:underline"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
