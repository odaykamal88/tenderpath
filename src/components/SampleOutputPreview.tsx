"use client";

export type SamplePreviewType = "bid-no-bid" | "digest" | "proposal" | "roster";

interface Props {
  type: SamplePreviewType;
  companyName?: string;
  sector?: string;
  variant?: "dark" | "light";
}

/* ── Tiny win-probability ring ── */
function ScoreRing({ score, size = 64 }: { score: number; size?: number }) {
  const r = size / 2 - 6;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - score / 100);
  const color = score >= 70 ? "#4ade80" : score >= 50 ? "#f59e0b" : "#f87171";
  return (
    <div className="relative inline-flex items-center justify-center flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#374151" strokeWidth="5" />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={color} strokeWidth="5"
          strokeDasharray={circ} strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xs font-bold leading-none" style={{ color }}>{score}%</span>
      </div>
    </div>
  );
}

/* ── Watermark footer ── */
function Watermark({ dark }: { dark: boolean }) {
  return (
    <p className={`mt-4 pt-3 border-t text-[10px] italic ${dark ? "border-white/8 text-gray-600" : "border-gray-200 text-gray-400"}`}>
      Sample output — your actual report reflects your specific profile and requirements.
    </p>
  );
}

/* ── BidNoBid preview ── */
function BidNoBidPreview({ dark }: { dark: boolean }) {
  const criteria = [
    { label: "Sector alignment", result: "Match", ok: true },
    { label: "Geographic scope", result: "Match", ok: true },
    { label: "Technical capacity", result: "Match", ok: true },
    { label: "DUNS registration", result: "Missing", ok: false },
  ];
  const risks = [
    "D-U-N-S number not detected on file",
    "Audited financials (last 2 years) may be required",
  ];

  const row = dark
    ? "flex items-center justify-between py-1.5 border-b border-white/6 last:border-0"
    : "flex items-center justify-between py-1.5 border-b border-gray-100 last:border-0";
  const sectionHead = dark
    ? "text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-2"
    : "text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-2";

  return (
    <div>
      {/* Recommendation banner */}
      <div className={`flex items-center justify-between rounded-lg px-3 py-2.5 mb-4 ${dark ? "bg-green/10 border border-green/20" : "bg-green-50 border border-green-200"}`}>
        <span className={`text-xs font-semibold ${dark ? "text-green" : "text-green-800"}`}>
          Recommendation
        </span>
        <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${dark ? "bg-green/20 text-green" : "bg-green-100 text-green-800"}`}>
          ✓ Pursue — Strong fit
        </span>
      </div>

      {/* Win probability + criteria */}
      <div className="flex items-start gap-5 mb-4">
        <div className="flex flex-col items-center gap-1 flex-shrink-0">
          <ScoreRing score={78} size={60} />
          <span className={`text-[9px] ${dark ? "text-gray-500" : "text-gray-400"}`}>win probability</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className={sectionHead}>Scoring criteria</p>
          {criteria.map((c) => (
            <div key={c.label} className={row}>
              <span className={`text-xs ${dark ? "text-gray-300" : "text-gray-700"}`}>{c.label}</span>
              <span className={`text-[11px] font-semibold ${c.ok ? (dark ? "text-green" : "text-green-700") : (dark ? "text-red-400" : "text-red-600")}`}>
                {c.ok ? "✓" : "✗"} {c.result}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Risk flags */}
      <div className="mb-4">
        <p className={sectionHead}>Risk flags</p>
        <div className="space-y-1">
          {risks.map((r) => (
            <div key={r} className="flex items-start gap-2">
              <span className={`text-[10px] mt-0.5 ${dark ? "text-amber-400" : "text-amber-600"}`}>●</span>
              <span className={`text-xs ${dark ? "text-gray-400" : "text-gray-600"}`}>{r}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Effort */}
      <div className={`flex gap-4 rounded-md px-3 py-2 text-xs ${dark ? "bg-white/5" : "bg-gray-100"}`}>
        <span className={dark ? "text-gray-400" : "text-gray-600"}>
          <span className={`font-semibold ${dark ? "text-white" : "text-gray-900"}`}>Effort</span> ~3 person-days
        </span>
        <span className={dark ? "text-gray-400" : "text-gray-600"}>
          <span className={`font-semibold ${dark ? "text-white" : "text-gray-900"}`}>Deadline</span> 14 days
        </span>
      </div>

      <Watermark dark={dark} />
    </div>
  );
}

/* ── Digest preview ── */
function DigestPreview({ dark, sector }: { dark: boolean; sector?: string }) {
  const sectorLabel = sector ?? "Advisory Services";
  const tenders = [
    { agency: "UNICEF", title: `${sectorLabel} — programme support`, fit: 81, deadline: "May 12", geo: "Kenya", bucket: "Act Now" },
    { agency: "UNDP", title: "Programme delivery support", fit: 74, deadline: "May 19", geo: "Global", bucket: "Strong Fit" },
    { agency: "WHO AFRO", title: "Health systems strengthening", fit: 67, deadline: "May 26", geo: "Africa", bucket: "Strong Fit" },
  ];

  const bucketCls = (b: string) =>
    b === "Act Now"
      ? dark ? "bg-red-500/20 text-red-400" : "bg-red-100 text-red-700"
      : dark ? "bg-green/20 text-green" : "bg-green-100 text-green-700";

  const fitCls = (f: number) =>
    f >= 75
      ? dark ? "bg-green/20 text-green border border-green/30" : "bg-green-100 text-green-700 border border-green-200"
      : dark ? "bg-amber-500/20 text-amber-400 border border-amber-500/30" : "bg-amber-100 text-amber-700 border border-amber-200";

  return (
    <div>
      {/* Subject line */}
      <div className={`rounded-md px-3 py-2 mb-4 text-xs font-medium ${dark ? "bg-white/5 text-gray-300" : "bg-gray-100 text-gray-700"}`}>
        📬 <span className="font-semibold">TenderPath Digest</span> — 4 new matches this week
      </div>

      {/* Tender cards */}
      <div className="space-y-2 mb-3">
        {tenders.map((t) => (
          <div
            key={t.agency}
            className={`rounded-lg border px-3 py-2.5 ${dark ? "bg-white/5 border-white/10" : "bg-white border-gray-200"}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${dark ? "bg-white/10 text-gray-300" : "bg-gray-100 text-gray-600"}`}>
                    {t.agency}
                  </span>
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${bucketCls(t.bucket)}`}>
                    {t.bucket}
                  </span>
                </div>
                <p className={`text-xs font-medium truncate ${dark ? "text-white" : "text-gray-900"}`}>{t.title}</p>
                <p className={`text-[10px] mt-0.5 ${dark ? "text-gray-500" : "text-gray-400"}`}>
                  Deadline {t.deadline} · {t.geo}
                </p>
              </div>
              <span className={`text-xs font-bold px-2 py-1 rounded-full flex-shrink-0 ${fitCls(t.fit)}`}>
                {t.fit}%
              </span>
            </div>
          </div>
        ))}
      </div>

      <p className={`text-[11px] ${dark ? "text-gray-500" : "text-gray-400"}`}>
        + 1 more match / 2 watchlist items excluded
      </p>

      <Watermark dark={dark} />
    </div>
  );
}

