import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key(): Buffer {
  const b = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY ?? "", "base64");
  if (b.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes (base64)");
  return b;
}

/** Returns "base64(iv).base64(tag).base64(ciphertext)". */
export function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ct].map((b) => b.toString("base64")).join(".");
}

export function decryptToken(enc: string): string {
  const [ivB, tagB, ctB] = enc.split(".");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB, "base64"));
  decipher.setAuthTag(Buffer.from(tagB, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB, "base64")), decipher.final()]).toString("utf8");
}
