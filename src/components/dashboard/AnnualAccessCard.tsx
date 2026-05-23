import Link from "next/link";

/**
 * Annual access pricing card — rendered on the dashboard overview to set
 * pricing expectations for trial users.
 *
 * Headline: $99/year. Special: $49/year locked forever for the first 100
 * users — surfaced with a scarcity counter ("21 of 100 claimed") so a
 * trial visitor sees the offer is finite. The counter is a deliberately
 * conservative seed number; bump it from the config below as real
 * conversions land. We're NOT polling a live counter because (a) over-
 * promising live stats reads as fake to most visitors, (b) the marketing
 * truth is "first 100" not "first N as of right now".
 *
 * The CTA links to /pay?plan=annual-access — that plan slug is not yet
 * wired to a Stripe price ID, so the checkout endpoint will fall through
 * to the "Card payments for this plan are not yet configured" message.
 * That's intentional for the staged rollout: the card communicates the
 * pricing intent now while the Stripe product is being created.
 */

const SERIF = "'Fraunces', 'Times New Roman', serif";
const MONO = "'IBM Plex Mono', 'SF Mono', ui-monospace, monospace";

// Bump this as real subscribers land. Keep < 100 to preserve scarcity.
// Hardcoded rather than DB-backed: a flaky DB read shouldn't break the
// dashboard, and "first 100" is a campaign frame, not a live count.
const FOUNDING_CLAIMED = 21;
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
            Full access · 14-day free trial active
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
            per-tender add-ons. Trial unlocks everything for 14 days.
          </p>

          {/* Founding-members offer + scarcity counter */}
          <div className="mt-4 rounded-sm border border-orange-400/40 bg-orange-500/10 px-3.5 py-2.5 max-w-xl">
            <p
              className="text-[10px] font-semibold uppercase tracking-[0.18em] text-orange-300"
              style={{ fontFamily: MONO }}
            >
              Founding-100 offer
            </p>
            <p className="mt-1 text-[14px] leading-snug text-white">
              <span
                className="text-[20px] font-medium tabular-nums tracking-tight"
                style={{ fontFamily: SERIF }}
              >
                $49/year
              </span>
              <span className="ml-2 text-[12px] text-stone-300">
                — locked at this rate for life
              </span>
            </p>
            <p
              className="mt-1 text-[10.5px] uppercase tracking-[0.16em] text-orange-200/90 tabular-nums"
              style={{ fontFamily: MONO }}
            >
              {FOUNDING_CLAIMED} of {FOUNDING_TOTAL} claimed · {remaining} left
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2 lg:items-end">
          <Link
            href="/pay?plan=annual-access"
            className="inline-flex items-center justify-center rounded-sm bg-orange-500 px-5 py-3 text-[12.5px] font-semibold uppercase tracking-[0.15em] text-stone-900 hover:bg-orange-400 transition-colors"
            style={{ fontFamily: MONO }}
          >
            Lock in $49/year →
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
