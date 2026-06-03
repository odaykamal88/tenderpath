/* Accountability — "who does what" RACI ledger.
 *
 * Borrowed from the esdaar review's sharpest line — human-in-the-loop, stated
 * plainly — and rebuilt for the TenderPath UN-procurement workflow in the live
 * dossier system. Reinforces the trust pillar: we prepare and check, the vendor
 * decides and signs, and the final submission click is always theirs.
 *
 * Every step below maps to a real product capability:
 *   02 → readiness assessment (5 dimensions) + tender matching
 *   03 → bid/no-bid analyst ($39)
 *   04 → tender requirement extraction against the published rubric
 *   05 → proposal draft ($299), compliance-mapped to the scoring matrix
 *   07 → the compliance_checklist gate (mandatory vs recommended items)
 *   09 → the submission-portal registry (the vendor registers + submits)
 *
 * Copy is deliberately de-regionalised from the source (no GOSI/CR Saudi
 * specifics) — TenderPath spans UN procurement across MENA, Turkey, the Gulf
 * and Africa.
 */

type Owner = "you" | "tp";

interface LedgerStep {
  n: string;
  owner: Owner;
  title: string;
  body: string;
}

const LEDGER: LedgerStep[] = [
  {
    n: "01",
    owner: "you",
    title: "Add your documents & evidence.",
    body: "Registration certificate, tax and audited financials, ISO/quality certs, past-performance evidence — into your document vault.",
  },
  {
    n: "02",
    owner: "tp",
    title: "Run the readiness assessment.",
    body: "We score you across five dimensions, flag the gaps that disqualify most vendors, and surface live tenders matched to your profile.",
  },
  {
    n: "03",
    owner: "you",
    title: "Pick the tender to pursue.",
    body: "You choose from the bid/no-bid calls. We never auto-enter you into anything.",
  },
  {
    n: "04",
    owner: "tp",
    title: "Read the tender & extract requirements.",
    body: "Eligibility, scoring criteria, and required documents — mapped against the call's published rubric.",
  },
  {
    n: "05",
    owner: "tp",
    title: "Draft the proposal sections.",
    body: "A draft of each section — technical, compliance and financial — mapped to the tender's scoring matrix. You edit and approve.",
  },
  {
    n: "06",
    owner: "you",
    title: "Edit, approve & add evidence.",
    body: "Every claim is yours to confirm. Change a number, swap a document, rewrite a line.",
  },
  {
    n: "07",
    owner: "tp",
    title: "Run the compliance check.",
    body: "We re-check eligibility, documents and figures — flagging administrative blockers before anything leaves your hands.",
  },
  {
    n: "08",
    owner: "you",
    title: "Final review & sign.",
    body: "The submission package is approved and signed off by your team — not by us.",
  },
  {
    n: "09",
    owner: "you",
    title: "Submit on the portal.",
    body: "You register and upload on UNGM or the agency portal yourself. The last click is always yours.",
  },
];

function OwnerPill({ owner }: { owner: Owner }) {
  const yours = owner === "you";
  return (
    <span
      className={`inline-block font-mono text-[9px] tracking-[0.14em] uppercase px-2 py-0.5 border whitespace-nowrap ${
        yours
          ? "text-accent border-accent"
          : "text-ink-3 border-rule"
      }`}
    >
      {yours ? "Yours" : "Ours"}
    </span>
  );
}

export default function Accountability() {
  const yours = LEDGER.filter((s) => s.owner === "you").length;
  const ours = LEDGER.length - yours;

  return (
    <section id="accountability" className="bg-paper-2 py-16 sm:py-20 lg:py-28 border-y border-rule">
      <div className="mx-auto max-w-7xl px-5 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] gap-10 sm:gap-12 lg:gap-16">
          {/* LEFT — thesis */}
          <div className="lg:pr-4">
            <p className="font-mono text-[10px] sm:text-[11px] tracking-[0.16em] sm:tracking-[0.18em] uppercase text-accent mb-4 sm:mb-5">
              Accountability
            </p>
            <h2 className="font-serif text-[34px] sm:text-[40px] lg:text-[52px] font-normal leading-[1.05] sm:leading-[1.0] tracking-[-0.02em] text-ink text-balance">
              We draft and check.{" "}
              <span className="text-mute">You decide and sign.</span>
            </h2>

            {/* The callout — the human-in-the-loop line, stated plainly */}
            <div className="mt-7 sm:mt-8 border-l-2 border-accent pl-4 sm:pl-5">
              <p className="text-[14.5px] sm:text-[15px] text-ink leading-[1.6] max-w-md">
                We don&apos;t submit bids for you — on purpose. A bid is your
                company&apos;s legal commitment; the final click should be a
                human&apos;s.
              </p>
            </div>

            {/* Tally */}
            <div className="mt-8 sm:mt-10 flex items-baseline gap-6 border-t border-rule pt-5">
              <div>
                <span className="font-serif text-[30px] sm:text-[34px] text-ink leading-none tabular-nums">
                  {yours}
                </span>
                <p className="font-mono text-[9.5px] tracking-[0.12em] uppercase text-accent mt-1.5">
                  steps yours
                </p>
              </div>
              <span className="font-serif text-[24px] text-mute leading-none">·</span>
              <div>
                <span className="font-serif text-[30px] sm:text-[34px] text-ink-2 leading-none tabular-nums">
                  {ours}
                </span>
                <p className="font-mono text-[9.5px] tracking-[0.12em] uppercase text-ink-3 mt-1.5">
                  steps ours
                </p>
              </div>
            </div>
          </div>

          {/* RIGHT — the 9-step ledger */}
          <ol className="border-t border-rule">
            {LEDGER.map((s) => (
              <li
                key={s.n}
                className="grid grid-cols-[28px_1fr] sm:grid-cols-[36px_1fr] gap-3 sm:gap-5 py-5 sm:py-6 border-b border-rule"
              >
                <span className="font-serif text-[18px] sm:text-[22px] text-accent leading-none tabular-nums tracking-[-0.01em]">
                  {s.n}
                </span>
                <div>
                  <div className="flex items-baseline justify-between gap-3 mb-1.5">
                    <h3 className="font-serif text-[16px] sm:text-[18px] text-ink leading-[1.25] tracking-[-0.01em]">
                      {s.title}
                    </h3>
                    <OwnerPill owner={s.owner} />
                  </div>
                  <p className="text-[13px] sm:text-[13.5px] text-ink-2 leading-[1.6] max-w-md">
                    {s.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
