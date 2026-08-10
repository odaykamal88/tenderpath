export interface CrawlerWorkerEndpoints {
  fetch: string;
  fetchMany: string;
  health: string;
}

/**
 * Normalise the single configured crawler-worker URL into its three public
 * endpoints. Production historically stores CRAWLER_WORKER_URL as either the
 * worker origin or the full `/fetch` endpoint, so callers must support both.
 */
export function crawlerWorkerEndpoints(
  raw = process.env.CRAWLER_WORKER_URL,
): CrawlerWorkerEndpoints | null {
  if (!raw?.trim()) return null;

  const configured = new URL(raw.trim());
  if (configured.protocol !== "http:" && configured.protocol !== "https:") {
    throw new Error("CRAWLER_WORKER_URL must use http or https");
  }
  if (configured.username || configured.password) {
    throw new Error("CRAWLER_WORKER_URL must not contain credentials");
  }

  configured.hash = "";
  const pathname = configured.pathname.replace(/\/+$/, "");
  const fetchEndpoint = new URL(configured.toString());
  if (!pathname || pathname === "/" || pathname === "/fetch") {
    fetchEndpoint.pathname = "/fetch";
  }

  return {
    fetch: fetchEndpoint.toString(),
    fetchMany: new URL("/fetch-many", configured).toString(),
    health: new URL("/health", configured).toString(),
  };
}