/* ── Proposal preview ── */
function ProposalPreview({ dark, companyName }: { dark: boolean; companyName?: string }) {
  const name = companyName ?? "Your organization";
  const sections = [
    "Executive Summary",
    "Understanding of Requirements",
    "Technical Approach & Methodology",
    "Team Composition & CVs",
    "Past Performance",
  ];
  const checklist = [
    { item: "Company registration certificate", ok: true },
    { item: "Tax clearance certificate", ok: true },
    { item: "UNGM registration (required)", ok: false },
    { item: "Audited financials (last 2 years)", ok: false },
  ];

  const divider = dark ? "border-t border-white/8 my-3" : "border-t border-gray-100 my-3";

  return (
    <div>
      {/* TOC */}
      <p className={`text-[10px] font-bold uppercase tracking-wider mb-2 ${dark ? "text-gray-500" : "text-gray-500"}`}>
        Table of contents
      </p>
      <div className="space-y-1 mb-1">
        {sections.map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <span className={`text-[10px] w-4 flex-shrink-0 ${dark ? "text-gray-600" : "text-gray-400"}`}>{i + 1}.</span>
            <span className={`text-xs ${dark ? "text-gray-300" : "text-gray-700"}`}>{s}</span>
          </div>
        ))}
      </div>

      <div className={divider} />

      {/* Executive summary excerpt */}
      <p className={`text-[10px] font-bold uppercase tracking-wider mb-1.5 ${dark ? "text-gray-500" : "text-gray-500"}`}>
        Executive summary (excerpt)
      </p>
      <p className={`text-xs leading-5 ${dark ? "text-gray-400" : "text-gray-600"}`}>
        <span className={dark ? "text-gray-200" : "text-gray-900"}>{name}</span> brings proven delivery capacity in the target sector across fragile and transition environments. Our technical approach is structured across three phases — inception, implementation, and handover — with dedicated M&amp;E embedded from day one.
      </p>

      <div className={divider} />

      {/* Compliance checklist */}
      <p className={`text-[10px] font-bold uppercase tracking-wider mb-2 ${dark ? "text-gray-500" : "text-gray-500"}`}>
        Compliance checklist
      </p>
      <div className="space-y-1.5">
        {checklist.map((c) => (
          <div key={c.item} className="flex items-center gap-2">
            <span className={`text-[11px] font-bold flex-shrink-0 ${c.ok ? (dark ? "text-green" : "text-green-600") : (dark ? "text-red-400" : "text-red-600")}`}>
              {c.ok ? "✓" : "✗"}
            </span>
            <span className={`text-xs ${c.ok ? (dark ? "text-gray-300" : "text-gray-700") : (dark ? "text-red-400/80" : "text-red-700")}`}>
              {c.item}
            </span>
          </div>
        ))}
      </div>

      <Watermark dark={dark} />
    </div>
  );
}

