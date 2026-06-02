const BASE = "https://sheets.googleapis.com/v4/spreadsheets";

/**
 * Quote a sheet/tab title for use in an A1 range. Google requires titles that
 * contain spaces or special characters to be wrapped in single quotes, with any
 * embedded single quote doubled. Quoting is always safe, so we quote every title.
 */
export function a1Tab(tab: string): string {
  return `'${String(tab).replace(/'/g, "''")}'`;
}

async function gfetch(url: string, accessToken: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const err = new Error(`Sheets ${res.status}: ${await res.text()}`);
    (err as unknown as { status: number }).status = res.status;
    throw err;
  }
  return res.json();
}

export async function getSpreadsheetMeta(
  id: string,
  accessToken: string,
): Promise<{ title: string; sheets: string[] }> {
  const data = await gfetch(`${BASE}/${id}?fields=properties.title,sheets.properties.title`, accessToken);
  return {
    title: data.properties?.title ?? "",
    sheets: (data.sheets ?? []).map((s: { properties: { title: string } }) => s.properties.title),
  };
}

/** Reads all values for a tab. Returns a 2D string array (rows of cells). */
export async function readValues(id: string, tab: string, accessToken: string): Promise<string[][]> {
  const range = encodeURIComponent(a1Tab(tab));
  const data = await gfetch(`${BASE}/${id}/values/${range}?valueRenderOption=FORMATTED_VALUE`, accessToken);
  return (data.values ?? []) as string[][];
}

/** Adds a new sheet/tab and returns its title. */
export async function addResultsTab(id: string, title: string, accessToken: string): Promise<string> {
  await gfetch(`${BASE}/${id}:batchUpdate`, accessToken, {
    method: "POST",
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }),
  });
  return title;
}

/** Writes a 2D array starting at A1 of the given tab. */
export async function writeValues(
  id: string,
  tab: string,
  values: (string | number | null)[][],
  accessToken: string,
): Promise<void> {
  const range = encodeURIComponent(`${a1Tab(tab)}!A1`);
  await gfetch(`${BASE}/${id}/values/${range}?valueInputOption=RAW`, accessToken, {
    method: "PUT",
    body: JSON.stringify({ values }),
  });
}
