import type { Direction, Extraction, PendencyItem } from "./types";

const DIRECTIONS: Direction[] = ["awaiting_lender", "action_on_us", "unclear"];

function stripFences(text: string): string {
  return text.replace(/```(?:json)?/gi, "").trim();
}

function firstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return text.slice(start, end + 1);
}

function toStr(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/** Parse Gemini extraction output for a thread. `messageId` is the fallback source id. */
export function parseExtraction(text: string, messageId: string): Extraction {
  const empty: Extraction = { items: [], last_contact_date: null };
  const candidate = firstJsonObject(stripFences(text ?? ""));
  if (!candidate) return empty;
  let obj: unknown;
  try {
    obj = JSON.parse(candidate);
  } catch {
    return empty;
  }
  if (!obj || typeof obj !== "object") return empty;
  const o = obj as Record<string, unknown>;
  const rawItems = Array.isArray(o.items) ? (o.items as Record<string, unknown>[]) : [];
  const items: PendencyItem[] = rawItems
    .filter((it) => it && typeof it === "object")
    .map((it) => {
      const dir = toStr(it.direction) as Direction;
      const last = it.last_update_date;
      return {
        item: toStr(it.item),
        status: toStr(it.status),
        last_update_date: last == null || last === "" ? null : toStr(last),
        direction: DIRECTIONS.includes(dir) ? dir : "unclear",
        source_message_id: toStr(it.source_message_id) || messageId,
      };
    })
    .filter((it) => it.item.trim() !== "");
  const lcd = o.last_contact_date;
  return { items, last_contact_date: lcd == null || lcd === "" ? null : toStr(lcd) };
}
