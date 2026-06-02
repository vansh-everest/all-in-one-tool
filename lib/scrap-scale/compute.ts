export type OcrUnit = { amount: number | null; readable: boolean };
export type RowStatus = "ok" | "needs-review" | "note-row";

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function computeRow(input: {
  expected: number | null;
  ocr: OcrUnit[];
  hasLinks: boolean;
}): { extracted: number; difference: number; flagged: boolean; status: RowStatus } {
  if (!input.hasLinks) {
    return { extracted: 0, difference: 0, flagged: false, status: "note-row" };
  }
  const valid = input.ocr.filter((u) => u.readable && typeof u.amount === "number");
  const extracted = round2(valid.reduce((s, u) => s + (u.amount as number), 0));
  const expected = input.expected ?? 0;
  const difference = round2(extracted - expected);
  const anyUnreadable = input.ocr.some((u) => !u.readable || u.amount === null);
  const status: RowStatus = anyUnreadable ? "needs-review" : "ok";
  const flagged = difference !== 0;
  return { extracted, difference, flagged, status };
}
