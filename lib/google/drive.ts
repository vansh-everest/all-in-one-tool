export type DriveFile = { id: string; name: string; mimeType: string };

const DRIVE = "https://www.googleapis.com/drive/v3";
// supportsAllDrives + includeItemsFromAllDrives so shared drives / shared
// folders resolve, not just files in the connected account's My Drive.
const SHARED = "supportsAllDrives=true&includeItemsFromAllDrives=true";

async function dfetch(url: string, accessToken: string) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const err = new Error(`Drive ${res.status}: ${await res.text()}`);
    (err as unknown as { status: number }).status = res.status;
    throw err;
  }
  return res;
}

/** Fetch a file's metadata (name + mimeType). Lets us tell folders/PDFs/images apart. */
export async function getFileMeta(fileId: string, accessToken: string): Promise<DriveFile> {
  const res = await dfetch(`${DRIVE}/files/${fileId}?fields=id,name,mimeType&${SHARED}`, accessToken);
  return (await res.json()) as DriveFile;
}

/** List the immediate children of a Drive folder (non-trashed). */
export async function listFolderChildren(folderId: string, accessToken: string): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
    const pt = pageToken ? `&pageToken=${pageToken}` : "";
    const res = await dfetch(
      `${DRIVE}/files?q=${q}&fields=nextPageToken,files(id,name,mimeType)&pageSize=1000&${SHARED}${pt}`,
      accessToken,
    );
    const data = (await res.json()) as { files?: DriveFile[]; nextPageToken?: string };
    out.push(...(data.files ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return out;
}

/** Downloads a Drive file's bytes + mime type via files.get?alt=media. */
export async function downloadFile(
  fileId: string,
  accessToken: string,
): Promise<{ base64: string; mimeType: string }> {
  const res = await dfetch(`${DRIVE}/files/${fileId}?alt=media&${SHARED}`, accessToken);
  const mimeType = res.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
  const buf = Buffer.from(await res.arrayBuffer());
  return { base64: buf.toString("base64"), mimeType };
}
