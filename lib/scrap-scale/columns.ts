import { parseDriveFileIds } from "./links";

export function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export type DetectedColumn = { index: number; header: string };
export type ColumnDetection = {
  link: DetectedColumn | null;
  expected: DetectedColumn | null;
  name: DetectedColumn | null;
  date: DetectedColumn | null;
  ambiguous: boolean;
  linkCandidates: number[];
  headers: string[];
};

const LINK_KEY = "uploadtransactiondetails";
const EXPECTED_KEY = "totalfundcollection";
const NAME_KEYS = ["name", "submittedby", "fullname"];
const DATE_KEY = "scrapsolddate";

function colHasLinks(sample: string[][], index: number): boolean {
  return sample.some((row) => parseDriveFileIds(row[index] ?? "").length > 0);
}

export function detectColumns(headers: string[], sample: string[][]): ColumnDetection {
  const norm = headers.map(normalizeHeader);

  const expectedIdx = norm.findIndex((h) => h.includes(EXPECTED_KEY));
  const nameIdx = norm.findIndex((h) => NAME_KEYS.some((k) => h.includes(k)));
  const dateIdx = norm.findIndex((h) => h.includes(DATE_KEY));

  const linkHeaderMatches = norm.flatMap((h, i) => (h.includes(LINK_KEY) ? [i] : []));
  const linkWithData = linkHeaderMatches.filter((i) => colHasLinks(sample, i));

  let link: DetectedColumn | null = null;
  let ambiguous = false;
  if (linkWithData.length === 1) link = { index: linkWithData[0], header: headers[linkWithData[0]] };
  else if (linkWithData.length > 1) ambiguous = true;
  else if (linkHeaderMatches.length === 1) link = { index: linkHeaderMatches[0], header: headers[linkHeaderMatches[0]] };
  else if (linkHeaderMatches.length > 1) ambiguous = true;

  return {
    link,
    expected: expectedIdx >= 0 ? { index: expectedIdx, header: headers[expectedIdx] } : null,
    name: nameIdx >= 0 ? { index: nameIdx, header: headers[nameIdx] } : null,
    date: dateIdx >= 0 ? { index: dateIdx, header: headers[dateIdx] } : null,
    ambiguous,
    linkCandidates: linkWithData.length > 1 ? linkWithData : linkHeaderMatches,
    headers,
  };
}
