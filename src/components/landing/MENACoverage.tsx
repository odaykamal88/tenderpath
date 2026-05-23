/* MENACoverage — regional supplement, three-band block
 *
 * Audit 2026-05-19 P1 #7 (T8): the homepage said nothing about MENA
 * coverage, bilateral donors, or Arabic-language matching — three things
 * Persona 3 (Mada Women Cooperative, Jordan) was explicitly looking for.
 * This block names what we actually cover today without overclaiming the
 * gaps still on the Sprint 25 backlog (USAID/FCDO/AFD-Jordan).
 *
 * Stays honest: the country pill row lists countries the wizard accepts
 * and that the corpus indexes; live tender volume per country still
 * depends on what's open in the source feeds at run time.
 */

import Link from "next/link";

const COVERAGE_BANDS = [
  {
    n: "01",
    label: "Bilateral",
    body: "EU-Jordan civil-society and humanitarian calls (via TED). KfW for German-funded MENA projects (via GTAI aggregator). Austrian Development Agency. New bilateral surfaces land in your assessment as we add them — re-run any time.",
  },
  {
    n: "02",
    label: "Multilateral + UN",
    body: "World Bank MENA portfolio direct. All UN agencies that publish through UNGM plus UNDP Atlas direct — UNRWA, UNICEF MENA, UNDP Arab States, ILO Arab States, UNFPA Arab States, IOM, FAO, UNOPS.",
  },
  {
    n: "03",
    label: "Languages",
    body: "Arabic-issued tenders are indexed and matched alongside English-language calls. Your dashboard surfaces matches in Arabic and English so your team reads them in the language they work in.",
  },
];

const MENA_COUNTRIES = [
  "Jordan",
  "Egypt",
  "Lebanon",
  "Tunisia",
  "Morocco",
  "Iraq",
  "Palestine",
  "Yemen",
];

export default function MENACoverage() {
  return (
    <section id="mena" className="bg-paper-2 py-16 sm:py-20 lg:py-28 border-y border-rule">
      <div className="mx-auto max-w-7xl px-5 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="grid lg:grid-cols-[1fr_2fr] gap-6 sm:gap-10 lg:gap-16 mb-12 sm:mb-16 items-end">
          <div>
            <p className="font-mono text-[10px] sm:text-[11px] tracking-[0.16em] sm:tracking-[0.18em] uppercase text-accent mb-4 sm:mb-5">
              Regional edition · MENA
            </p>
            <h2 className="font-serif text-[34px] sm:text-[40px] lg:text-[52px] font-normal leading-[1.05] sm:leading-[1.0] tracking-[-0.02em] text-ink text-balance">
              MENA bilateral, multilateral, and UN — in Arabic and English.
            </h2>
          </div>
          <p className="text-[15px] sm:text-[16px] text-ink-2 leading-[1.6] max-w-lg lg:pb-3">
            MENA NGOs and consultancies have asked for bilateral donor matching for years.
            Here&rsquo;s what we cover today, named honestly. Your assessment surfaces only
            what&rsquo;s live in your selected geography — no off-country noise.
          </p>
        </div>

        {/* Three coverage bands */}
        <div className="grid md:grid-cols-3 gap-px bg-rule border border-rule mb-10 sm:mb-12">
          {COVERAGE_BANDS.map((band) => (
            <article key={band.n} className="bg-paper p-6 sm:p-7">
              <div className="flex items-baseline justify-between mb-3 sm:mb-4">
                <span className="font-mono text-[10px] tracking-[0.14em] sm:tracking-[0.16em] uppercase text-accent">
                  Band {band.n}
                </span>
              </div>
              <h3 className="font-serif text-[22px] sm:text-[24px] text-ink leading-tight tracking-[-0.01em] mb-2.5 sm:mb-3">
                {band.label}
              </h3>
              <p className="text-[13px] sm:text-[13.5px] text-ink-2 leading-[1.6]">
                {band.body}
              </p>
            </article>
          ))}
        </div>

        {/* Country pill strip + CTA */}
        <div className="grid lg:grid-cols-[1fr_auto] gap-6 sm:gap-8 items-end pt-7 sm:pt-8 border-t border-ink">
          <div>
            <p className="font-mono text-[10px] sm:text-[11px] tracking-[0.14em] sm:tracking-[0.16em] uppercase text-mute mb-3 sm:mb-4">
              MENA countries supported in the wizard
            </p>
            <div className="flex flex-wrap gap-2">
              {MENA_COUNTRIES.map((c) => (
                <span
                  key={c}
                  className="font-mono text-[11px] tracking-[0.04em] px-3 py-1.5 border border-ink-3 text-ink-2 bg-paper"
                >
                  {c}
                </span>
              ))}
            </div>
          </div>
          <Link
            href="/assessment?goal=track-tenders"
            className="inline-flex items-center justify-center sm:justify-start gap-3 bg-ink px-6 sm:px-7 py-3.5 text-[13px] font-medium text-paper hover:bg-accent transition-colors whitespace-nowrap"
          >
            Run a MENA assessment
            <span className="font-mono text-[13px]">→</span>
          </Link>
        </div>
      </div>
    </section>
  );
}
