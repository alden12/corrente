import { describe, expect, it } from "vitest";
import { withUsed } from "../src/ui/explore/recent/store";

describe("Recently used", () => {
  it("puts what was just used first, once", () => {
    expect(withUsed(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
    expect(withUsed([], "a")).toEqual(["a"]);
  });

  it("drops the oldest past the limit", () => {
    expect(withUsed(["a", "b", "c"], "d", 3)).toEqual(["d", "a", "b"]);
  });
});
