import { downloadFile, getFileMeta, listFolderChildren, type DriveFile } from "@/lib/google/drive";
import { isExtractable, isFolder } from "@/lib/google/mime";
import { geminiExtract, sumAmount, type Payment } from "./ocr";
import { withRetry } from "./queue";

// Gemini inline requests are capped around 20MB total; base64 inflates ~33%.
// Anything bigger should go through the File API — flag it instead of failing blind.
const MAX_INLINE_BYTES = 14 * 1024 * 1024;

export type FileExtraction = {
  file_id: string;
  name: string;
  mimeType: string;
  amount: number | null; // sum of payments in this file; null if unreadable/errored
  payments: Payment[];
  txn_ids: string[];
  readable: boolean;
  error: string | null;
  notes: string;
};

/**
 * Turn the Drive ids found in a cell into a flat list of extractable files.
 * A folder link expands to its image/PDF children (one level deep); a file link
 * resolves to itself. Per-id failures are collected, not thrown, so one bad link
 * doesn't sink the whole row.
 */
export async function resolveDriveFiles(
  linkIds: string[],
  accessToken: string,
): Promise<{ files: DriveFile[]; errors: { id: string; error: string }[] }> {
  const files: DriveFile[] = [];
  const errors: { id: string; error: string }[] = [];
  const seen = new Set<string>();

  for (const id of linkIds) {
    try {
      const meta = await getFileMeta(id, accessToken);
      if (isFolder(meta.mimeType)) {
        const children = await listFolderChildren(id, accessToken);
        for (const c of children) {
          if (isExtractable(c.mimeType) && !seen.has(c.id)) {
            seen.add(c.id);
            files.push(c);
          }
        }
      } else if (!seen.has(meta.id)) {
        seen.add(meta.id);
        files.push(meta);
      }
    } catch (e) {
      errors.push({ id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { files, errors };
}

const empty = (file: DriveFile, error: string): FileExtraction => ({
  file_id: file.id,
  name: file.name,
  mimeType: file.mimeType,
  amount: null,
  payments: [],
  txn_ids: [],
  readable: false,
  error,
  notes: "",
});

/** Download one Drive file and run Gemini extraction on it. Never throws. */
export async function extractOneFile(file: DriveFile, accessToken: string): Promise<FileExtraction> {
  if (!isExtractable(file.mimeType)) {
    return empty(file, `Unsupported file type for OCR: ${file.mimeType || "unknown"}`);
  }
  try {
    const { base64, mimeType } = await withRetry(() => downloadFile(file.id, accessToken));
    if (base64.length > MAX_INLINE_BYTES * 1.34) {
      return empty(file, "File too large for inline OCR (>14MB).");
    }
    // Metadata mime is authoritative; the download header can be octet-stream.
    const useMime = isExtractable(file.mimeType) ? file.mimeType : mimeType;
    const ocr = await withRetry(() => geminiExtract(base64, useMime));
    return {
      file_id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      amount: ocr.payments.length > 0 ? sumAmount(ocr.payments) : null,
      payments: ocr.payments,
      txn_ids: ocr.payments.map((p) => p.txn_id).filter((t): t is string => !!t),
      readable: ocr.payments.length > 0,
      error: ocr.payments.length > 0 ? null : ocr.notes || "Could not read any amount from this file.",
      notes: ocr.notes,
    };
  } catch (e) {
    return empty(file, e instanceof Error ? e.message : String(e));
  }
}
