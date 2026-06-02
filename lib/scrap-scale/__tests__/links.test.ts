import { describe, it, expect } from "vitest";
import { parseDriveFileIds, extractSpreadsheetId } from "../links";

describe("parseDriveFileIds", () => {
  it("parses open?id= form", () => {
    expect(parseDriveFileIds("https://drive.google.com/open?id=ABC123")).toEqual(["ABC123"]);
  });
  it("parses /file/d/<id>/ form", () => {
    expect(parseDriveFileIds("https://drive.google.com/file/d/XYZ_789/view?usp=sharing")).toEqual(["XYZ_789"]);
  });
  it("splits multiple links on comma/newline/space", () => {
    const cell = "https://drive.google.com/open?id=A1 , https://drive.google.com/file/d/B2/view\nhttps://drive.google.com/open?id=C3";
    expect(parseDriveFileIds(cell)).toEqual(["A1", "B2", "C3"]);
  });
  it("dedupes repeated ids", () => {
    expect(parseDriveFileIds("https://drive.google.com/open?id=A1 https://drive.google.com/open?id=A1")).toEqual(["A1"]);
  });
  it("returns [] for free text with no drive link", () => {
    expect(parseDriveFileIds("Scrap sale belongs to Nov 2025")).toEqual([]);
  });
});

describe("extractSpreadsheetId", () => {
  it("extracts id from a sheet url", () => {
    expect(extractSpreadsheetId("https://docs.google.com/spreadsheets/d/1AbC-dEf/edit#gid=0")).toBe("1AbC-dEf");
  });
  it("returns null for a non-sheet url", () => {
    expect(extractSpreadsheetId("https://example.com")).toBe(null);
  });
});
