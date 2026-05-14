export default function VendorReadinessCard() {
  return (
    <div className="w-full max-w-md rounded-xl bg-white shadow-xl shadow-gray-200/60 border border-gray-100 overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-6 pb-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gold-bg">
            <svg
              className="h-5 w-5 text-gold"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
          </div>
          <div>
            <h3 className="text-base font-semibold text-navy">
              Vendor Readiness Report
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">
              Sample Assessment Resource
            </p>
          </div>
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-gray-100" />

      {/* Rows */}
      <div className="px-6 py-4 space-y-4">
        <Row label="UNGM Registration" value="Ready" variant="blue" />
        <Row label="Evidence Gaps" value="Likely gaps" variant="gold" />
        <Row label="Revenue Band" value="Self-reported" variant="green" />
        <Row label="Active Tenders Matched" value="12 opportunities" variant="navy" />
        <Row label="Nearest Deadline" value="14 days — Act Now" variant="link" />
      </div>

      {/* Footer */}
      <div className="border-t border-gray-100 px-6 py-4">
        <p className="text-center text-[11px] font-medium tracking-widest text-gray-400 uppercase">
          Free — No Commitment Required
        </p>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  variant,
}: {
  label: string;
  value: string;
  variant: "blue" | "gold" | "green" | "navy" | "link";
}) {
  const valueClasses: Record<string, string> = {
    blue: "text-blue-600 font-medium",
    gold: "text-gold font-semibold",
    green: "text-green font-medium",
    navy: "text-navy font-semibold",
    link: "text-gold underline underline-offset-2 cursor-pointer font-medium",
  };

  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-gray-500">{label}</span>
      <span className={`text-sm ${valueClasses[variant]}`}>{value}</span>
    </div>
  );
}
