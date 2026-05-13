/**
 * Client-side beacon for activation funnel events. Never throws, never blocks
 * navigation. Uses sendBeacon when available so a click followed immediately
 * by an outbound navigation still ships the event.
 */

const ANON_ID_KEY = "tp_anon_id";

function readAnonId(): string {
  try {
    const existing = localStorage.getItem(ANON_ID_KEY);
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    localStorage.setItem(ANON_ID_KEY, fresh);
    return fresh;
  } catch {
    return "";
  }
}

function readAuthToken(): string | null {
  try {
    return localStorage.getItem("tp_token");
  } catch {
    return null;
  }
}

export function trackClient(
  event: string,
  props: Record<string, unknown> = {},
): void {
  if (typeof window === "undefined") return;
  const payload = JSON.stringify({ event, props, anon_id: readAnonId() });
  const url = "/api/telemetry/event";

  const token = readAuthToken();

  // sendBeacon doesn't support headers, so when a token exists we fall back
  // to fetch with keepalive so the request survives unload.
  if (!token && typeof navigator.sendBeacon === "function") {
    try {
      const blob = new Blob([payload], { type: "application/json" });
      const sent = navigator.sendBeacon(url, blob);
      if (sent) return;
    } catch {
      // fall through to fetch
    }
  }

  try {
    fetch(url, {
      method: "POST",
      keepalive: true,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: payload,
    }).catch(() => {
      // best-effort: telemetry never blocks the user
    });
  } catch {
    // swallowed
  }
}
