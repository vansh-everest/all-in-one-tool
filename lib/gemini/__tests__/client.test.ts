import { describe, it, expect } from "vitest";
import { pickKeyOrder } from "../client";

describe("pickKeyOrder", () => {
  it("rotates the starting key then continues round-robin", () => {
    expect(pickKeyOrder(["a", "b", "c"], 1)).toEqual(["b", "c", "a"]);
    expect(pickKeyOrder(["a", "b", "c"], 0)).toEqual(["a", "b", "c"]);
  });
  it("handles a single key", () => {
    expect(pickKeyOrder(["a"], 0)).toEqual(["a"]);
  });
});
