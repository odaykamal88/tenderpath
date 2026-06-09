export default function ServiceLoading() {
  return (
    <div className="px-8 py-8 max-w-6xl animate-pulse">
      <div className="h-3 w-24 rounded-sm bg-paper-2 mb-5" />
      <div className="h-12 w-72 rounded-sm bg-paper-2 mb-2" />
      <div className="h-4 w-full max-w-2xl rounded-sm bg-paper-2/70 mb-8" />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.9fr)]">
        <div className="space-y-6">
          <div className="h-72 rounded-md border border-rule/70 bg-paper-3/40" />
          <div className="h-56 rounded-md border border-rule/70 bg-paper-3/40" />
        </div>
        <div className="h-96 rounded-md border border-rule/70 bg-paper-3/40" />
      </div>
    </div>
  );
}
