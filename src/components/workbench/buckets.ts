import { C } from "./tokens";
import type { BucketKey } from "@/lib/workbench/types";

/** Bucket → [label, color]. Mirrors the design's BUCKET map. */
export const BUCKET: Record<BucketKey, [string, string]> = {
  act_now: ["Act now", C.neg],
  strong_fit: ["Strong fit", C.pos],
  strategic: ["Strategic", C.blue],
  adjacent: ["Adjacent", C.warn],
  watchlist: ["Watchlist", C.mute],
};

export function bucketMeta(b: string): [string, string] {
  return BUCKET[b as BucketKey] ?? ["Match", C.mute];
}
