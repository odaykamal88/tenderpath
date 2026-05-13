"use client";

import { trackClient } from "@/lib/telemetry/client";

interface TenderOpenLinkProps {
  href: string;
  className?: string;
  code: string;
  sourceProvenance?: "primary" | "aggregator" | "unknown";
  confidence?: "high" | "medium" | "low" | null;
  fit?: number;
  children: React.ReactNode;
}

export function TenderOpenLink({
  href,
  className,
  code,
  sourceProvenance,
  confidence,
  fit,
  children,
}: TenderOpenLinkProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={className}
      onClick={() => {
        trackClient("tender_clicked", {
          code,
          source_provenance: sourceProvenance ?? null,
          confidence: confidence ?? null,
          fit: fit ?? null,
          href,
        });
      }}
    >
      {children}
    </a>
  );
}
