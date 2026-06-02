export type Summary = {
  totalRows: number;
  reconciled: number;
  flagged: number;
  duplicates: number;
  needsReview: number;
  noteRows: number;
  sumExtracted: number;
};

export function ReconSummary({ summary, sumExpected }: { summary: Summary; sumExpected: number }) {
  const net = Math.round((summary.sumExtracted - sumExpected) * 100) / 100;
  const cell = (label: string, value: string | number, tone = "text-gray-900") => (
    <div className="rounded-lg border bg-white p-4">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-lg font-semibold ${tone}`}>{value}</div>
    </div>
  );
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
      {cell("Total rows", summary.totalRows)}
      {cell("Reconciled", summary.reconciled, "text-green-700")}
      {cell("Flagged", summary.flagged, summary.flagged ? "text-red-600" : "text-gray-900")}
      {cell("Duplicates", summary.duplicates, summary.duplicates ? "text-amber-600" : "text-gray-900")}
      {cell("Needs review", summary.needsReview, summary.needsReview ? "text-amber-600" : "text-gray-900")}
      {cell("Note rows", summary.noteRows)}
      {cell("Net difference", net, net === 0 ? "text-green-700" : "text-red-600")}
    </div>
  );
}
