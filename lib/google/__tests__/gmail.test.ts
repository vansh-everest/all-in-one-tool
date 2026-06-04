import { describe, it, expect } from "vitest";
import { parseMetadata, decodeBodyParts } from "../gmail";

describe("parseMetadata", () => {
  it("pulls headers, fromEmail, internalDate from a metadata message", () => {
    const m = parseMetadata({
      id: "m1", threadId: "t1", snippet: "hello", internalDate: "1700000000000",
      payload: { headers: [
        { name: "From", value: "Axis Bank <Alerts@AxisBank.com>" },
        { name: "Subject", value: "EMI" },
        { name: "Date", value: "Wed, 01 May 2026 10:00:00 +0530" },
      ] },
    });
    expect(m.fromEmail).toBe("alerts@axisbank.com");
    expect(m.subject).toBe("EMI");
    expect(m.threadId).toBe("t1");
    expect(m.internalDate).toBe(new Date(1700000000000).toISOString());
  });
});

describe("decodeBodyParts", () => {
  it("prefers text/plain and base64url-decodes it", () => {
    const b64 = Buffer.from("Hello NACH", "utf8").toString("base64url");
    const body = decodeBodyParts({
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/plain", body: { data: b64 } },
        { mimeType: "text/html", body: { data: Buffer.from("<b>x</b>", "utf8").toString("base64url") } },
      ],
    });
    expect(body).toBe("Hello NACH");
  });
  it("falls back to stripped HTML when no plain part", () => {
    const html = Buffer.from("<p>Hi&nbsp;there</p>", "utf8").toString("base64url");
    const body = decodeBodyParts({ mimeType: "text/html", body: { data: html } });
    expect(body.replace(/\s+/g, " ").trim()).toBe("Hi there");
  });
});
