export const FOLDER_MIME = "application/vnd.google-apps.folder";

// MIME types Gemini can read inline. Images + PDF cover payment screenshots and
// scanned/multi-page receipts. (HEIC/HEIF come off iPhones.)
const GEMINI_IMAGE_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/heic",
  "image/heif",
]);

export function isFolder(mime: string | null | undefined): boolean {
  return (mime ?? "") === FOLDER_MIME;
}

export function isPdf(mime: string | null | undefined): boolean {
  return (mime ?? "").toLowerCase() === "application/pdf";
}

export function isImage(mime: string | null | undefined): boolean {
  return GEMINI_IMAGE_MIMES.has((mime ?? "").toLowerCase());
}

/** Can we send this file to Gemini for amount extraction? */
export function isExtractable(mime: string | null | undefined): boolean {
  return isImage(mime) || isPdf(mime);
}
