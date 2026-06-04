function stripFences(text: string): string {
  return text.replace(/```(?:json)?/gi, "").trim();
}
function firstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return text.slice(start, end + 1);
}

/**
 * Parse a Gemini classification {lender_id, confidence}. Returns lenderId only when
 * confidence >= threshold and the id is a real lender id (not "none"/empty).
 */
export function parseClassification(
  text: string,
  threshold: number,
): { lenderId: string | null; confidence: number } {
  const candidate = firstJsonObject(stripFences(text ?? ""));
  if (!candidate) return { lenderId: null, confidence: 0 };
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(candidate) as Record<string, unknown>;
  } catch {
    return { lenderId: null, confidence: 0 };
  }
  const conf = typeof obj.confidence === "number" ? obj.confidence : 0;
  const idRaw = typeof obj.lender_id === "string" ? obj.lender_id.trim() : "";
  const valid = idRaw && idRaw.toLowerCase() !== "none";
  return { lenderId: valid && conf >= threshold ? idRaw : null, confidence: conf };
}
