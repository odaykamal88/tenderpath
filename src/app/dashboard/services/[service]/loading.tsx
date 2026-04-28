export default function ServiceLoading() {
  return (
    <div className="space-y-4">
      <div className="h-8 w-64 rounded-md bg-gray-100" />
      <div className="h-4 w-full max-w-2xl rounded-md bg-gray-100" />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.9fr)]">
        <div className="h-80 rounded-lg border border-gray-200 bg-white" />
        <div className="h-64 rounded-lg border border-gray-200 bg-white" />
      </div>
    </div>
  );
}
