/* Client-side data access for the submissions workflow. Same auth idiom as the
 * rest of the dashboard: Bearer tp_token from localStorage, tp_session cookie
 * as fallback. */

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ClientOrderAction,
  SubmissionCode,
  SubmissionOrder,
  WizardDraftState,
} from "@/lib/submissions/types";
import type { SubmissionNudge } from "@/lib/submissions/nudges";
import type { TenderPackState } from "@/lib/tender-workspace/types";
import type { TenderRequirementsState } from "@/lib/tender-workspace/types";

export function authHeaders(extra?: Record<string, string>): HeadersInit {
  const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
  return {
    "content-type": "application/json",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(extra ?? {}),
  };
}

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: authHeaders(), cache: "no-store" });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string };
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`, data?.code);
  return data;
}

export interface OrdersPayload {
  orders: SubmissionOrder[];
  nudges: SubmissionNudge[];
}

export function listOrders(): Promise<OrdersPayload> {
  return request<OrdersPayload>("/api/dashboard/submission-orders");
}

export function getOrder(id: number): Promise<{ order: SubmissionOrder }> {
  return request(`/api/dashboard/submission-orders/${id}`);
}

export function clientAct(id: number, action: ClientOrderAction): Promise<{ order: SubmissionOrder }> {
  return request(`/api/dashboard/submission-orders/${id}`, {
    method: "POST",
    body: JSON.stringify(action),
  });
}

export function commission(
  type: SubmissionCode,
  draft: WizardDraftState,
): Promise<{ order: SubmissionOrder; work_order_id: number; pay_url?: string; free?: boolean }> {
  return request("/api/dashboard/submission-orders", {
    method: "POST",
    body: JSON.stringify({ type, draft }),
  });
}

export function loadDraft(type: SubmissionCode): Promise<{ draft: Partial<WizardDraftState> }> {
  return request(`/api/dashboard/submission-drafts/${type}`);
}

export function saveDraft(type: SubmissionCode, draft: WizardDraftState): Promise<{ ok: boolean }> {
  return request(`/api/dashboard/submission-drafts/${type}`, {
    method: "PUT",
    body: JSON.stringify({ draft }),
  });
}

/** `url` overrides the tender's stored notice URL — used when the bidder has a
 *  direct link to the pack that the notice page does not expose publicly.
 *  `title`/`agency` carry a hand-entered notice, which has no tenders row; the
 *  server keys its pack on the title instead of an id. */
export function importTenderPack(
  tender: { tenderId?: number | null; title?: string | null; agency?: string | null },
  url?: string,
): Promise<TenderPackState & { sourceUrl?: string }> {
  return request("/api/dashboard/tender-pack/import", {
    method: "POST",
    body: JSON.stringify({
      ...(tender.tenderId ? { tenderId: tender.tenderId } : {}),
      ...(tender.title ? { title: tender.title } : {}),
      ...(tender.agency ? { agency: tender.agency } : {}),
      ...(url ? { url } : {}),
    }),
  });
}

export function generateTenderRequirements(
  tender: WizardDraftState["tender"],
  tenderPack: TenderPackState,
): Promise<{ requirements: TenderRequirementsState }> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 55_000);
  return request<{ requirements: TenderRequirementsState }>(
    "/api/dashboard/tender-pack/requirements",
    {
      method: "POST",
      body: JSON.stringify({ tender, tenderPack }),
      signal: controller.signal,
    },
  ).catch((error: unknown) => {
    if (controller.signal.aborted) {
      throw new ApiError(
        504,
        "The automated read took too long. Your private files are safe—continue the intake and TenderPath will validate the compliance map during the assisted review.",
        "REQUIREMENTS_TIMEOUT",
      );
    }
    throw error;
  }).finally(() => window.clearTimeout(timeout));
}

export interface VaultDocRow {
  id: number;
  name: string;
  type: string;
  expiry_date: string | null;
  created_at: string;
}

export async function listVaultDocs(): Promise<VaultDocRow[]> {
  try {
    const data = await request<{ documents?: VaultDocRow[] }>("/api/dashboard/vault");
    return Array.isArray(data.documents) ? data.documents : [];
  } catch {
    return [];
  }
}

export interface ProfilePrefill {
  businessName: string | null;
  description: string | null;
  countryFocus: string | null;
}

export async function loadProfilePrefill(): Promise<ProfilePrefill> {
  try {
    const data = await request<{
      business_name?: string | null;
      profile_description?: string | null;
      country_focus?: string | null;
    }>("/api/dashboard/profile");
    const countries = data.country_focus;
    return {
      businessName: data.business_name ?? null,
      description: data.profile_description ?? null,
      countryFocus: Array.isArray(countries) ? countries.join(" · ") : (countries as string | null) ?? null,
    };
  } catch {
    return { businessName: null, description: null, countryFocus: null };
  }
}

/** Orders list with focus-refetch + a light poll while any order is in an ops
 *  stage (the "live-synced" behavior — ops advances show up without a manual
 *  refresh). */
export function useSubmissionOrders() {
  const [payload, setPayload] = useState<OrdersPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refetch = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await listOrders();
      setPayload(data);
      setError(null);
    } catch (err) {
      if (!silent) setError(err instanceof Error ? err.message : "Could not load submissions.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
    const onFocus = () => refetch(true);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refetch]);

  const hasLive = Boolean(
    payload?.orders.some((o) => o.paidAt && ["intake", "drafting", "qa", "revisions"].includes(o.stage)),
  );

  useEffect(() => {
    if (timer.current) clearInterval(timer.current);
    if (hasLive) {
      timer.current = setInterval(() => refetch(true), 25_000);
    }
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [hasLive, refetch]);

  return { payload, error, loading, refetch };
}

export function agoLabel(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const mins = Math.max(0, Math.round((Date.now() - t) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}
