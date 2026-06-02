/** Downloads a Drive file's bytes + mime type via files.get?alt=media. */
export async function downloadFile(
  fileId: string,
  accessToken: string,
): Promise<{ base64: string; mimeType: string }> {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const err = new Error(`Drive ${res.status}: ${await res.text()}`);
    (err as unknown as { status: number }).status = res.status;
    throw err;
  }
  const mimeType = res.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
  const buf = Buffer.from(await res.arrayBuffer());
  return { base64: buf.toString("base64"), mimeType };
}
