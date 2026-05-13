"use client";

import { useEffect, useRef } from "react";
import { trackClient } from "@/lib/telemetry/client";

interface FunnelBeaconProps {
  event: string;
  props?: Record<string, unknown>;
}

/**
 * One-shot client beacon. Fires the named event once on mount. Use as a
 * tiny island under a server component, e.g.
 *   <FunnelBeacon event="dashboard_landed" props={{ score: 72 }} />
 */
export function FunnelBeacon({ event, props }: FunnelBeaconProps) {
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    trackClient(event, props ?? {});
  }, [event, props]);
  return null;
}
