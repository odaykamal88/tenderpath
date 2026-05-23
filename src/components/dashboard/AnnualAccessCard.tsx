import Link from "next/link";

/**
 * Annual access pricing card — rendered on the dashboard overview to set
 * pricing expectations for trial users.
 *
 * PR-M (2026-05-23): trimmed to a single $99/year CTA. The Founding-100
 * $49 offer was moved out of this card per product direction — it will
 * surface elsewhere (a top-of-dashboard banner or post-onboarding modal,
 * TBD). Keep the dashboard's overview pricing one-CTA-clean for now.
 *
 * The 30-day free trial line + cancel-anytime affordance is the only
 * tension we need here.
 */

const SERIF = "'Fraunces', 'Times New Roman', serif";
const MONO = "'IBM Plex Mono', 'SF Mono', ui-monospace, monospace";

export function AnnualAccessCard() {
  return (
    <section
      className="mt-6 rounded-md border border-stone-900 bg-stone-900 text-white p-5 sm:p-6"
      aria-labelledby="annual-access-heading"
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div>
          <p
            className="text-[10px] font-semibold uppercase tracking-[0.22em] text-orange-300"
            style={{ fontFamily: MONO }}
          >
            Full access · 30-day free trial active
          </p>
          <h2
            id="annual-access-heading"
            className="mt-2 text-[26px] sm:text-[30px] font-medium leading-tight tracking-tight"
            style={{ fontFamily: SERIF }}
          >
            $99/year · everything on the dashboard
          </h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-stone-300 max-w-2xl">
            Bid/no-bid analyst, proposal drafts, roster fast-track, document vault, weekly matched
            tenders + grants, and full pipeline tooling — one subscription, every feature, no
            per-tender add-ons. Trial unlocks everything for 30 days; cancel any time before day 30
            and you won&apos;t be charged.
          </p>
        </div>

        <div className="flex flex-col gap-2 lg:items-end">
          <Link
            href="/pay?plan=annual-access"
            className="inline-flex items-center justify-center rounded-sm bg-orange-500 px-5 py-3 text-[12.5px] font-semibold uppercase tracking-[0.15em] text-stone-900 hover:bg-orange-400 transition-colors"
            style={{ fontFamily: MONO }}
          >
            Subscribe · $99/year →
          </Link>
        </div>
      </div>
    </section>
  );
}
