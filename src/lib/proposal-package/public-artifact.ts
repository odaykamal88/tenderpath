import { authenticatedArtifactUrl } from "@/lib/vault/storage";

export function withOwnerArtifactUrl<T extends { pdf_url?: string | null; pdf_pathname?: string | null }>(
  pkg: T,
  workOrderId: number,
): T {
  return {
    ...pkg,
    pdf_url: pkg.pdf_url ? authenticatedArtifactUrl(workOrderId) : null,
    pdf_pathname: pkg.pdf_pathname == null ? pkg.pdf_pathname : null,
  };
}
