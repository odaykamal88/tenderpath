"use client";

interface ArtifactGenerationNoticeProps {
  artifactLabel: string;
  busy: boolean;
  remainingRegenerations: number;
  retryLabel: string;
  onRetry: () => void;
}

const MONO = "'IBM Plex Mono', 'SF Mono', ui-monospace, monospace";

export default function ArtifactGenerationNotice({
  artifactLabel,
  busy,
  remainingRegenerations,
  retryLabel,
  onRetry,
}: ArtifactGenerationNoticeProps) {
  const blocked = remainingRegenerations <= 0;

  return (
    <div className="border-t border-amber-200 bg-amber-50/50 p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-700" style={{ fontFamily: MONO }}>
            Download file unavailable
          </div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-amber-900">
            Couldn&rsquo;t generate {artifactLabel} — retry? The dashboard output below is ready, but the downloadable file needs to be rebuilt.
          </p>
        </div>
        <button
          type="button"
          onClick={onRetry}
          disabled={busy || blocked}
          className="self-start rounded-sm bg-stone-900 px-3.5 py-2 text-[11px] font-semibold uppercase tracking-[0.15em] text-white transition-colors hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50 lg:self-center"
          style={{ fontFamily: MONO }}
        >
          {busy ? "Retrying…" : blocked ? "Regenerate limit reached" : retryLabel}
        </button>
      </div>
    </div>
  );
}