/* ── Roster preview ── */
function RosterPreview({ dark }: { dark: boolean }) {
  const docs = [
    { item: "Company registration certificate", ok: true },
    { item: "Capability statement (draft included)", ok: true },
    { item: "Cover letter (draft included)", ok: true },
    { item: "Tax clearance certificate", ok: true },
    { item: "Company profile", ok: true },
    { item: "Client reference list (min. 3)", ok: true },
    { item: "UNGM registration (step-by-step guide included)", ok: false },
    { item: "Audited financials — last 2 years (template provided)", ok: false },
  ];
  const timeline = [
    { label: "Document prep", status: "done", week: "Week 1" },
    { label: "Internal review", status: "done", week: "Week 2" },
    { label: "Submission", status: "active", week: "Week 2–3" },
    { label: "Follow-up", status: "pending", week: "Post-submit" },
  ];

  const statusCls = (s: string) =>
    s === "done"
      ? dark ? "bg-green/20 text-green" : "bg-green-100 text-green-700"
      : s === "active"
      ? dark ? "bg-gold/20 text-gold" : "bg-amber-100 text-amber-700"
      : dark ? "bg-white/10 text-gray-500" : "bg-gray-100 text-gray-500";

  return (
    <div>
      {/* Target */}
      <div className={`rounded-md px-3 py-2 mb-4 ${dark ? "bg-white/5" : "bg-gray-50"}`}>
        <p className={`text-[10px] font-bold uppercase tracking-wider mb-1 ${dark ? "text-gray-500" : "text-gray-500"}`}>Target agency</p>
        <p className={`text-xs font-medium ${dark ? "text-white" : "text-gray-900"}`}>UNDP — Professional Services Roster (ICT &amp; Digital)</p>
        <p className={`text-[11px] mt-0.5 ${dark ? "text-gray-400" : "text-gray-500"}`}>Window open until 30 June 2025</p>
      </div>

      {/* Document checklist */}
      <p className={`text-[10px] font-bold uppercase tracking-wider mb-2 ${dark ? "text-gray-500" : "text-gray-500"}`}>
        Document checklist
      </p>
      <div className="space-y-1.5 mb-4">
        {docs.map((d) => (
          <div key={d.item} className="flex items-start gap-2">
            <span className={`text-[11px] font-bold flex-shrink-0 mt-px ${d.ok ? (dark ? "text-green" : "text-green-600") : (dark ? "text-gray-600" : "text-gray-400")}`}>
              {d.ok ? "✓" : "○"}
            </span>
            <span className={`text-xs ${d.ok ? (dark ? "text-gray-300" : "text-gray-700") : (dark ? "text-gray-500" : "text-gray-500")}`}>
              {d.item}
            </span>
          </div>
        ))}
      </div>

      {/* Timeline */}
      <p className={`text-[10px] font-bold uppercase tracking-wider mb-2 ${dark ? "text-gray-500" : "text-gray-500"}`}>
        Timeline
      </p>
      <div className="flex gap-2">
        {timeline.map((t) => (
          <div key={t.label} className="flex-1 text-center">
            <div className={`rounded-md px-1.5 py-1.5 text-[9px] font-semibold mb-1 ${statusCls(t.status)}`}>
              {t.label}
            </div>
            <p className={`text-[9px] ${dark ? "text-gray-600" : "text-gray-400"}`}>{t.week}</p>
          </div>
        ))}
      </div>

      <Watermark dark={dark} />
    </div>
  );
}

/* ── Main export ── */
export default function SampleOutputPreview({ type, companyName, sector, variant = "dark" }: Props) {
  const dark = variant === "dark";
  if (type === "bid-no-bid") return <BidNoBidPreview dark={dark} />;
  if (type === "digest") return <DigestPreview dark={dark} sector={sector} />;
  if (type === "proposal") return <ProposalPreview dark={dark} companyName={companyName} />;
  return <RosterPreview dark={dark} />;
}
