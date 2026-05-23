import Link from "next/link";

/**
 * Annual access pricing card — rendered on the dashboard overview to
 * convert trial users.
 *
 * PR-N (2026-05-23): rewritten with copywriter hat on. The lead is now
 * the Founder's rate ($49/year forever, locked the day they subscribe)
 * with hard scarcity — 100-seat cap, live counter, regular rate doubles
 * to $99/year once the seats are gone. The post-trial $99/year is
 * deliberately framed as the FALLBACK, not the primary path.
 *
 * The "21 of 100 claimed" counter is hardcoded for now — see
 * FOUNDING_CLAIMED below. Bump it as real conversions land. A DB-backed
 * counter felt over-engineered for what's fundamentally marketing copy,
 * and a slow DB read shouldn't break the dashboard overview.
 */

const SERIF = "'Fraunces', 'Times New Roman', serif";
const MONO = "'IBM Plex Mono', 'SF Mono', ui-monospace, monospace";

// Bump this as real subscribers land. Keep < FOUNDING_TOTAL to preserve
// scarcity. Once the founding-100 sells out, replace this whole card with
// the regular $99/year CTA.
const FOUNDING_CLAIMED = 23;
const FOUNDING_TOTAL = 100;

export function AnnualAccessCard() {
  const remaining = FOUNDING_TOTAL - FOUNDING_CLAIMED;
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
            Founder&apos;s rate · {remaining} of {FOUNDING_TOTAL} seats left
          </p>
          <h2
            id="annual-access-heading"
            className="mt-2 text-[26px] sm:text-[32px] font-medium leading-[1.1] tracking-tight max-w-2xl"
            style={{ fontFamily: SERIF }}
          >
            Keep bidding for tenders — lock $49/year, forever.
          </h2>
          <p className="mt-2 text-[13.5px] leading-relaxed text-stone-300 max-w-2xl">
            The first 100 founders pay $49/year for the full dashboard — bid/no-bid analyst,
            proposal drafts, roster fast-track, document vault, matched tenders + grants. That rate
            is locked the day you subscribe and stays yours as long as the subscription stays
            active. Seat 101 onward is $99/year.
          </p>
          <p
            className="mt-2.5 text-[10.5px] uppercase tracking-[0.18em] text-orange-200/90 tabular-nums"
            style={{ fontFamily: MONO }}
          >
            {FOUNDING_CLAIMED} / {FOUNDING_TOTAL} claimed · 30-day free trial · cancel anytime
          </p>
        </div>

        <div className="flex flex-col gap-2 lg:items-end">
          <Link
            href="/pay?plan=annual-access-founding"
            className="inline-flex items-center justify-center rounded-sm bg-orange-500 px-5 py-3 text-[12.5px] font-semibold uppercase tracking-[0.15em] text-stone-900 hover:bg-orange-400 transition-colors"
            style={{ fontFamily: MONO }}
          >
            Claim Founder&apos;s rate →
          </Link>
          <Link
            href="/pay?plan=annual-access"
            className="text-[10.5px] uppercase tracking-[0.15em] text-stone-300 hover:text-white border-b border-stone-600 hover:border-stone-300 transition-colors"
            style={{ fontFamily: MONO }}
          >
            Or $99/year regular →
          </Link>
        </div>
      </div>
    </section>
  );
}
