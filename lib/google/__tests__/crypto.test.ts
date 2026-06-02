import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";
import { encryptToken, decryptToken } from "../crypto";

beforeAll(() => {
  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
});

describe("crypto", () => {
  it("round-trips a token", () => {
    const enc = encryptToken("1//refresh-token-value");
    expect(enc).not.toContain("refresh-token-value");
    expect(decryptToken(enc)).toBe("1//refresh-token-value");
  });
  it("produces different ciphertext each call (random IV)", () => {
    expect(encryptToken("x")).not.toBe(encryptToken("x"));
  });
  it("throws on tampered ciphertext", () => {
    const enc = encryptToken("secret");
    const parts = enc.split(".");
    const tampered = [parts[0], parts[1], Buffer.from("garbage").toString("base64")].join(".");
    expect(() => decryptToken(tampered)).toThrow();
  });
});
