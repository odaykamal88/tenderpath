export default function ProposalPackageLoading() {
  return (
    <div className="px-8 py-8 max-w-4xl animate-pulse">
      <div className="h-3 w-20 rounded-sm bg-stone-100 mb-5" />
      <div className="h-12 w-80 rounded-sm bg-stone-100 mb-2" />
      <div className="h-4 w-96 rounded-sm bg-stone-100/70 mb-8" />
      <div className="space-y-5">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="rounded-md border border-stone-200/70 bg-white p-6 space-y-3"
          >
            <div className="flex items-baseline gap-3 pb-3 border-b border-stone-100">
              <div className="h-3 w-6 rounded-sm bg-stone-100" />
              <div className="h-5 w-48 rounded-sm bg-stone-100" />
            </div>
            <div className="h-3 w-full rounded-sm bg-stone-100/60" />
            <div className="h-3 w-5/6 rounded-sm bg-stone-100/60" />
            <div className="h-3 w-4/6 rounded-sm bg-stone-100/60" />
          </div>
        ))}
      </div>
    </div>
  );
}
