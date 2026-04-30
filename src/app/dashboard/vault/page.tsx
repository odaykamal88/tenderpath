"use client";

import { useEffect, useMemo, useState } from "react";
import UpgradeGate from "../components/UpgradeGate";

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
  });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [requestedGap, setRequestedGap] = useState<string | null>(null);

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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedType = params.get("type");
    if (requestedType && TYPES.some((t) => t.value === requestedType)) {
      setForm((prev) => ({ ...prev, type: requestedType as DocType }));
    }
    setRequestedGap(params.get("gap"));
  }, []);

  const expiring = useMemo(
    () =>
      docs.filter((d) => {
        const days = daysUntil(d.expiry_date);
        return days !== null && days <= EXPIRY_WARN_DAYS;
      }),
    [docs]
  );

  async function upload(e?: React.FormEvent, fileOverride?: File) {
    e?.preventDefault();
    setError(null);

    const file = fileOverride ?? selectedFile;
    if (!file) {
      setError("Please select a file to upload.");
      return;
    }

    setUploading(true);

    try {
      // Upload file first
      const uploadData = new FormData();
      uploadData.append("file", file);

      const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
      const uploadRes = await fetch("/api/dashboard/vault/upload", {
        method: "POST",
        headers: token ? { authorization: `Bearer ${token}` } : {},
        body: uploadData,
      });

      if (!uploadRes.ok) {
        const body = await uploadRes.json().catch(() => ({}));
        setError(body.error || "File upload failed");
        setUploading(false);
        return;
      }

      const { url: file_url } = await uploadRes.json();

      // Save document record
      const res = await fetch("/api/dashboard/vault", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          name: form.name || file.name,
          type: form.type,
          expiry_date: form.expiry_date || null,
          file_url,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "Save failed");
        setUploading(false);
        return;
      }

      const body = await res.json();
      setDocs((prev) => [body.document, ...prev]);
      setForm({ name: "", type: "certification", expiry_date: "" });
      setSelectedFile(null);
      // Reset file input
      const fileInput = document.getElementById("vault-file-input") as HTMLInputElement;
      if (fileInput) fileInput.value = "";
    } finally {
      setUploading(false);
    }
  }

  async function remove(id: number) {
    await fetch(`/api/dashboard/vault/${id}`, { method: "DELETE", headers: authHeaders() });
    setDocs((prev) => prev.filter((d) => d.id !== id));
  }

  return (
    <UpgradeGate
      title="Unlock the document vault"
      description="Preview the compliance library and expiry tracking. A subscription lets you store reusable bid documents and connect them to readiness gaps."
    >
    <div>
      <h1 className="text-2xl font-semibold text-gray-900">Document Vault</h1>
      <p className="text-sm text-gray-600 mb-6">
        Store the compliance docs you reuse across tender submissions.
      </p>

      {requestedGap && (
        <div className="mb-6 rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">Readiness gap</div>
          <p className="mt-1 text-sm text-amber-900">{requestedGap}</p>
          <p className="mt-1 text-xs text-amber-700">
            Upload or review the evidence that proves this blocker is handled.
          </p>
        </div>
      )}

      {expiring.length > 0 && (
        <div className="mb-6 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-900">
          <strong>{expiring.length}</strong> document
          {expiring.length === 1 ? "" : "s"} expire within {EXPIRY_WARN_DAYS} days:{" "}
          {expiring.map((d) => d.name).join(", ")}
        </div>
      )}

      <form
        onSubmit={upload}
        className="mb-6 rounded-lg border border-gray-200 bg-white p-4 space-y-3"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input
            className="border rounded px-2 py-1 text-sm"
            placeholder="Document name (optional — defaults to filename)"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
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
          <div>
            <label className="block text-xs text-gray-500 mb-1">Expiry date (optional)</label>
            <input
              type="date"
              className="w-full border rounded px-2 py-1 text-sm"
              value={form.expiry_date}
              onChange={(e) => setForm({ ...form, expiry_date: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">File *</label>
            <input
              id="vault-file-input"
              type="file"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.webp"
              className="w-full text-sm text-gray-600 file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:text-xs file:font-medium file:bg-gray-900 file:text-white hover:file:bg-gray-700 cursor-pointer"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                setSelectedFile(file);
                if (file) upload(undefined, file);
              }}
              required
            />
            <p className="mt-1 text-xs text-gray-400">PDF, Word, Excel, or image — max 10MB</p>
          </div>
        </div>
        {uploading && (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <svg className="animate-spin h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Uploading…
          </div>
        )}
        {error && (
          <div className="text-xs text-red-600">{error}</div>
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
    </UpgradeGate>
  );
}
