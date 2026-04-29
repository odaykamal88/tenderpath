export default function ProposalPackageLoading() {
  return (
    <div className="max-w-3xl space-y-6 animate-pulse">
      <div className="h-7 w-64 rounded bg-gray-200" />
      <div className="h-4 w-96 rounded bg-gray-100" />

      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="rounded-xl border border-gray-100 bg-white p-5 space-y-3">
          <div className="h-4 w-40 rounded bg-gray-200" />
          <div className="space-y-2">
            <div className="h-3 w-full rounded bg-gray-100" />
            <div className="h-3 w-5/6 rounded bg-gray-100" />
            <div className="h-3 w-4/6 rounded bg-gray-100" />
          </div>
        </div>
      ))}
    </div>
  );
}
